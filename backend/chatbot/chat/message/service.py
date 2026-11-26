"""消息原文的写入和查询。窗口左界由 context 保存。

倒序并限制条数时，先取最近的消息，再翻回时间正序。
一条消息内部按 parts 的数组顺序返回，不把搜索结果插进正文。
会话不存在或不属于该用户时，查询返回空列表，写入则拒绝。
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.chat.conversation.schemas import parse_conversation_id, parse_model, parse_user_id
from chatbot.chat.message.schemas import MessageCreate, MessageOrder, parse_limit, parse_order
from chatbot.chat.models import Conversation, Message
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException


async def add_message(
    session: AsyncSession,
    conversation_id: int | str,
    payload: MessageCreate | dict,
) -> Message:
    data = parse_model(MessageCreate, payload)
    conversation = await _owned(session, conversation_id, data.user_id)
    message = Message(
        conversation_id=conversation.id,
        role=data.role,
        parts=[part.model_dump(exclude_none=True) for part in data.parts],
        grounding_metadata=_dump(data.grounding_metadata),
        url_context_metadata=_dump(data.url_context_metadata),
        citation_metadata=_dump(data.citation_metadata),
        finish_reason=data.finish_reason,
        status=data.status,
        input_tokens=data.input_tokens,
        output_tokens=data.output_tokens,
    )
    session.add(message)
    await session.flush()
    stamp = message.created_at or datetime.now(UTC)
    if conversation.last_message_at is None or stamp >= conversation.last_message_at:
        conversation.last_message_at = stamp
        await session.flush()
    return message


async def list_messages(
    session: AsyncSession,
    conversation_id: int | str,
    user_id: UUID | str,
    *,
    limit: int | None = None,
    order: str | None = None,
) -> list[Message]:
    size = parse_limit(limit)
    direction: MessageOrder = parse_order(order)
    conversation = await _find_owned(session, conversation_id, user_id)
    if conversation is None:
        return []
    ascending = direction == "asc"
    time_order = Message.created_at.asc() if ascending else Message.created_at.desc()
    id_order = Message.id.asc() if ascending else Message.id.desc()
    statement = (
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(time_order, id_order)
    )
    if size is not None:
        statement = statement.limit(size)
    rows = list(await session.scalars(statement))
    if not ascending:
        rows.reverse()
    return rows


def _dump(value: object) -> dict | None:
    if value is None:
        return None
    return value.model_dump(exclude_none=True)


async def _owned(session: AsyncSession, conversation_id: int | str, user_id: UUID | str) -> Conversation:
    conversation = await _find_owned(session, conversation_id, user_id)
    if conversation is None:
        raise BizException("会话不存在", code=BizCode.NOT_FOUND)
    return conversation


async def _find_owned(
    session: AsyncSession,
    conversation_id: int | str,
    user_id: UUID | str,
) -> Conversation | None:
    owner_id = parse_user_id(user_id)
    conversation = await session.get(Conversation, parse_conversation_id(conversation_id))
    if conversation is None or conversation.deleted_at is not None or conversation.user_id != owner_id:
        return None
    return conversation
