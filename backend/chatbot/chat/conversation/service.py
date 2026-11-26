"""会话的列出、创建、重命名和删除。

首次保存时调用模型，根据这条问题生成标题。模型没有返回可用标题时，改用问题原文。
新建前，先把该用户其他已完成会话里还没盖住的原文写入长期记忆。
删除前同样写入，再删除原文和摘要。用户来自登录会话，标题和补写使用该用户的 Key。
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.chat.context.flush import flush_if_present, flush_pending
from chatbot.chat.persona.service import linked_persona
from chatbot.chat.conversation.schemas import (
    ConversationRename,
    ConversationSave,
    parse_conversation_id,
    parse_model,
    parse_user_id,
    title_from_question,
)
from chatbot.chat.llm_pipeline import generate_title
from chatbot.chat.models import Conversation, ConversationSummary, Message
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.auth.service import user_api_key


async def list_conversations(session: AsyncSession, user_id: UUID | str) -> list[Conversation]:
    owner_id = parse_user_id(user_id)
    rows = await session.scalars(
        select(Conversation)
        .where(Conversation.user_id == owner_id, Conversation.deleted_at.is_(None))
        .order_by(Conversation.last_message_at.desc().nulls_last(), Conversation.id.desc())
    )
    return list(rows)


async def save_conversation(session: AsyncSession, payload: ConversationSave | dict) -> Conversation:
    data = parse_model(ConversationSave, payload)
    if data.conversation_id is None:
        return await _create(session, data, None)
    existing = await session.get(Conversation, data.conversation_id)
    if existing is None:
        return await _create(session, data, data.conversation_id)
    if existing.deleted_at is not None or existing.user_id != data.user_id:
        raise BizException("会话不存在", code=BizCode.NOT_FOUND)
    if existing.persona_id != data.persona_id:
        raise BizException("会话不属于这个人设", code=BizCode.BAD_REQUEST)
    existing.last_message_at = data.last_message_at or datetime.now(UTC)
    await session.flush()
    return existing


async def place_conversation(
    session: AsyncSession,
    *,
    user_id: UUID | str,
    persona_id: int,
    conversation_id: int,
    title: str,
) -> Conversation:
    """拒绝排队时打开会话。不调用模型，也不补写其他会话。"""
    owner_id = parse_user_id(user_id)
    target_id = parse_conversation_id(conversation_id)
    existing = await session.get(Conversation, target_id)
    if existing is not None:
        if existing.deleted_at is not None or existing.user_id != owner_id:
            raise BizException("会话不存在", code=BizCode.NOT_FOUND)
        if existing.persona_id != persona_id:
            raise BizException("会话不属于这个人设", code=BizCode.BAD_REQUEST)
        return existing
    persona = await linked_persona(session, persona_id, owner_id)
    conversation = Conversation(
        id=target_id,
        user_id=owner_id,
        persona_id=persona.id,
        title=title_from_question(title),
        last_message_at=datetime.now(UTC),
    )
    session.add(conversation)
    try:
        await session.flush()
    except IntegrityError as error:
        raise BizException("用户不存在", code=BizCode.NOT_FOUND) from error
    return conversation


async def rename_conversation(
    session: AsyncSession,
    conversation_id: int | str,
    payload: ConversationRename | dict,
) -> Conversation:
    data = parse_model(ConversationRename, payload)
    conversation = await _owned(session, conversation_id, data.user_id)
    conversation.title = data.title
    await session.flush()
    return conversation


async def delete_conversation(session: AsyncSession, conversation_id: int | str, user_id: UUID | str) -> None:
    conversation = await _owned(session, conversation_id, user_id)
    await flush_if_present(session, conversation, require_latest=False)
    await session.execute(
        delete(ConversationSummary).where(ConversationSummary.conversation_id == conversation.id)
    )
    await session.execute(delete(Message).where(Message.conversation_id == conversation.id))
    conversation.deleted_at = datetime.now(UTC)
    await session.flush()


async def _create(session: AsyncSession, data: ConversationSave, conversation_id: int | None) -> Conversation:
    if data.question is None:
        raise BizException("问题不能为空", code=BizCode.BAD_REQUEST)
    await flush_pending(session, data.user_id)
    persona = await linked_persona(session, data.persona_id, data.user_id)
    conversation = Conversation(
        user_id=data.user_id,
        persona_id=persona.id,
        title=await _title(session, data.user_id, data.question),
        last_message_at=data.last_message_at or datetime.now(UTC),
    )
    if conversation_id is not None:
        conversation.id = conversation_id
    session.add(conversation)
    try:
        await session.flush()
    except IntegrityError as error:
        raise BizException("用户不存在", code=BizCode.NOT_FOUND) from error
    return conversation


async def _title(session: AsyncSession, user_id: UUID, question: str) -> str:
    try:
        return await generate_title([("user", question)], await user_api_key(session, user_id))
    except Exception:
        return title_from_question(question)


async def _owned(session: AsyncSession, conversation_id: int | str, user_id: UUID | str) -> Conversation:
    owner_id = parse_user_id(user_id)
    conversation = await session.get(Conversation, parse_conversation_id(conversation_id))
    if conversation is None or conversation.deleted_at is not None or conversation.user_id != owner_id:
        raise BizException("会话不存在", code=BizCode.NOT_FOUND)
    return conversation
