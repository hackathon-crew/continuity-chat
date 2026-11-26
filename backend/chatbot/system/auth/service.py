"""完成本站登录会话。上游换票成功后才写入用户、凭证和会话。"""

import base64
import hashlib
import os
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.framework.const import SESSION_SECONDS
from chatbot.framework.crypto.secrets import decrypt, encrypt, load_key
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.auth.schemas import UpstreamProfile
from chatbot.system.models import AuthSession, UpstreamCredential, User


def new_state() -> str:
    return secrets.token_urlsafe(32)


def same_secret(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    return secrets.compare_digest(left, right)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def complete_login(session: AsyncSession, profile: UpstreamProfile, key: bytes) -> str:
    user = await session.scalar(select(User).where(User.upstream_user_id == profile.upstream_user_id))
    amount = profile.balance if profile.balance is not None else Decimal("0")
    if user is None:
        user = User(
            upstream_user_id=profile.upstream_user_id,
            email=profile.email,
            display_name=profile.display_name,
            role="user",
            status="active",
            balance=amount,
        )
        session.add(user)
        await session.flush()
    else:
        user.email = profile.email
        user.display_name = profile.display_name
        if profile.balance is not None:
            user.balance = amount
        user.updated_at = datetime.now(UTC)
        await session.flush()
    if user.id is None:
        raise BizException("登录失败", code=BizCode.INTERNAL_ERROR)
    await _save_credential(session, user.id, profile.credential, key)
    token = secrets.token_urlsafe(32)
    session.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + timedelta(seconds=SESSION_SECONDS),
        )
    )
    await session.flush()
    return token


async def user_api_key(session: AsyncSession, user_id) -> str:
    """解密该用户登录时保存的中转站 Key。只交给模型客户端，不返回给浏览器。"""
    row = await session.get(UpstreamCredential, user_id)
    key_text = os.environ.get("CREDENTIAL_KEY", "").strip()
    if row is None or not row.ciphertext.strip() or not key_text:
        raise BizException("缺少调用凭证", code=BizCode.UNAUTHORIZED)
    try:
        secret = decrypt(base64.b64decode(row.ciphertext), load_key(key_text)).strip()
    except Exception as error:
        raise BizException("调用凭证无效", code=BizCode.UNAUTHORIZED) from error
    if not secret:
        raise BizException("缺少调用凭证", code=BizCode.UNAUTHORIZED)
    return secret


async def logout(session: AsyncSession, token: str | None) -> None:
    row = await _session_row(session, token)
    if row is None:
        return
    await session.delete(row)
    await session.flush()


async def _save_credential(session: AsyncSession, user_id, credential: str, key: bytes) -> None:
    sealed = base64.b64encode(encrypt(credential, key)).decode()
    row = await session.get(UpstreamCredential, user_id)
    if row is None:
        session.add(UpstreamCredential(user_id=user_id, ciphertext=sealed))
    else:
        row.ciphertext = sealed
        row.updated_at = datetime.now(UTC)
    await session.flush()


async def _session_row(session: AsyncSession, token: str | None) -> AuthSession | None:
    if not token:
        return None
    return await session.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
