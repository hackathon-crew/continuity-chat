from datetime import date
from uuid import UUID

import pytest

from chatbot.chat.memory.schemas import MemoryWrite, parse_model
from chatbot.chat.memory.service import add_memory, close_memory, forget_memory, load_memory, repeat_memory
from chatbot.framework.exceptions.biz import BizException

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
PERSONA_ID = 42


class FakeMemory:
    def __init__(self) -> None:
        self.added = None
        self.updated = None
        self.deleted = None
        self.filters = None
        self.self_rows: list[dict] = []
        self.recent_rows: list[dict] = []
        self.topic_rows: list[dict] = []
        self.search_rows: list[dict] = []

    def add(self, text, **kwargs):
        self.added = (text, kwargs)
        return {"results": [{"id": "m1", "memory": text, "event": "ADD"}]}

    def update(self, memory_id, metadata=None):
        self.updated = (memory_id, metadata)
        return {"message": "ok"}

    def delete(self, memory_id):
        self.deleted = memory_id
        return {"message": "ok"}

    def get_all(self, *, filters, top_k):
        self.filters = filters
        if "topic" in filters:
            return {"results": self.topic_rows}
        if filters.get("kind") == "episode":
            return {"results": self.recent_rows}
        return {"results": self.self_rows}

    def search(self, query, *, filters, top_k):
        self.filters = filters
        return {"results": self.search_rows}


def _row(memory_id: str, text: str, **metadata) -> dict:
    return {"id": memory_id, "memory": text, "metadata": metadata}


def _write(**overrides) -> dict:
    data = {
        "user_id": USER_ID,
        "persona_id": PERSONA_ID,
        "text": "住在上海",
        "scene": "private",
        "valid_from": date(2026, 1, 1),
        "conversation_id": 7,
    }
    data.update(overrides)
    return data


def test_add_stores_partition_without_infer() -> None:
    memory = FakeMemory()
    item = add_memory(memory, _write(topic="居住", identity=True, kind="fact"))
    text, kwargs = memory.added
    assert text == "住在上海"
    assert kwargs["infer"] is False
    assert kwargs["user_id"] == str(USER_ID)
    assert kwargs["agent_id"] == str(PERSONA_ID)
    assert kwargs["run_id"] == "7"
    assert "user_id" not in kwargs["metadata"]
    assert kwargs["metadata"]["kind"] == "fact"
    assert kwargs["metadata"]["identity"] is True
    assert kwargs["metadata"]["topic"] == "居住"
    assert kwargs["metadata"]["valid_from"] == "2026-01-01"
    assert item.id == "m1"


def test_add_rejects_blank_text() -> None:
    with pytest.raises(BizException, match="记忆内容不能为空"):
        parse_model(MemoryWrite, _write(text="  "))


def test_repeat_promotes_to_fact_at_three() -> None:
    memory = FakeMemory()
    repeat_memory(memory, {"memory_id": "m1", "repeat_count": 2})
    assert memory.updated == ("m1", {"repeat_count": 2})
    repeat_memory(memory, {"memory_id": "m1", "repeat_count": 3, "identity": True})
    assert memory.updated == ("m1", {"repeat_count": 3, "kind": "fact", "identity": True})


def test_close_marks_past() -> None:
    memory = FakeMemory()
    close_memory(memory, {"memory_id": "m1", "valid_to": date(2026, 6, 1)})
    assert memory.updated == ("m1", {"status": "past", "valid_to": "2026-06-01"})


def test_forget_deletes() -> None:
    memory = FakeMemory()
    forget_memory(memory, {"memory_id": "m1"})
    assert memory.deleted == "m1"


def test_load_memory_returns_three_slots() -> None:
    memory = FakeMemory()
    memory.self_rows = [
        _row("old", "以前住北京", kind="fact", scene="private", status="past", identity=True, valid_from="2016-01-01"),
        _row("name", "叫林夏", kind="fact", scene="private", status="current", identity=True, valid_from="2026-01-01"),
        _row("tone", "说话很短", kind="persona", scene="private", status="current", identity=False, valid_from="2026-02-01"),
        _row("trip", "去了杭州", kind="episode", scene="private", status="current", identity=False, valid_from="2026-03-01"),
    ]
    memory.recent_rows = [
        _row("early", "周一加班", kind="episode", scene="private", status="current", identity=False, valid_from="2026-03-01"),
        _row("late", "周五交稿", kind="episode", scene="private", status="current", identity=False, valid_from="2026-03-05"),
        _row("who", "现在做设计", kind="episode", scene="private", status="current", identity=True, valid_from="2026-03-06"),
        _row("work", "开会", kind="episode", scene="work", status="current", identity=False, valid_from="2026-03-07"),
    ]
    memory.search_rows = [
        _row("name", "叫林夏", kind="fact", scene="private", status="current", identity=True, valid_from="2026-01-01"),
        _row("bj", "住在北京", kind="fact", scene="private", status="past", identity=False, valid_from="2016-01-01", topic="居住"),
    ]
    memory.topic_rows = [
        _row("sh", "住在上海", kind="fact", scene="private", status="current", identity=False, valid_from="2024-01-01", topic="居住"),
        _row("bj", "住在北京", kind="fact", scene="private", status="past", identity=False, valid_from="2016-01-01", topic="居住"),
    ]
    loaded = load_memory(
        memory,
        {"user_id": USER_ID, "persona_id": PERSONA_ID, "scene": "private", "query": "我住过哪里"},
    )
    assert [item.id for item in loaded.self_memories] == ["name", "tone"]
    assert [item.id for item in loaded.recent] == ["late", "early"]
    assert [item.id for item in loaded.associative] == ["bj", "sh"]
    assert loaded.associative[0].status == "past"
