import asyncio
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import pytest

from chatbot.chat.context.flush import dialogue, finished_span, is_idle, prepare_consolidation, slide_until
from chatbot.chat.llm_pipeline.candidates import MemoryDecision, parse_candidates, parse_decisions
from chatbot.chat.memory.consolidate import apply_decisions, comparison_memories
from chatbot.framework.exceptions.biz import BizException

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
PERSONA_ID = 42
NOW = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)


def test_idle_starts_at_thirty_minutes() -> None:
    assert is_idle(NOW - timedelta(minutes=30), NOW)
    assert not is_idle(NOW - timedelta(minutes=29), NOW)
    assert not is_idle(None, NOW)


def test_finished_span_requires_latest_assistant() -> None:
    done = _message(1, "assistant", "normal", "好")
    waiting = _message(2, "user", "normal", "再问一句")
    streaming = _message(3, "assistant", "streaming", "还在想")
    assert finished_span([done], require_latest=True) == [done]
    assert finished_span([done, waiting], require_latest=True) == []
    assert finished_span([done, streaming], require_latest=True) == []
    assert [item.id for item in finished_span([done, waiting], require_latest=False)] == [1]


def test_slide_until_keeps_the_tail_that_fits() -> None:
    older = _message(1, "user", "normal", "旧")
    done = _message(2, "assistant", "normal", "答完")
    recent_user = _message(3, "user", "normal", "新问题")
    recent = _message(4, "assistant", "normal", "新回答")
    assert slide_until([older, done, recent_user, recent], limit=len("新问题") + len("新回答")) == 2
    assert slide_until([older, done], limit=100) is None


def test_slide_until_ignores_unfinished_assistant() -> None:
    done = _message(1, "assistant", "normal", "好" * 20)
    streaming = _message(2, "assistant", "streaming", "还在想")
    assert slide_until([done, streaming], limit=1) == 1


def test_dialogue_skips_thoughts() -> None:
    message = _message(1, "user", "normal", "")
    message.parts = [{"text": "先想一下", "thought": True}, {"text": "我住在上海"}]
    assert dialogue([message]) == "user: 我住在上海"


def test_parse_candidates_dedupes_and_defaults_date() -> None:
    raw = """说明
    {"items":[
      {"text":"住在上海","topic":"居住","identity":true,"valid_from":"2026-02-01"},
      {"text":"住在上海","topic":"居住","identity":true},
      {"text":"  喜欢咖啡  ","identity":false,"valid_from":"不是日期"}
    ]}"""
    rows = parse_candidates(raw, date(2026, 11, 25))
    assert [(row.text, row.identity, row.valid_from) for row in rows] == [
        ("住在上海", True, date(2026, 2, 1)),
        ("喜欢咖啡", False, date(2026, 11, 25)),
    ]


def test_parse_decisions_unknown_action_is_new() -> None:
    raw = '{"items":[{"action":"repeat","memory_id":"m1"},{"action":"maybe"},{"action":"replace"}]}'
    assert parse_decisions(raw, 3) == [
        MemoryDecision("repeat", "m1"),
        MemoryDecision("new", None),
        MemoryDecision("new", None),
    ]


def test_parse_candidates_rejects_non_json() -> None:
    with pytest.raises(BizException, match="模型没有返回 JSON"):
        parse_candidates("没有 JSON", date(2026, 11, 25))


def test_comparison_keeps_current_scene_and_topic() -> None:
    memory = _FakeMemory()
    memory.search_rows = [
        _row("past", "住过北京", status="past", kind="fact", scene="private", identity=False),
        _row("work", "在写方案", status="current", kind="episode", scene="work", identity=False),
        _row("late", "住在上海", status="current", kind="episode", scene="private", identity=False),
        _row("fact", "每周三开会", status="current", kind="fact", scene="private", identity=False),
        _row("name", "名字是林", status="current", kind="fact", scene="private", identity=True),
    ]
    memory.topic_rows = [_row("old-home", "住在北京", status="current", kind="fact", scene="private", identity=False, topic="居住")]
    candidate = parse_candidates(
        '{"items":[{"text":"住在上海浦东","topic":"居住","identity":false}]}',
        date(2026, 11, 25),
    )[0]
    found = comparison_memories(memory, USER_ID, PERSONA_ID, "private", candidate)
    assert [item.id for item in found] == ["late", "fact", "old-home"]


