"""一轮对话的组装、拒绝和停止。不连接数据库或模型。"""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from chatbot.chat.context.assemble import build_prompt, turn_query, turn_title
from chatbot.chat.turn.schemas import ChatTurnIn
from chatbot.chat.turn.service import chat_events
from chatbot.chat.turn.stream import _block, _langchain_messages, chunk_events
from chatbot.chat.turn.tasks import open_turn, stop_turn
from chatbot.chat.memory.schemas import MemoryLoaded
from chatbot.framework.exceptions.biz import BizException


def test_turn_query_uses_text_then_file_name_then_empty():
    assert turn_query([{"text": " 看这张 "}, {"image": {"url": "https://cdn.example/a.png"}}]) == "看这张"
    assert turn_query([{"file": {"name": "笔记.pdf", "text": "正文"}}]) == "笔记.pdf"
    assert turn_query([{"image": {"url": "https://cdn.example/a.png"}}]) == ""
    assert turn_title([{"image": {"url": "https://cdn.example/a.png"}}]) == "图片"


def test_user_turn_rejects_thought_and_file_without_text():
    with pytest.raises(ValidationError):
        ChatTurnIn(persona_id=1, parts=[{"text": "想一下", "thought": True}])
    with pytest.raises(ValidationError):
        ChatTurnIn(
            persona_id=1,
            parts=[{"file": {"url": "https://cdn.example/a.pdf", "name": "a.pdf"}}],
        )


def test_prompt_keeps_prefix_then_history_then_current_turn():
    persona = SimpleNamespace(
        name="林夏",
        description="书店店员",
        personality="温和",
        scenario="",
        example_dialogue="",
        system_prompt="",
        post_history="先回应用户刚刚那句话。",
        portrait_url="https://cdn.example/portrait.png",
    )
    history = [SimpleNamespace(role="assistant", parts=[{"text": "你好呀"}])]
    loaded = SimpleNamespace(
        self_memories=[SimpleNamespace(text="喜欢雨天")],
        recent=[SimpleNamespace(text="昨天买了书")],
        associative=[SimpleNamespace(text="常去江边")],
    )
    current = [
        {"text": "看看这个"},
        {"image": {"url": "https://cdn.example/a.png"}},
        {"file": {"url": "https://cdn.example/a.pdf", "name": "笔记.pdf", "text": "第三章"}},
    ]
    messages = build_prompt(
        persona,
        "",
        history,
        loaded,
        current,
        {"https://cdn.example/a.png": (b"png", "image/png")},
    )

    assert messages[0]["role"] == "system"
    assert "相关记忆" in messages[0]["parts"][0]["text"]
    assert "林夏" in messages[0]["parts"][0]["text"]
    assert "喜欢雨天" in messages[0]["parts"][0]["text"]
    assert "portrait" not in messages[0]["parts"][0]["text"]
    assert messages[1] == {"role": "assistant", "parts": [{"text": "你好呀"}]}
    assert messages[2]["parts"][0]["text"] == "先回应用户刚刚那句话。"
    assert "常去江边" in messages[3]["parts"][0]["text"]
    assert messages[4]["parts"][1] == {"image": {"data": b"png", "mime_type": "image/png"}}
    assert "第三章" in messages[4]["parts"][2]["text"]
    assert "看看这个" not in messages[1]["parts"][0]["text"]

    persona.system_prompt = "只按这张卡片说话。"
    replaced = build_prompt(
        persona,
        "",
        history,
        loaded,
        current,
        {"https://cdn.example/a.png": (b"png", "image/png")},
    )
    assert replaced[0]["parts"][0]["text"].startswith("只按这张卡片说话。")
    assert "先判断用户此刻" not in replaced[0]["parts"][0]["text"]


def test_chunk_keeps_thought_separate():
    chunk = SimpleNamespace(content=[{"text": "在想", "thought": True}, {"text": "好的"}])
    assert chunk_events(chunk) == [("thought", "在想", None), ("response", "好的", None)]


def test_thought_signature_stays_on_the_same_part():
    signed = SimpleNamespace(content=[{"text": "在想", "thought": True, "thoughtSignature": " sig "}])
    assert chunk_events(signed) == [("thought", "在想", "sig")]

    class Message:
        def __init__(self, content, additional_kwargs=None):
            self.content = content
            self.additional_kwargs = additional_kwargs or {}

    sent = _langchain_messages(
        [
            {
                "role": "assistant",
                "parts": [
                    {"text": "在想", "thought": True, "thought_signature": "sig"},
                    {"text": "好的"},
                ],
            }
        ],
        Message,
        Message,
        Message,
    )
    assert sent[0].content[0] == {"type": "text", "text": "在想", "thought": True, "thought_signature": "sig"}
    assert sent[0].additional_kwargs == {}
    assert _block({"text": "好的"}) == {"type": "text", "text": "好的"}


