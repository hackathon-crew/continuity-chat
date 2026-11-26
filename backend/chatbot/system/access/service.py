"""从本站会话 Cookie 取出当前用户。"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.auth.service import hash_token
from chatbot.system.models import AuthSession, User


async def require_user(session: AsyncSession, token: str | None) -> User:
    if not token:
        raise BizException("未登录", code=BizCode.UNAUTHORIZED)
    row = await session.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    if row is None or row.expires_at <= datetime.now(UTC):
        raise BizException("未登录", code=BizCode.UNAUTHORIZED)
    user = await session.get(User, row.user_id)
    if user is None:
        raise BizException("未登录", code=BizCode.UNAUTHORIZED)
    return user
