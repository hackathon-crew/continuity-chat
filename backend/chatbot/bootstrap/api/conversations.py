"""会话接口。用户从 chatbot_session 读取，请求体里的用户编号会被覆盖。"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.bootstrap.deps import current_user, get_session
from chatbot.chat.conversation.schemas import ConversationOut, ConversationRename, ConversationSave
from chatbot.chat.conversation.service import (
    delete_conversation,
    list_conversations,
    rename_conversation,
    save_conversation,
)
from chatbot.chat.context.schemas import SummaryOut, SummarySave
from chatbot.chat.context.service import save_summary
from chatbot.chat.message.schemas import MessageCreate, MessageOut
from chatbot.chat.message.service import add_message, list_messages
from chatbot.system.models import User

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _as_user[ModelT: BaseModel](payload: ModelT, user_id: UUID) -> ModelT:
    return payload.model_copy(update={"user_id": user_id})


@router.get("", response_model=list[ConversationOut])
async def list_for_user(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ConversationOut]:
    rows = await list_conversations(session, user.id)
    return [ConversationOut.model_validate(row) for row in rows]


@router.post("", response_model=ConversationOut)
async def save(
    payload: ConversationSave,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationOut:
    return ConversationOut.model_validate(await save_conversation(session, _as_user(payload, user.id)))


@router.patch("/{conversation_id}", response_model=ConversationOut)
async def rename(
    conversation_id: int,
    payload: ConversationRename,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationOut:
    saved = await rename_conversation(session, conversation_id, _as_user(payload, user.id))
    return ConversationOut.model_validate(saved)


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def list_conversation_messages(
    conversation_id: int,
    user: User = Depends(current_user),
    limit: int | None = Query(None),
    order: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> list[MessageOut]:
    rows = await list_messages(session, conversation_id, user.id, limit=limit, order=order)
    return [MessageOut.model_validate(row) for row in rows]


@router.post("/{conversation_id}/messages", response_model=MessageOut, status_code=201)
async def create_message(
    conversation_id: int,
    payload: MessageCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> MessageOut:
    return MessageOut.model_validate(await add_message(session, conversation_id, _as_user(payload, user.id)))


@router.put("/{conversation_id}/summary", response_model=SummaryOut)
async def save_conversation_summary(
    conversation_id: int,
    payload: SummarySave,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> SummaryOut:
    return SummaryOut.model_validate(await save_summary(session, conversation_id, _as_user(payload, user.id)))


@router.delete("/{conversation_id}", status_code=204)
async def delete(
    conversation_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await delete_conversation(session, conversation_id, user.id)
    return Response(status_code=204)
