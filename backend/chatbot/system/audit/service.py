"""审计日志的写入和查询。

业务函数用 @audit("动作", target_type="对象类型") 标注。函数成功返回后写入同一事务。
"""

from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.audit.schemas import parse_audit_id
from chatbot.system.models import AuditLog, User

_PAGE_SIZE_MAX = 100


def audit(action: str, *, target_type: str | None = None) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    """标注在第一个参数为数据库会话的异步函数上。"""

    def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            result = await func(*args, **kwargs)
            session = args[0] if args else kwargs["session"]
            await record(
                session,
                action,
                target_type=target_type,
                target_id=_target_id(result, args[1:], kwargs),
            )
            return result

        return wrapper

    return decorator


async def record(
    session: AsyncSession,
    action: str,
    *,
    actor_user_id: UUID | None = None,
    target_type: str | None = None,
    target_id: UUID | None = None,
    ip: str | None = None,
) -> AuditLog:
    if actor_user_id is not None:
        await _require_actor(session, actor_user_id)
    row = AuditLog(
        action=action,
        actor_user_id=actor_user_id,
        target_type=target_type,
        target_id=target_id,
        ip=ip,
    )
    session.add(row)
    await session.flush()
    return row


async def get_log(session: AsyncSession, log_id: UUID | str) -> AuditLog:
    row = await session.get(AuditLog, parse_audit_id(log_id))
    if row is None:
        raise BizException("日志不存在", code=BizCode.NOT_FOUND)
    return row


async def page_logs(
    session: AsyncSession,
    page: int,
    *,
    page_size: int = 20,
    action: str | None = None,
    actor_user_id: UUID | None = None,
    target_type: str | None = None,
) -> tuple[list[AuditLog], bool]:
    if type(page) is not int or page < 1:
        raise BizException("页码无效", code=BizCode.BAD_REQUEST)
    if type(page_size) is not int or not 1 <= page_size <= _PAGE_SIZE_MAX:
        raise BizException("每页条数无效", code=BizCode.BAD_REQUEST)
    statement = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id)
    if action is not None:
        statement = statement.where(AuditLog.action == action)
    if actor_user_id is not None:
        statement = statement.where(AuditLog.actor_user_id == actor_user_id)
    if target_type is not None:
        statement = statement.where(AuditLog.target_type == target_type)
    offset = (page - 1) * page_size
    rows = list(await session.scalars(statement.offset(offset).limit(page_size + 1)))
    has_more = len(rows) > page_size
    return rows[:page_size], has_more


def _target_id(result: Any, args: tuple[Any, ...], kwargs: dict[str, Any]) -> UUID | None:
    found = _as_uuid(getattr(result, "id", None))
    if found is not None:
        return found
    for key in ("user_id", "target_id"):
        found = _as_uuid(kwargs.get(key))
        if found is not None:
            return found
    for arg in args:
        found = _as_uuid(arg)
        if found is not None:
            return found
    return None


def _as_uuid(value: Any) -> UUID | None:
    if isinstance(value, UUID):
        return value
    if isinstance(value, str):
        try:
            return UUID(value)
        except ValueError:
            return None
    return None


async def _require_actor(session: AsyncSession, user_id: UUID) -> None:
    if await session.get(User, user_id) is None:
        raise BizException("操作者不存在", code=BizCode.NOT_FOUND)
