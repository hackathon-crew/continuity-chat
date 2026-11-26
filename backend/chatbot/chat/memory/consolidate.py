"""把分类结论写成长期记忆。对照集只含仍然有效的记录。"""

from uuid import UUID

from chatbot.chat.llm_pipeline.candidates import MemoryCandidate, MemoryDecision
from chatbot.chat.memory.mem0 import call_memory
from chatbot.chat.memory.service import (
    _LIST_FETCH,
    MemoryItem,
    _items,
    _list,
    _scope,
    add_memory,
    close_memory,
    repeat_memory,
)
from chatbot.framework.enums.memory import MemoryField, MemoryKind, MemoryStatus

_SEARCH_KEEP = 8
_NEW = "new"
_REPEAT = "repeat"
_REPLACE = "replace"


def comparison_memories(memory, user_id: UUID, persona_id: int, scene: str, candidate: MemoryCandidate) -> list[MemoryItem]:
    scope = _scope(user_id, persona_id)
    searched = _items(
        call_memory(
            lambda: memory.search(
                candidate.text,
                filters={**scope, MemoryField.STATUS: MemoryStatus.CURRENT},
                top_k=_LIST_FETCH,
            )
        )
    )
    kept = [item for item in searched if _matches(item, scene, candidate.identity)][:_SEARCH_KEEP]
    seen = {item.id for item in kept}
    if candidate.topic is None:
        return kept
    for item in _list(memory, {**scope, MemoryField.TOPIC: candidate.topic}):
        if item.id in seen or item.topic != candidate.topic or not _matches(item, scene, candidate.identity):
            continue
        seen.add(item.id)
        kept.append(item)
    return kept


def apply_decisions(
    memory,
    *,
    user_id: UUID,
    persona_id: int,
    scene: str,
    conversation_id: int,
    rows: list[tuple[MemoryCandidate, list[MemoryItem], MemoryDecision]],
) -> None:
    counts: dict[str, int] = {}
    closed: set[str] = set()
    for _candidate, neighbors, _decision in rows:
        for item in neighbors:
            counts.setdefault(item.id, item.repeat_count)
    for candidate, neighbors, decision in rows:
        by_id = {item.id: item for item in neighbors}
        action = decision.action
        memory_id = decision.memory_id
        if action in {_REPEAT, _REPLACE} and (memory_id not in by_id or memory_id in closed):
            action = _NEW
        if action == _REPEAT:
            assert memory_id is not None
            repeat_count = counts.get(memory_id, by_id[memory_id].repeat_count) + 1
            payload: dict = {"memory_id": memory_id, "repeat_count": repeat_count}
            if candidate.identity:
                payload["identity"] = True
            repeat_memory(memory, payload)
            counts[memory_id] = repeat_count
        elif action == _REPLACE:
            assert memory_id is not None
            close_memory(memory, {"memory_id": memory_id, "valid_to": candidate.valid_from})
            closed.add(memory_id)
            _add(memory, user_id, persona_id, scene, conversation_id, candidate)
        else:
            _add(memory, user_id, persona_id, scene, conversation_id, candidate)


def _matches(item: MemoryItem, scene: str, identity: bool) -> bool:
    if item.status != MemoryStatus.CURRENT:
        return False
    if identity:
        return item.identity or item.kind == MemoryKind.PERSONA
    return item.scene == scene and not item.identity and item.kind in {MemoryKind.EPISODE, MemoryKind.FACT}


def _add(memory, user_id: UUID, persona_id: int, scene: str, conversation_id: int, candidate: MemoryCandidate) -> None:
    payload: dict = {
        "user_id": user_id,
        "persona_id": persona_id,
        "text": candidate.text,
        "scene": scene,
        "valid_from": candidate.valid_from,
        "identity": candidate.identity,
        "conversation_id": conversation_id,
    }
    if candidate.topic is not None:
        payload["topic"] = candidate.topic
    add_memory(memory, payload)
