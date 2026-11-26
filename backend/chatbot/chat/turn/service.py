"""一轮对话：排队、落库、组装上下文、流式调用，并在结束时释放名额。"""

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from uuid import UUID

from chatbot.bootstrap.deps import session_scope
from chatbot.chat.context.assemble import build_prompt, turn_query, turn_title
from chatbot.chat.context.flush import flush_through, slide_until
from chatbot.chat.context.service import _owned, uncovered_messages
from chatbot.chat.conversation.service import place_conversation, save_conversation
from chatbot.chat.message.service import add_message, list_messages
from chatbot.chat.memory.mem0 import create_memory
from chatbot.chat.memory.service import load_memory
from chatbot.chat.models import ConversationSummary, Persona
from chatbot.chat.persona.service import linked_persona
from chatbot.chat.turn.media import fetch_image
from chatbot.chat.turn.schemas import ChatTurnIn
from chatbot.chat.turn.stream import stream_model
from chatbot.chat.turn.tasks import close_turn, open_turn
from chatbot.framework.enums.memory import MemoryScene
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.framework.utils.snowflake import next_id
from chatbot.system.auth.service import user_api_key
from chatbot.system.ratelimit.limiter import Permit, get_chat_limiter

_REJECT_TEXT = "系统繁忙，请稍后再试"
_STOPPED_TEXT = "（已停止）"
_FAILED_TEXT = "回复失败"


async def chat_events(
    request,
    user_id: UUID,
    data: ChatTurnIn,
    *,
    sessions=None,
    limiter=None,
    stream_reply: Callable[..., AsyncIterator[tuple[str, str]]] | None = None,
    read_image: Callable[[str], Awaitable[tuple[bytes, str]]] | None = None,
) -> AsyncIterator[str]:
    parts = [part.model_dump(exclude_none=True) for part in data.parts]
    task_id = next_id()
    conversation_id = data.conversation_id or next_id()
    handle = await open_turn(task_id, user_id)
    gate = limiter or get_chat_limiter()
    reply = stream_reply or stream_model
    load_image = read_image or fetch_image
    opener = sessions or (lambda: session_scope(request))
    permit: Permit | None = None
    watcher = asyncio.create_task(_watch_disconnect(request, handle.cancel))
    try:
        permit = await gate.acquire(handle.cancel)
        if permit is None:
            if handle.cancel.is_set():
                yield _event("done", "[DONE]")
                return
            async for event in _reject(opener, user_id, data.persona_id, conversation_id, task_id, parts):
                yield event
            return
        async for event in _speak(
            opener,
            user_id,
            data.persona_id,
            conversation_id,
            task_id,
            parts,
            handle.cancel,
            reply,
            load_image,
        ):
            yield event
    finally:
        watcher.cancel()
        try:
            await watcher
        except asyncio.CancelledError:
            pass
        if permit is not None:
            await permit.release()
        await close_turn(task_id)


async def _watch_disconnect(request, cancel: asyncio.Event) -> None:
    if request is None:
        return
    while not cancel.is_set():
        try:
            gone = await request.is_disconnected()
        except Exception:
            return
        if gone:
            cancel.set()
            return
        await asyncio.sleep(0.2)


async def _reject(opener, user_id, persona_id, conversation_id, task_id, parts) -> AsyncIterator[str]:
    async with opener() as session:
        conversation = await place_conversation(
            session,
            user_id=user_id,
            persona_id=persona_id,
            conversation_id=conversation_id,
            title=turn_title(parts),
        )
        await add_message(session, conversation.id, {"user_id": user_id, "role": "user", "parts": parts})
        message = await add_message(
            session,
            conversation.id,
            {
                "user_id": user_id,
                "role": "assistant",
                "status": "rejected",
                "parts": [{"text": _REJECT_TEXT}],
            },
        )
        title = conversation.title
        message_id = message.id
    yield _event("meta", {"conversation_id": str(conversation_id), "task_id": str(task_id)})
    yield _event("reject", {"type": "response", "text": _REJECT_TEXT})
    yield _event("finish", {"message_id": str(message_id), "title": title, "status": "rejected"})
    yield _event("done", "[DONE]")