def test_reject_persists_user_and_rejected_reply_without_the_title_model():
    saved = []
    created = []

    async def place(session, **kwargs):
        return SimpleNamespace(id=kwargs["conversation_id"], title="图片", persona_id=kwargs["persona_id"])

    async def add(session, conversation_id, payload):
        saved.append(payload)
        return SimpleNamespace(id=41, status=payload.get("status", "normal"), title="图片")

    async def save(session, payload):
        created.append(payload)
        return SimpleNamespace(id=payload["conversation_id"], title="不该出现")

    events = asyncio.run(
        _collect(
            parts=[{"image": {"url": "https://cdn.example/a.png", "mime_type": "image/png"}}],
            limiter=_Gate(None),
            patches={"place_conversation": place, "add_message": add, "save_conversation": save},
        )
    )

    assert created == []
    assert saved[0]["role"] == "user"
    assert saved[1]["status"] == "rejected"
    assert saved[1]["parts"] == [{"text": "系统繁忙，请稍后再试"}]
    assert "event: meta" in events[0]
    assert "event: reject" in events[1]
    assert '"status": "rejected"' in events[2]
    assert events[3] == "event: done\ndata: [DONE]\n\n"


def test_cancel_while_waiting_does_not_write_a_message():
    saved = []

    async def add(session, conversation_id, payload):
        saved.append(payload)
        return SimpleNamespace(id=1, status="normal")

    events = asyncio.run(_collect(limiter=_Gate(None, cancel=True), patches={"add_message": add}))

    assert saved == []
    assert events == ["event: done\ndata: [DONE]\n\n"]


def test_granted_turn_streams_and_saves_thought_apart_from_the_reply():
    saved = []
    seen = {}

    async def add(session, conversation_id, payload):
        saved.append(payload)
        return SimpleNamespace(id=7, status=payload.get("status", "normal"))

    async def reply(messages, api_key):
        seen["key"] = api_key
        seen["file"] = messages[-1]["parts"][-1]["text"]
        yield "thought", "先看文件"
        yield "response", "第三章讲雨"

    events = asyncio.run(
        _collect(
            parts=[
                {"text": "帮我看"},
                {"file": {"url": "https://cdn.example/a.pdf", "name": "笔记.pdf", "text": "第三章"}},
            ],
            limiter=_Gate(_Permit()),
            reply=reply,
            patches={"add_message": add},
        )
    )

    assert seen["key"] == "user-key"
    assert "第三章" in seen["file"]
    assert saved[0]["role"] == "assistant"
    assert saved[0]["parts"] == [{"text": "你好呀"}]
    assert saved[-1]["status"] == "normal"
    assert saved[-1]["parts"][0]["thought"] is True
    assert saved[-1]["parts"][1]["text"] == "第三章讲雨"
    assert any("event: message" in event and '"type": "thought"' in event for event in events)
    assert events[-1] == "event: done\ndata: [DONE]\n\n"


def test_image_read_failure_saves_a_failed_reply():
    saved = []

    async def add(session, conversation_id, payload):
        saved.append(payload)
        return SimpleNamespace(id=8, status=payload.get("status", "normal"))

    async def broken(url: str):
        raise BizException("图片读取失败")

    events = asyncio.run(
        _collect(
            parts=[{"image": {"url": "https://cdn.example/a.png"}}],
            limiter=_Gate(_Permit()),
            read_image=broken,
            patches={"add_message": add},
        )
    )

    assert saved[-1]["status"] == "failed"
    assert events[0].startswith("event: meta")
    assert '"conversation_id":' in events[0]
    assert '"task_id":' in events[0]
    assert '"status": "failed"' in events[-2]


def test_model_receives_the_uncovered_window():
    seen = {}

    async def listed(session, conversation_id, owner):
        return [
            SimpleNamespace(
                role="user",
                parts=[{"text": "已被盖住"}, {"image": {"url": "https://cdn.example/old.png"}}],
            )
        ]

    async def window(session, conversation):
        return [
            SimpleNamespace(
                role="assistant",
                parts=[{"text": "还在窗口", "thought": True, "thought_signature": "sig"}],
            )
        ]

    async def reply(messages, api_key):
        seen["messages"] = messages
        yield "response", "好"

    async def read_image(url: str):
        seen["fetched"] = url
        return b"x", "image/png"

    async def add(session, conversation_id, payload):
        return SimpleNamespace(id=1, status=payload.get("status", "normal"))

    asyncio.run(
        _collect(
            parts=[{"text": "现在"}],
            reply=reply,
            read_image=read_image,
            patches={"list_messages": listed, "uncovered_messages": window, "add_message": add},
        )
    )

    rendered = str(seen["messages"])
    assert "已被盖住" not in rendered
    assert "old.png" not in rendered
    assert "fetched" not in seen
    assert seen["messages"][1]["parts"][0] == {
        "text": "还在窗口",
        "thought": True,
        "thought_signature": "sig",
    }


