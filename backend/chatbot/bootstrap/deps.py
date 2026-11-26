"""请求级数据库会话。一个请求一个事务。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.framework.const import Cookie
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.access.service import require_user
from chatbot.system.models import User


@asynccontextmanager
async def session_scope(request: Request) -> AsyncIterator[AsyncSession]:
    factory = getattr(request.app.state, "session_factory", None)
    if factory is None:
        raise BizException("数据库未配置", code=BizCode.INTERNAL_ERROR)
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with session_scope(request) as session:
        yield session


async def current_user(request: Request, session: AsyncSession = Depends(get_session)) -> User:
    """从 chatbot_session 取出当前用户。调用方不能另行指定用户编号。"""
    return await require_user(session, request.cookies.get(Cookie.SESSION))
