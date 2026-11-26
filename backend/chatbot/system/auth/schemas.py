"""授权码换票的入参。校验失败视为登录失败，不写数据库。"""

from uuid import UUID

from decimal import Decimal, InvalidOperation

from pydantic import BaseModel, ConfigDict

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.user.schemas import UserCreate, parse_model


class UpstreamProfile(BaseModel):
    model_config = ConfigDict(strict=True)

    upstream_user_id: str
    email: str
    display_name: str
    credential: str
    balance: Decimal | None = None


def parse_profile(payload: object) -> UpstreamProfile:
    if not isinstance(payload, dict):
        raise BizException("登录失败", code=BizCode.UNAUTHORIZED)
    try:
        user = parse_model(
            UserCreate,
            {
                "upstream_user_id": payload.get("upstream_user_id"),
                "email": payload.get("email"),
                "display_name": payload.get("username"),
            },
        )
    except BizException as error:
        raise BizException("登录失败", code=BizCode.UNAUTHORIZED) from error
    credential = payload.get("credential")
    if not isinstance(credential, str) or not credential.strip():
        raise BizException("登录失败", code=BizCode.UNAUTHORIZED)
    balance = _profile_balance(payload["balance"]) if "balance" in payload else None
    return UpstreamProfile(
        upstream_user_id=user.upstream_user_id,
        email=user.email,
        display_name=user.display_name,
        credential=credential.strip(),
        balance=balance,
    )


def _profile_balance(value: object) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise BizException("登录失败", code=BizCode.UNAUTHORIZED)
    try:
        amount = Decimal(value) if isinstance(value, int) and not isinstance(value, bool) else Decimal(str(value).strip())
    except InvalidOperation as error:
        raise BizException("登录失败", code=BizCode.UNAUTHORIZED) from error
    if amount < 0:
        raise BizException("登录失败", code=BizCode.UNAUTHORIZED)
    return amount.quantize(Decimal("0.00000001"))


class SessionUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    upstream_user_id: str
    role: str
    status: str
    balance: Decimal
