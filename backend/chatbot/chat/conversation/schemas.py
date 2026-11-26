"""会话入参和返回值。格式由 Pydantic 校验，不负责数据库写入。"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.user.schemas import parse_user_id

TITLE_MAX = 255
_SNOWFLAKE_MAX = (1 << 63) - 1


class ConversationSave(BaseModel):
    model_config = ConfigDict(strict=True)

    user_id: UUID | None = None
    persona_id: int
    conversation_id: int | None = None
    question: str | None = None
    last_message_at: datetime | None = None

    @field_validator("persona_id")
    @classmethod
    def check_persona_id(cls, value: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= _SNOWFLAKE_MAX:
            raise ValueError("人设编号无效")
        return value

    @field_validator("conversation_id")
    @classmethod
    def check_conversation_id(cls, value: int | None) -> int | None:
        if value is None:
            return None
        return _snowflake(value)

    @field_validator("question")
    @classmethod
    def check_question(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _question(value)

    @field_validator("last_message_at")
    @classmethod
    def check_last_message_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("时间需要带时区")
        return value


class ConversationRename(BaseModel):
    model_config = ConfigDict(strict=True)

    user_id: UUID | None = None
    title: str

    @field_validator("title")
    @classmethod
    def check_title(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("必须是文本")
        text = value.strip()
        if not text:
            raise ValueError("会话名称不能为空")
        if len(text) > TITLE_MAX:
            raise ValueError(f"会话名称长度不能超过{TITLE_MAX}个字符")
        return text


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    persona_id: int
    title: str
    last_message_at: datetime | None


def parse_conversation_id(value: int | str) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError
        if isinstance(value, int):
            return _snowflake(value)
        if isinstance(value, str) and value.isdigit():
            return _snowflake(int(value))
    except ValueError as error:
        raise BizException("会话编号无效", code=BizCode.BAD_REQUEST) from error
    raise BizException("会话编号无效", code=BizCode.BAD_REQUEST)


def parse_model[ModelT: BaseModel](model: type[ModelT], value: ModelT | dict[str, Any]) -> ModelT:
    if isinstance(value, model):
        return value
    try:
        return model.model_validate(value)
    except ValidationError as error:
        raise BizException(_message(error), code=BizCode.BAD_REQUEST) from error


def title_from_question(question: str) -> str:
    text = " ".join(question.split())
    if not text:
        raise BizException("问题不能为空", code=BizCode.BAD_REQUEST)
    return text[:TITLE_MAX]


def _snowflake(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= _SNOWFLAKE_MAX:
        raise ValueError("会话编号无效")
    return value


def _question(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    if not text:
        raise ValueError("问题不能为空")
    return text


def _message(error: ValidationError) -> str:
    item = error.errors()[0]
    text = str(item["msg"])
    prefix = "Value error, "
    if text.startswith(prefix):
        return text.removeprefix(prefix)
    return "参数无效"


__all__ = [
    "ConversationOut",
    "ConversationRename",
    "ConversationSave",
    "parse_conversation_id",
    "parse_model",
    "parse_user_id",
    "title_from_question",
]
