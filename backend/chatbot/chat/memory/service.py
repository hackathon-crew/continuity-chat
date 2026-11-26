"""长期记忆的写入和一次加载。

外部只调用这里的方法。自我、近事、联想和主题补全是这次加载内部的步骤。
infer 关闭，Mem0 不再自己抽取。persona_id 传给 Mem0 时作为 agent_id。
"""

from datetime import date
from typing import Any
from uuid import UUID

from chatbot.chat.memory.mem0 import call_memory
from chatbot.chat.memory.schemas import (
    MemoryClose,
    MemoryForget,
    MemoryItem,
    MemoryLoad,
    MemoryLoaded,
    MemoryRepeat,
    MemoryWrite,
    parse_model,
)
from chatbot.chat.persona.schemas import parse_persona_id
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.enums.memory import FACT_REPEAT, MemoryField, MemoryKind, MemoryScene, MemoryStatus
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.user.schemas import parse_user_id
_SELF_LIMIT = 8
_RECENT_LIMIT = 5
_ASSOCIATIVE_LIMIT = 8
_LIST_FETCH = 50


def add_memory(memory: Any, payload: MemoryWrite | dict) -> MemoryItem:
    data = parse_model(MemoryWrite, payload)
    user_id, agent_id = _scope_ids(data.user_id, data.persona_id)
    result = call_memory(
        lambda: memory.add(
            data.text,
            user_id=user_id,
            agent_id=agent_id,
            run_id=None if data.conversation_id is None else str(data.conversation_id),
            metadata=_metadata(data),
            infer=False,
        )
    )
    rows = result.get("results") if isinstance(result, dict) else None
    if not rows or not isinstance(rows[0], dict) or not rows[0].get("id"):
        raise BizException("记忆没有写入", code=BizCode.BAD_GATEWAY)
    return MemoryItem(
        id=str(rows[0]["id"]),
        text=data.text,
        kind=data.kind,
        scene=data.scene,
        status=data.status,
        identity=data.identity,
        topic=data.topic,
        valid_from=data.valid_from,
        valid_to=data.valid_to,
        repeat_count=data.repeat_count,
    )


def repeat_memory(memory: Any, payload: MemoryRepeat | dict) -> None:
    """累加重复次数。达到三次就把这条升成 fact。身份标记由调用方单独传入。"""
    data = parse_model(MemoryRepeat, payload)
    metadata: dict[str, Any] = {MemoryField.REPEAT_COUNT: data.repeat_count}
    if data.repeat_count >= FACT_REPEAT:
        metadata[MemoryField.KIND] = MemoryKind.FACT
    if "identity" in data.model_fields_set and data.identity is not None:
        metadata[MemoryField.IDENTITY] = data.identity
    _update(memory, data.memory_id, metadata)


def close_memory(memory: Any, payload: MemoryClose | dict) -> None:
    data = parse_model(MemoryClose, payload)
    _update(
        memory,
        data.memory_id,
        {MemoryField.STATUS: MemoryStatus.PAST, MemoryField.VALID_TO: data.valid_to.isoformat()},
    )


def forget_memory(memory: Any, payload: MemoryForget | dict) -> None:
    data = parse_model(MemoryForget, payload)
    call_memory(lambda: memory.delete(data.memory_id))


def load_memory(memory: Any, payload: MemoryLoad | dict) -> MemoryLoaded:
    """取回这一轮要用的长期记忆。自我和近事在前，联想接在当前这句话旁边。"""
    data = parse_model(MemoryLoad, payload)
    scope = _scope(data.user_id, data.persona_id)
    selves = _self_memories(memory, scope)
    recent = _recent_memories(memory, scope, data.scene)
    seen = {item.id for item in selves}
    seen.update(item.id for item in recent)
    associative = _associative(memory, scope, data.scene, data.query, seen) if data.query else []
    return MemoryLoaded(self_memories=selves, recent=recent, associative=associative)


def _self_memories(memory: Any, scope: dict[str, str]) -> list[MemoryItem]:
    rows = _list(
        memory,
        {
            **scope,
            MemoryField.STATUS: MemoryStatus.CURRENT,
            "OR": [{MemoryField.KIND: MemoryKind.PERSONA}, {MemoryField.IDENTITY: True}],
        },
    )
    kept = [
        item
        for item in rows
        if item.status == MemoryStatus.CURRENT and (item.kind == MemoryKind.PERSONA or item.identity)
    ]
    return kept[:_SELF_LIMIT]


def _recent_memories(memory: Any, scope: dict[str, str], scene: str) -> list[MemoryItem]:
    rows = _list(
        memory,
        {
            **scope,
            MemoryField.KIND: MemoryKind.EPISODE,
            MemoryField.STATUS: MemoryStatus.CURRENT,
            MemoryField.SCENE: scene,
            MemoryField.IDENTITY: False,
        },
    )
    kept = [
        item
        for item in rows
        if item.kind == MemoryKind.EPISODE
        and item.status == MemoryStatus.CURRENT
        and item.scene == scene
        and not item.identity
    ]
    kept.sort(key=lambda item: (item.valid_from, item.id), reverse=True)
    return kept[:_RECENT_LIMIT]


