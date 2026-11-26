"""摘要、候选短句和分类结论的解析。不调用模型，也不写记忆。"""

import json
from dataclasses import dataclass
from datetime import date

from chatbot.chat.memory.schemas import TEXT_MAX, TOPIC_MAX
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException

_NEW = "new"
_REPEAT = "repeat"
_REPLACE = "replace"


@dataclass(frozen=True)
class MemoryCandidate:
    text: str
    topic: str | None
    identity: bool
    valid_from: date


@dataclass(frozen=True)
class MemoryDecision:
    action: str
    memory_id: str | None


def parse_candidates(text: str, on: date) -> list[MemoryCandidate]:
    rows = _items(text, "候选短句无效")
    found: list[MemoryCandidate] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        candidate = _candidate(row, on)
        if candidate is None or candidate.text in seen:
            continue
        seen.add(candidate.text)
        found.append(candidate)
    return found


def parse_decisions(text: str, count: int) -> list[MemoryDecision]:
    rows = _items(text, "记忆分类无效")
    decisions: list[MemoryDecision] = []
    for index in range(count):
        row = rows[index] if index < len(rows) and isinstance(rows[index], dict) else {}
        action = row.get("action")
        memory_id = row.get("memory_id")
        if action in {_REPEAT, _REPLACE} and isinstance(memory_id, str) and memory_id.strip():
            decisions.append(MemoryDecision(action, memory_id.strip()))
        else:
            decisions.append(MemoryDecision(_NEW, None))
    return decisions


def _items(text: str, invalid: str) -> list:
    payload = _object(text)
    rows = payload.get("items")
    if not isinstance(rows, list):
        raise BizException(invalid, code=BizCode.BAD_GATEWAY)
    return rows


def _object(text: str) -> dict:
    raw = text.strip() if isinstance(text, str) else ""
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        raise BizException("模型没有返回 JSON", code=BizCode.BAD_GATEWAY)
    try:
        payload = json.loads(raw[start : end + 1])
    except json.JSONDecodeError as error:
        raise BizException("模型没有返回 JSON", code=BizCode.BAD_GATEWAY) from error
    if not isinstance(payload, dict):
        raise BizException("模型没有返回 JSON", code=BizCode.BAD_GATEWAY)
    return payload


def _candidate(row: dict, on: date) -> MemoryCandidate | None:
    text = row.get("text")
    if not isinstance(text, str):
        return None
    cleaned = " ".join(text.split())
    if not cleaned:
        return None
    return MemoryCandidate(
        text=cleaned[:TEXT_MAX],
        topic=_topic(row.get("topic")),
        identity=row.get("identity") is True,
        valid_from=_day(row.get("valid_from"), on),
    )


def _topic(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    return text[:TOPIC_MAX]


def _day(value: object, on: date) -> date:
    if not isinstance(value, str) or not value.strip():
        return on
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return on