async def _speak(
    opener,
    user_id,
    persona_id,
    conversation_id,
    task_id,
    parts,
    cancel,
    reply,
    load_image,
) -> AsyncIterator[str]:
    response: list[str] = []
    thought: list[str] = []
    signature: str | None = None
    owned_id = conversation_id
    title = ""
    try:
        async with opener() as session:
            conversation = await _open_for_reply(session, user_id, persona_id, conversation_id, parts)
            persona = await linked_persona(session, persona_id, user_id)
            history = await list_messages(session, conversation.id, user_id)
            if not history and persona.greeting.strip():
                await add_message(
                    session,
                    conversation.id,
                    {"user_id": user_id, "role": "assistant", "parts": [{"text": persona.greeting.strip()}]},
                )
            window = await uncovered_messages(session, conversation)
            api_key = await user_api_key(session, user_id)
            cut = slide_until(window)
            if cut is not None:
                await flush_through(session, create_memory(api_key), conversation, cut)
                window = await uncovered_messages(session, conversation)
            await add_message(session, conversation.id, {"user_id": user_id, "role": "user", "parts": parts})
            summary = await session.get(ConversationSummary, conversation.id)
            summary_text = summary.content if summary is not None else ""
            card = _card(persona)
            prior = [_Saved(message.role, list(message.parts)) for message in window]
            title = conversation.title
            owned_id = conversation.id
        yield _event("meta", {"conversation_id": str(owned_id), "task_id": str(task_id)})
        loaded = _memories(api_key, user_id, persona_id, turn_query(parts))
        images = await _images(prior, parts, load_image)
        prompt = build_prompt(card, summary_text, prior, loaded, parts, images)
        stopped = False
        iterator = reply(prompt, api_key).__aiter__()
        try:
            while True:
                incoming = asyncio.create_task(iterator.__anext__())
                waiter = asyncio.create_task(cancel.wait())
                done, pending = await asyncio.wait({incoming, waiter}, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                if incoming not in done:
                    stopped = True
                    break
                try:
                    kind, text, piece_signature = _piece(incoming.result())
                except StopAsyncIteration:
                    break
                if kind == "thought":
                    thought.append(text)
                    if piece_signature:
                        signature = piece_signature
                else:
                    response.append(text)
                yield _event("message", {"type": "thought" if kind == "thought" else "response", "text": text})
                if cancel.is_set():
                    stopped = True
                    break
        finally:
            close = getattr(iterator, "aclose", None)
            if close is not None:
                try:
                    await close()
                except Exception:
                    pass
        status = "stopped" if stopped or cancel.is_set() else "normal"
        message = await _save_assistant(
            opener, user_id, owned_id, status, "".join(thought), "".join(response), signature
        )
    except Exception:
        message = await _save_failed(opener, user_id, owned_id, "".join(thought), "".join(response), signature)
        yield _event(
            "finish",
            {"message_id": "" if message is None else str(message.id), "title": title, "status": "failed"},
        )
        yield _event("done", "[DONE]")
        return
    yield _event("finish", {"message_id": str(message.id), "title": title, "status": message.status})
    yield _event("done", "[DONE]")


async def _open_for_reply(session, user_id, persona_id, conversation_id, parts):
    from chatbot.chat.models import Conversation

    existing = await session.get(Conversation, conversation_id)
    if existing is not None:
        conversation = await _owned(session, conversation_id, user_id)
        if conversation.persona_id != persona_id:
            raise BizException("会话不属于这个人设", code=BizCode.BAD_REQUEST)
        return conversation
    return await save_conversation(
        session,
        {
            "user_id": user_id,
            "persona_id": persona_id,
            "conversation_id": conversation_id,
            "question": turn_title(parts),
        },
    )


class _Saved:
    def __init__(self, role: str, parts: list) -> None:
        self.role = role
        self.parts = parts


def _card(persona: Persona):
    from types import SimpleNamespace

    return SimpleNamespace(
        name=persona.name,
        description=persona.description,
        personality=persona.personality,
        scenario=persona.scenario,
        example_dialogue=persona.example_dialogue,
        system_prompt=persona.system_prompt,
        post_history=persona.post_history,
        portrait_url=persona.portrait_url,
    )


def _piece(item: tuple) -> tuple[str, str, str | None]:
    signature = item[2] if len(item) > 2 else None
    return item[0], item[1], signature if isinstance(signature, str) and signature.strip() else None


async def _save_failed(opener, user_id, conversation_id, thought: str, response: str, signature: str | None):
    try:
        return await _save_assistant(opener, user_id, conversation_id, "failed", thought, response, signature)
    except Exception:
        return None


async def _save_assistant(
    opener, user_id, conversation_id, status: str, thought: str, response: str, signature: str | None
):
    saved_parts: list[dict] = []
    if thought.strip():
        part = {"text": thought.strip(), "thought": True}
        if signature:
            part["thought_signature"] = signature
        saved_parts.append(part)
    body = response.strip()
    if not body:
        body = _STOPPED_TEXT if status == "stopped" else _FAILED_TEXT if status == "failed" else body
    if body:
        saved_parts.append({"text": body})
    if not saved_parts:
        saved_parts.append({"text": _STOPPED_TEXT if status == "stopped" else _FAILED_TEXT})
    async with opener() as session:
        return await add_message(
            session,
            conversation_id,
            {"user_id": user_id, "role": "assistant", "status": status, "parts": saved_parts},
        )


def _memories(api_key: str, user_id, persona_id: int, query: str):
    memory = create_memory(api_key)
    return load_memory(
        memory,
        {"user_id": user_id, "persona_id": persona_id, "scene": MemoryScene.PRIVATE, "query": query},
    )


async def _images(history, parts, load_image) -> dict[str, tuple[bytes, str]]:
    urls: list[str] = []
    for message in history:
        urls.extend(_image_urls(message.parts))
    urls.extend(_image_urls(parts))
    images: dict[str, tuple[bytes, str]] = {}
    for url in dict.fromkeys(urls):
        images[url] = await load_image(url)
    return images


def _image_urls(parts) -> list[str]:
    urls: list[str] = []
    rows = parts if isinstance(parts, list) else []
    for part in rows:
        if hasattr(part, "model_dump"):
            part = part.model_dump(exclude_none=True)
        if not isinstance(part, dict):
            continue
        image = part.get("image")
        if isinstance(image, dict) and isinstance(image.get("url"), str):
            urls.append(image["url"])
    return urls


def _event(name: str, data: object) -> str:
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    return f"event: {name}\ndata: {payload}\n\n"
