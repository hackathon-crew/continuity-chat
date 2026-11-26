"""用户的创建、查询、修改和删除。

入参格式由 Pydantic 校验。写入使用 ORM 绑定参数。
登录授权尚未接入，审计记录的操作者为空。
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.audit.service import audit
from chatbot.chat.models import Conversation
from chatbot.chat.persona.service import release_user_personas
from chatbot.system.models import AuthSession, UpstreamCredential, User
from chatbot.system.user.schemas import UserCreate, UserUpdate, changed_fields, parse_model, parse_user_id

_PAGE_SIZE_MAX = 100


@audit("user.create", target_type="user")
async def create_user(session: AsyncSession, payload: UserCreate | dict) -> User:
    data = parse_model(UserCreate, payload)
    if await session.scalar(select(User.id).where(User.upstream_user_id == data.upstream_user_id)):
        raise BizException("用户已存在", code=BizCode.CONFLICT)
    user = User(
        upstream_user_id=data.upstream_user_id,
        email=data.email,
        display_name=data.display_name,
        role=data.role,
        status=data.status,
        balance=data.balance,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as error:
        raise BizException("用户已存在", code=BizCode.CONFLICT) from error
    return user


async def get_user(session: AsyncSession, user_id: UUID | str) -> User:
    user = await session.get(User, parse_user_id(user_id))
    if user is None:
        raise BizException("用户不存在", code=BizCode.NOT_FOUND)
    return user


async def page_users(
    session: AsyncSession,
    page: int,
    *,
    page_size: int = 20,
    status: str | None = None,
) -> tuple[list[User], bool]:
    if type(page) is not int or page < 1:
        raise BizException("页码无效", code=BizCode.BAD_REQUEST)
    if type(page_size) is not int or not 1 <= page_size <= _PAGE_SIZE_MAX:
        raise BizException("每页条数无效", code=BizCode.BAD_REQUEST)
    if status is not None and status not in {"active", "disabled"}:
        raise BizException("用户状态无效", code=BizCode.BAD_REQUEST)
    statement = select(User).order_by(User.created_at.desc(), User.id)
    if status is not None:
        statement = statement.where(User.status == status)
    offset = (page - 1) * page_size
    rows = list(await session.scalars(statement.offset(offset).limit(page_size + 1)))
    has_more = len(rows) > page_size
    return rows[:page_size], has_more


@audit("user.update", target_type="user")
async def update_user(session: AsyncSession, user_id: UUID | str, payload: UserUpdate | dict) -> User:
    data = parse_model(UserUpdate, payload)
    fields = changed_fields(data)
    user = await get_user(session, user_id)
    for name, value in fields.items():
        setattr(user, name, value)
    await session.flush()
    return user


@audit("user.delete", target_type="user")
async def delete_user(session: AsyncSession, user_id: UUID | str) -> None:
    user = await get_user(session, user_id)
    conversation_count = await session.scalar(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.user_id == user.id, Conversation.deleted_at.is_(None))
    )
    if conversation_count:
        raise BizException("用户有会话，不能删除", code=BizCode.CONFLICT)
    await release_user_personas(session, user.id)
    credential = await session.get(UpstreamCredential, user.id)
    if credential is not None:
        await session.delete(credential)
    sessions = await session.scalars(select(AuthSession).where(AuthSession.user_id == user.id))
    for auth_session in sessions:
        await session.delete(auth_session)
    await session.delete(user)
    await session.flush()