def test_apply_repeat_replace_and_unknown_id() -> None:
    memory = _FakeMemory()
    candidate = parse_candidates(
        '{"items":[{"text":"住在上海浦东","topic":"居住","identity":false,"valid_from":"2026-03-01"}]}',
        date(2026, 11, 25),
    )[0]
    neighbor = comparison_memories(
        _loaded(),
        USER_ID,
        PERSONA_ID,
        "private",
        candidate,
    )[0]
    apply_decisions(
        memory,
        user_id=USER_ID,
        persona_id=PERSONA_ID,
        scene="private",
        conversation_id=7,
        rows=[
            (candidate, [neighbor], MemoryDecision("repeat", "late")),
            (candidate, [neighbor], MemoryDecision("replace", "missing")),
        ],
    )
    assert memory.updated == ("late", {"repeat_count": 3, "kind": "fact"})
    assert memory.added[0] == "住在上海浦东"
    assert memory.added[1]["infer"] is False
    assert memory.added[1]["metadata"]["kind"] == "episode"


def test_extract_does_not_receive_summary() -> None:
    seen: dict[str, str] = {}

    async def summarize(dialogue_text: str, previous: str) -> str:
        seen["previous"] = previous
        seen["summary_dialogue"] = dialogue_text
        return "新的摘要"

    async def extract(dialogue_text: str, on) -> list:
        seen["extract"] = dialogue_text
        seen["on"] = on.isoformat()
        return []

    async def run() -> str:
        text, rows = await prepare_consolidation(
            _FakeMemory(),
            user_id=USER_ID,
            persona_id=PERSONA_ID,
            scene="private",
            dialogue_text="user: 我住在上海",
            previous="旧摘要",
            on=date(2026, 11, 25),
            summarize=summarize,
            extract=extract,
            classify=None,
        )
        assert rows == []
        return text

    assert asyncio.run(run()) == "新的摘要"
    assert seen["previous"] == "旧摘要"
    assert seen["extract"] == "user: 我住在上海"
    assert "旧摘要" not in seen["extract"]


class _FakeMemory:
    def __init__(self) -> None:
        self.added = None
        self.updated = None
        self.search_rows: list[dict] = []
        self.topic_rows: list[dict] = []

    def add(self, text, **kwargs):
        self.added = (text, kwargs)
        return {"results": [{"id": "new", "memory": text, "event": "ADD"}]}

    def update(self, memory_id, metadata=None):
        self.updated = (memory_id, metadata)
        return {"message": "ok"}

    def search(self, query, *, filters, top_k):
        del query, filters, top_k
        return {"results": self.search_rows}

    def get_all(self, *, filters, top_k):
        del top_k
        if "topic" in filters:
            return {"results": self.topic_rows}
        return {"results": []}


def _loaded() -> _FakeMemory:
    memory = _FakeMemory()
    memory.search_rows = [_row("late", "住在上海", status="current", kind="episode", scene="private", identity=False, repeat_count=2)]
    return memory


def _row(memory_id: str, text: str, **metadata) -> dict:
    metadata.setdefault("valid_from", "2026-01-01")
    metadata.setdefault("repeat_count", 1)
    metadata.setdefault("topic", "居住")
    return {"id": memory_id, "memory": text, "metadata": metadata}


def _message(message_id: int, role: str, status: str, text: str):
    return SimpleNamespace(
        id=message_id,
        role=role,
        status=status,
        parts=[{"text": text}] if text else [],
        created_at=NOW,
    )