def _associative(
    memory: Any,
    scope: dict[str, str],
    scene: str,
    query: str,
    seen: set[str],
) -> list[MemoryItem]:
    result = call_memory(
        lambda: memory.search(
            query,
            filters={**scope, MemoryField.SCENE: scene},
            top_k=min(_LIST_FETCH, _ASSOCIATIVE_LIMIT + len(seen)),
        )
    )
    hits: list[MemoryItem] = []
    for item in _items(result):
        if item.id in seen or item.scene != scene:
            continue
        seen.add(item.id)
        hits.append(item)
        if len(hits) == _ASSOCIATIVE_LIMIT:
            break
    topics = [item.topic for item in hits if item.topic]
    return hits + _expand_topics(memory, scope, topics, seen)


def _expand_topics(
    memory: Any,
    scope: dict[str, str],
    topics: list[str | None],
    seen: set[str],
) -> list[MemoryItem]:
    expanded: list[MemoryItem] = []
    done: set[str] = set()
    for topic in topics:
        if topic is None or topic in done:
            continue
        done.add(topic)
        rows = [
            item
            for item in _list(memory, {**scope, MemoryField.TOPIC: topic})
            if item.topic == topic and item.id not in seen
        ]
        rows.sort(key=lambda item: (item.valid_from, item.id))
        for item in rows:
            seen.add(item.id)
            expanded.append(item)
    return expanded


def _update(memory: Any, memory_id: str, metadata: dict[str, Any]) -> None:
    call_memory(lambda: memory.update(memory_id, metadata=metadata))


def _scope(user_id: UUID | str, persona_id: int | str) -> dict[str, str]:
    owner_id, agent_id = _scope_ids(user_id, persona_id)
    return {"user_id": owner_id, "agent_id": agent_id}


def _scope_ids(user_id: UUID | str, persona_id: int | str) -> tuple[str, str]:
    return str(parse_user_id(user_id)), str(parse_persona_id(persona_id))


def _metadata(data: MemoryWrite) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        MemoryField.KIND: data.kind,
        MemoryField.SCENE: data.scene,
        MemoryField.STATUS: data.status,
        MemoryField.IDENTITY: data.identity,
        MemoryField.VALID_FROM: data.valid_from.isoformat(),
        MemoryField.REPEAT_COUNT: data.repeat_count,
    }
    if data.topic is not None:
        metadata[MemoryField.TOPIC] = data.topic
    if data.valid_to is not None:
        metadata[MemoryField.VALID_TO] = data.valid_to.isoformat()
    return metadata


def _list(memory: Any, filters: dict[str, Any]) -> list[MemoryItem]:
    result = call_memory(lambda: memory.get_all(filters=filters, top_k=_LIST_FETCH))
    return _items(result)


def _items(result: Any) -> list[MemoryItem]:
    rows = result.get("results") if isinstance(result, dict) else None
    if not isinstance(rows, list):
        return []
    items: list[MemoryItem] = []
    for row in rows:
        if isinstance(row, dict):
            item = _item(row)
            if item is not None:
                items.append(item)
    return items


def _item(raw: dict[str, Any]) -> MemoryItem | None:
    text = raw.get("memory")
    memory_id = raw.get("id")
    if not isinstance(text, str) or not text.strip() or not isinstance(memory_id, str) or not memory_id:
        return None
    meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    try:
        valid_from = _date(meta.get(MemoryField.VALID_FROM))
        if valid_from is None:
            return None
        repeat_count = meta.get(MemoryField.REPEAT_COUNT)
        topic = meta.get(MemoryField.TOPIC)
        return MemoryItem(
            id=memory_id,
            text=text.strip(),
            kind=_member(meta.get(MemoryField.KIND), MemoryKind, MemoryKind.EPISODE),
            scene=_member(meta.get(MemoryField.SCENE), MemoryScene, MemoryScene.PRIVATE),
            status=_member(meta.get(MemoryField.STATUS), MemoryStatus, MemoryStatus.CURRENT),
            identity=bool(meta.get(MemoryField.IDENTITY, False)),
            topic=topic if isinstance(topic, str) and topic else None,
            valid_from=valid_from,
            valid_to=_date(meta.get(MemoryField.VALID_TO)),
            repeat_count=repeat_count if _count(repeat_count) else 1,
        )
    except (TypeError, ValueError):
        return None


def _member(value: object, enum: type[MemoryKind] | type[MemoryScene] | type[MemoryStatus], default: str) -> str:
    if isinstance(value, str) and value in enum:
        return value
    return default


def _date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        return date.fromisoformat(value)
    return None


def _count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1