def test_thought_signature_is_stored_on_the_reply():
    saved = []

    async def add(session, conversation_id, payload):
        saved.append(payload)
        return SimpleNamespace(id=7, status=payload.get("status", "normal"))

    async def reply(messages, api_key):
        yield "thought", "先看", "sig-1"
        yield "response", "好"

    asyncio.run(_collect(limiter=_Gate(_Permit()), reply=reply, patches={"add_message": add}))

    assert saved[-1]["parts"][0] == {"text": "先看", "thought": True, "thought_signature": "sig-1"}


def test_conversation_create_failure_does_not_emit_meta():
    async def save(session, data):
        raise BizException("用户不存在")

    events = asyncio.run(_collect(patches={"save_conversation": save}))

    assert all(not event.startswith("event: meta") for event in events)
    assert '"status": "failed"' in events[0]


def test_stop_only_matches_the_owner():
    async def scenario():
        owner = uuid4()
        handle = await open_turn(9, owner)
        assert await stop_turn(9, uuid4()) is False
        assert handle.cancel.is_set() is False
        assert await stop_turn(9, owner) is True
        assert handle.cancel.is_set() is True

    asyncio.run(scenario())


class _Permit:
    def __init__(self) -> None:
        self.released = False

    async def release(self) -> None:
        self.released = True


class _Gate:
    def __init__(self, permit, cancel: bool = False) -> None:
        self.permit = permit
        self.cancel = cancel

    async def acquire(self, cancel):
        if self.cancel:
            cancel.set()
            return None
        return self.permit


async def _collect(parts=None, limiter=None, reply=None, read_image=None, patches=None) -> str:
    import chatbot.chat.turn.service as turn

    user_id = uuid4()
    payload = ChatTurnIn(
        persona_id=1,
        parts=parts or [{"text": "你好"}],
    )

    async def save(session, data):
        return SimpleNamespace(id=data["conversation_id"], title="新对话", persona_id=data["persona_id"])

    async def owned(session, conversation_id, owner):
        raise BizException("会话不存在")

    async def linked(session, persona_id, owner):
        return SimpleNamespace(
            id=persona_id,
            name="林夏",
            description="书店店员",
            personality="温和",
            scenario="",
            example_dialogue="",
            system_prompt="",
            post_history="",
            greeting="你好呀",
            portrait_url="https://cdn.example/portrait.png",
        )

    async def messages(session, conversation_id, owner):
        return []

    async def key(session, owner):
        return "user-key"

    def memory(api_key):
        return object()

    def loaded(memory, data):
        return MemoryLoaded(self_memories=[], recent=[], associative=[])

    originals = {
        "save_conversation": turn.save_conversation,
        "place_conversation": turn.place_conversation,
        "add_message": turn.add_message,
        "list_messages": turn.list_messages,
        "uncovered_messages": turn.uncovered_messages,
        "linked_persona": turn.linked_persona,
        "user_api_key": turn.user_api_key,
        "create_memory": turn.create_memory,
        "load_memory": turn.load_memory,
        "_owned": turn._owned,
    }
    turn.save_conversation = save
    turn.place_conversation = save
    turn.add_message = patches.get("add_message", save) if patches else save
    async def window(session, conversation):
        return []

    turn.list_messages = messages
    turn.uncovered_messages = window
    turn.linked_persona = linked
    turn.user_api_key = key
    turn.create_memory = memory
    turn.load_memory = loaded
    turn._owned = owned
    if patches:
        for name, func in patches.items():
            setattr(turn, name, func)

    @asynccontextmanager
    async def sessions():
        yield SimpleNamespace(get=_missing)

    async def _missing(model, key):
        return None

    chunks = []
    try:
        async for event in chat_events(
            None,
            user_id,
            payload,
            sessions=sessions,
            limiter=limiter or _Gate(_Permit()),
            stream_reply=reply,
            read_image=read_image,
        ):
            chunks.append(event)
    finally:
        for name, func in originals.items():
            setattr(turn, name, func)
    return chunks
