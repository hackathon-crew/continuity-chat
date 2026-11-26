"""把还没盖住的原文写成摘要和长期记忆。

摘要和候选短句各读原文，互不使用对方的输出。
新建会话、静默满 30 分钟、删除会话，以及窗口滑到指定左界时，都走这里。
会话还没有场景字段，写入使用 private。
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.chat.context.service import save_summary, uncovered_messages
from chatbot.chat.llm_pipeline.consolidate import classify_candidates, extract_candidates, generate_summary
from chatbot.chat.memory.consolidate import apply_decisions, comparison_memories
from chatbot.chat.memory.mem0 import create_memory
from chatbot.chat.models import Conversation, ConversationSummary, Message
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.enums.memory import MemoryScene
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.auth.service import user_api_key
from chatbot.system.user.schemas import parse_user_id

logger = logging.getLogger(__name__)

IDLE_AFTER = timedelta(minutes=30)
SWEEP_EVERY = timedelta(seconds=60)
WINDOW_TEXT_LIMIT = 32_000
_FINISHED = frozenset({"normal", "stopped"})


def is_idle(last_message_at: datetime | None, now: datetime, after: timedelta = IDLE_AFTER) -> bool:
    return last_message_at is not None and last_message_at <= now - after


def finished_span(messages: list[Message], *, require_latest: bool) -> list[Message]:
    """保留以一条已完成助手回复结尾的原文。require_latest 时，最后一条本身必须是这条回复。"""
    if not messages:
        return []
    if require_latest:
        last = messages[-1]
        if _finished_assistant(last):
            return messages
        return []
    end = None
    for index, message in enumerate(messages):
        if _finished_assistant(message):
            end = index
    if end is None:
        return []
    return messages[: end + 1]


def dialogue(messages: list[Message]) -> str:
    lines: list[str] = []
    for message in messages:
        text = message_text(message)
        if text:
            lines.append(f"{message.role}: {text}")
    return "\n".join(lines)


def slide_until(messages: list[Message], limit: int = WINDOW_TEXT_LIMIT) -> int | None:
    """窗口正文超过上限时，返回新的左界。该条是已完成的助手回复，它之后的原文留下。"""
    if _text_size(messages) <= limit:
        return None
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        tail = messages[index + 1 :]
        if _finished_assistant(message) and tail and _text_size(tail) <= limit:
            return message.id
    for message in messages[:-1]:
        if _finished_assistant(message):
            return message.id
    return None


def message_text(message: Message) -> str:
    parts = message.parts if isinstance(message.parts, list) else []
    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict) or part.get("thought") is True:
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            chunks.append(text.strip())
            continue
        file = part.get("file")
        if isinstance(file, dict) and isinstance(file.get("text"), str) and file["text"].strip():
            chunks.append(file["text"].strip())
    return "\n".join(chunks)


async def prepare_consolidation(
    memory,
    *,
    user_id,
    persona_id: int,
    scene: str,
    dialogue_text: str,
    previous: str,
    on,
    summarize=generate_summary,
    extract=extract_candidates,
    classify=classify_candidates,
):
    """生成摘要和分类结果。此时还不写 Mem0。抽取只接收原文。"""
    summary, candidates = await asyncio.gather(
        summarize(dialogue_text, previous),
        extract(dialogue_text, on),
    )
    if not isinstance(summary, str) or not summary.strip():
        raise BizException("摘要生成失败", code=BizCode.BAD_GATEWAY)
    if not isinstance(candidates, list):
        raise BizException("候选短句无效", code=BizCode.BAD_GATEWAY)
    if not candidates:
        return summary.strip(), []
    prepared = [
        (candidate, comparison_memories(memory, user_id, persona_id, scene, candidate)) for candidate in candidates
    ]
    decisions = await classify(prepared)
    if len(decisions) != len(prepared):
        raise BizException("记忆分类无效", code=BizCode.BAD_GATEWAY)
    rows = [(candidate, neighbors, decision) for (candidate, neighbors), decision in zip(prepared, decisions, strict=True)]
    return summary.strip(), rows


async def write_consolidation(
    memory,
    *,
    user_id,
    persona_id: int,
    scene: str,
    conversation_id: int,
    dialogue_text: str,
    previous: str,
    on,
    summarize=generate_summary,
    extract=extract_candidates,
    classify=classify_candidates,
) -> str:
    text, rows = await prepare_consolidation(
        memory,
        user_id=user_id,
        persona_id=persona_id,
        scene=scene,
        dialogue_text=dialogue_text,
        previous=previous,
        on=on,
        summarize=summarize,
        extract=extract,
        classify=classify,
    )
    if rows:
        apply_decisions(
            memory,
            user_id=user_id,
            persona_id=persona_id,
            scene=scene,
            conversation_id=conversation_id,
            rows=rows,
        )
    return text


async def flush_conversation(
    session: AsyncSession,
    memory,
    conversation: Conversation,
    *,
    scene: str = MemoryScene.PRIVATE,
    require_latest: bool = True,
    now: datetime | None = None,
    check_idle: bool = False,
    summarize=generate_summary,
    extract=extract_candidates,
    classify=classify_candidates,
) -> bool:
    if check_idle and not is_idle(conversation.last_message_at, now or datetime.now(UTC)):
        return False
    messages = finished_span(await uncovered_messages(session, conversation), require_latest=require_latest)
    script = dialogue(messages)
    if not script:
        return False
    if check_idle and not await _still_idle(session, conversation.id, now or datetime.now(UTC)):
        return False
    summarize, extract, classify = await _model_calls(
        session, conversation.user_id, scene, summarize, extract, classify
    )
    summary = await session.get(ConversationSummary, conversation.id)
    text, rows = await prepare_consolidation(
        memory,
        user_id=conversation.user_id,
        persona_id=conversation.persona_id,
        scene=scene,
        dialogue_text=script,
        previous=summary.content if summary is not None else "",
        on=datetime.now(UTC).date(),
        summarize=summarize,
        extract=extract,
        classify=classify,
    )
    if check_idle and not await _still_idle(session, conversation.id, now or datetime.now(UTC)):
        return False
    if rows:
        apply_decisions(
            memory,
            user_id=conversation.user_id,
            persona_id=conversation.persona_id,
            scene=scene,
            conversation_id=conversation.id,
            rows=rows,
        )
    await save_summary(
        session,
        conversation.id,
        {"user_id": conversation.user_id, "content": text, "until_message_id": messages[-1].id},
    )
    return True


async def flush_through(
    session: AsyncSession,
    memory,
    conversation: Conversation,
    until_message_id: int,
    *,
    scene: str = MemoryScene.PRIVATE,
    summarize=generate_summary,
    extract=extract_candidates,
    classify=classify_candidates,
) -> bool:
    """窗口滑动时写入。until_message_id 必须是尚未盖住的一条已完成助手回复。"""
    messages = await uncovered_messages(session, conversation)
    until = next((message for message in messages if message.id == until_message_id), None)
    if until is None or not _finished_assistant(until):
        raise BizException("切点必须是一条已完成的助手回复", code=BizCode.BAD_REQUEST)
    chosen = [message for message in messages if (message.created_at, message.id) <= (until.created_at, until.id)]
    script = dialogue(chosen)
    if not script:
        return False
    summarize, extract, classify = await _model_calls(
        session, conversation.user_id, scene, summarize, extract, classify
    )
    summary = await session.get(ConversationSummary, conversation.id)
    text = await write_consolidation(
        memory,
        user_id=conversation.user_id,
        persona_id=conversation.persona_id,
        scene=scene,
        conversation_id=conversation.id,
        dialogue_text=script,
        previous=summary.content if summary is not None else "",
        on=datetime.now(UTC).date(),
        summarize=summarize,
        extract=extract,
        classify=classify,
    )
    await save_summary(
        session,
        conversation.id,
        {"user_id": conversation.user_id, "content": text, "until_message_id": chosen[-1].id},
    )
    return True


async def flush_if_present(session: AsyncSession, conversation: Conversation, *, require_latest: bool, memory=None) -> bool:
    script = dialogue(finished_span(await uncovered_messages(session, conversation), require_latest=require_latest))
    if not script:
        return False
    client = memory if memory is not None else create_memory(await user_api_key(session, conversation.user_id))
    return await flush_conversation(session, client, conversation, require_latest=require_latest)


async def flush_pending(session: AsyncSession, user_id, *, memory=None) -> None:
    """新建会话前，把该用户其他已完成会话里还没盖住的原文写入。"""
    owner_id = parse_user_id(user_id)
    rows = list(
        await session.scalars(
            select(Conversation).where(Conversation.user_id == owner_id, Conversation.deleted_at.is_(None))
        )
    )
    targets: list[Conversation] = []
    for conversation in rows:
        script = dialogue(finished_span(await uncovered_messages(session, conversation), require_latest=True))
        if script:
            targets.append(conversation)
    if not targets:
        return
    client = memory if memory is not None else create_memory(await user_api_key(session, owner_id))
    for conversation in targets:
        await flush_conversation(session, client, conversation)


async def sweep_idle(session_factory, *, now: datetime | None = None, memory_factory=create_memory) -> None:
    moment = now or datetime.now(UTC)
    async with session_factory() as session:
        rows = list(
            await session.scalars(
                select(Conversation).where(
                    Conversation.deleted_at.is_(None),
                    Conversation.last_message_at.is_not(None),
                    Conversation.last_message_at <= moment - IDLE_AFTER,
                )
            )
        )
        pending: list[int] = []
        for conversation in rows:
            script = dialogue(finished_span(await uncovered_messages(session, conversation), require_latest=True))
            if script:
                pending.append(conversation.id)
    if not pending:
        return
    for conversation_id in pending:
        async with session_factory() as session:
            try:
                conversation = await session.get(Conversation, conversation_id)
                if conversation is None or conversation.deleted_at is not None:
                    continue
                client = memory_factory(await user_api_key(session, conversation.user_id))
                await flush_conversation(session, client, conversation, now=moment, check_idle=True)
                await session.commit()
            except BizException as error:
                await session.rollback()
                if error.code == BizCode.INTERNAL_ERROR:
                    logger.warning("静默记忆写入缺少记忆服务配置")
                    return
                logger.exception("静默记忆写入失败 conversation=%s", conversation_id)
            except Exception:
                await session.rollback()
                logger.exception("静默记忆写入失败 conversation=%s", conversation_id)


async def _model_calls(session, user_id, scene, summarize, extract, classify):
    """默认的摘要、抽取和分类使用该用户的 Key。摘要提示词按这场场景选择。测试传入的替身保持原样。"""
    if (
        summarize is not generate_summary
        and extract is not extract_candidates
        and classify is not classify_candidates
    ):
        return summarize, extract, classify
    api_key = await user_api_key(session, user_id)
    if summarize is generate_summary:
        async def summarize(dialogue_text, previous, key=api_key, scene=scene):
            return await generate_summary(dialogue_text, previous, key, scene)
    if extract is extract_candidates:
        async def extract(dialogue_text, on, key=api_key):
            return await extract_candidates(dialogue_text, on, key)
    if classify is classify_candidates:
        async def classify(rows, key=api_key):
            return await classify_candidates(rows, key)
    return summarize, extract, classify


def _text_size(messages: list[Message]) -> int:
    return sum(len(message_text(message)) for message in messages)


def _finished_assistant(message: Message) -> bool:
    return message.role == "assistant" and message.status in _FINISHED


async def _still_idle(session: AsyncSession, conversation_id: int, now: datetime) -> bool:
    conversation = await session.get(Conversation, conversation_id)
    return conversation is not None and conversation.deleted_at is None and is_idle(conversation.last_message_at, now)
