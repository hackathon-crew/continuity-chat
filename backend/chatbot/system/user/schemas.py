"""用户入参和返回值。格式由 Pydantic 校验，不负责数据库写入。"""

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException

_TEXT_MAX = 255
Role = Literal["admin", "user"]
Status = Literal["active", "disabled"]


class UserCreate(BaseModel):
    model_config = ConfigDict(strict=True)

    upstream_user_id: str
    email: str
    display_name: str
    role: Role = "user"
    status: Status = "active"
    balance: Decimal = Decimal("0")

    @field_validator("upstream_user_id", "display_name")
    @classmethod
    def check_required_text(cls, value: str) -> str:
        return _required_text(value)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _email(value)

    @field_validator("balance")
    @classmethod
    def check_balance(cls, value: Decimal) -> Decimal:
        return _balance(value)


class UserUpdate(BaseModel):
    model_config = ConfigDict(strict=True)

    email: str | None = None
    display_name: str | None = None
    role: Role | None = None
    status: Status | None = None

    @field_validator("display_name")
    @classmethod
    def check_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _required_text(value)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _email(value)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    upstream_user_id: str
    email: str
    display_name: str
    role: str
    status: str
    balance: Decimal
    created_at: datetime
    updated_at: datetime


class UserPage(BaseModel):
    items: list[UserOut]
    page: int
    page_size: int
    has_more: bool


def parse_user_id(value: UUID | str) -> UUID:
    if isinstance(value, UUID):
        return value
    try:
        return UUID(value)
    except (TypeError, ValueError) as error:
        raise BizException("用户编号无效", code=BizCode.BAD_REQUEST) from error


def parse_model[ModelT: BaseModel](model: type[ModelT], value: ModelT | dict[str, Any]) -> ModelT:
    if isinstance(value, model):
        return value
    try:
        return model.model_validate(value)
    except ValidationError as error:
        raise BizException(_message(error), code=BizCode.BAD_REQUEST) from error


def changed_fields(data: UserUpdate) -> dict[str, str]:
    fields = {name: getattr(data, name) for name in data.model_fields_set if getattr(data, name) is not None}
    if not fields:
        raise BizException("没有要修改的字段", code=BizCode.BAD_REQUEST)
    return fields


def _required_text(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    if not text:
        raise ValueError("不能为空")
    if len(text) > _TEXT_MAX:
        raise ValueError("不能超过 255 个字符")
    return text


def _email(value: str) -> str:
    text = _required_text(value)
    if "@" not in text or text.startswith("@") or text.endswith("@"):
        raise ValueError("邮箱格式无效")
    return text


def _balance(value: Decimal) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, Decimal):
        raise ValueError("余额无效")
    if value < 0:
        raise ValueError("余额不能为负")
    return value.quantize(Decimal("0.00000001"))


def _message(error: ValidationError) -> str:
    item = error.errors()[0]
    text = str(item["msg"])
    prefix = "Value error, "
    if text.startswith(prefix):
        return text.removeprefix(prefix)
    return "参数无效"
