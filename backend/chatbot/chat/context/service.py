"""保存滑动窗口的左界，并读出左界之后的原文。"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.chat.context.schemas import SummarySave
from chatbot.chat.conversation.schemas import parse_conversation_id, parse_model, parse_user_id
from chatbot.chat.models import Conversation, ConversationSummary, Message
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException


async def save_summary(
    session: AsyncSession,
    conversation_id: int | str,
    payload: SummarySave | dict,
) -> ConversationSummary:
    data = parse_model(SummarySave, payload)
    conversation = await _owned(session, conversation_id, data.user_id)
    if data.until_message_id is not None:
        message = await session.get(Message, data.until_message_id)
        if message is None or message.conversation_id != conversation.id:
            raise BizException("消息不存在", code=BizCode.NOT_FOUND)
    summary = await session.get(ConversationSummary, conversation.id)
    if summary is None:
        summary = ConversationSummary(
            conversation_id=conversation.id,
            until_message_id=data.until_message_id,
            content=data.content,
        )
        session.add(summary)
    else:
        summary.until_message_id = data.until_message_id
        summary.content = data.content
        summary.updated_at = datetime.now(UTC)
    await session.flush()
    return summary


async def uncovered_messages(session: AsyncSession, conversation: Conversation) -> list[Message]:
    """左界之后的原文。没有摘要时，从这场对话的第一条开始。"""
    summary = await session.get(ConversationSummary, conversation.id)
    statement = select(Message).where(Message.conversation_id == conversation.id)
    if summary is not None and summary.until_message_id is not None:
        until = await session.get(Message, summary.until_message_id)
        if until is not None:
            statement = statement.where(
                or_(
                    Message.created_at > until.created_at,
                    and_(Message.created_at == until.created_at, Message.id > until.id),
                )
            )
    statement = statement.order_by(Message.created_at.asc(), Message.id.asc())
    return list(await session.scalars(statement))


async def _owned(session: AsyncSession, conversation_id: int | str, user_id: UUID | str) -> Conversation:
    owner_id = parse_user_id(user_id)
    conversation = await session.get(Conversation, parse_conversation_id(conversation_id))
    if conversation is None or conversation.deleted_at is not None or conversation.user_id != owner_id:
        raise BizException("会话不存在", code=BizCode.NOT_FOUND)
    return conversation
