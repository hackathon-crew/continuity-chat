"""人设卡片的入参和返回值。卡片可复用，不写入 Mem0。"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator, model_validator

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException

NAME_MAX = 255
TEXT_MAX = 8000
PORTRAIT_URL_MAX = 2048
_SNOWFLAKE_MAX = (1 << 63) - 1
Scope = Literal["system", "private"]


class PersonaCreate(BaseModel):
    model_config = ConfigDict(strict=True)

    scope: Scope
    user_id: UUID | None = None
    name: str
    description: str
    personality: str
    scenario: str = ""
    greeting: str = ""
    example_dialogue: str = ""
    system_prompt: str = ""
    post_history: str = ""
    portrait_url: str | None = None

    @field_validator("name")
    @classmethod
    def check_name(cls, value: str) -> str:
        return _required(value, "人设名称不能为空", f"人设名称长度不能超过{NAME_MAX}个字符", NAME_MAX)

    @field_validator("description")
    @classmethod
    def check_description(cls, value: str) -> str:
        return _required(value, "描述不能为空", f"描述长度不能超过{TEXT_MAX}个字符", TEXT_MAX)

    @field_validator("personality")
    @classmethod
    def check_personality(cls, value: str) -> str:
        return _required(value, "性格不能为空", f"性格长度不能超过{TEXT_MAX}个字符", TEXT_MAX)

    @field_validator("scenario", "greeting", "example_dialogue", "system_prompt", "post_history")
    @classmethod
    def check_optional(cls, value: str) -> str:
        return _optional(value)

    @field_validator("portrait_url")
    @classmethod
    def check_portrait_url(cls, value: str | None) -> str | None:
        return _portrait_url(value)

    @model_validator(mode="after")
    def check_owner(self) -> "PersonaCreate":
        if self.scope == "system" and self.user_id is not None:
            raise ValueError("系统人设不绑定用户")
        return self


class PersonaUpdate(BaseModel):
    model_config = ConfigDict(strict=True)

    user_id: UUID | None = None
    name: str | None = None
    description: str | None = None
    personality: str | None = None
    scenario: str | None = None
    greeting: str | None = None
    example_dialogue: str | None = None
    system_prompt: str | None = None
    post_history: str | None = None
    portrait_url: str | None = None

    @field_validator("name")
    @classmethod
    def check_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _required(value, "人设名称不能为空", f"人设名称长度不能超过{NAME_MAX}个字符", NAME_MAX)

    @field_validator("description")
    @classmethod
    def check_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _required(value, "描述不能为空", f"描述长度不能超过{TEXT_MAX}个字符", TEXT_MAX)

    @field_validator("personality")
    @classmethod
    def check_personality(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _required(value, "性格不能为空", f"性格长度不能超过{TEXT_MAX}个字符", TEXT_MAX)

    @field_validator("scenario", "greeting", "example_dialogue", "system_prompt", "post_history")
    @classmethod
    def check_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _optional(value)

    @field_validator("portrait_url")
    @classmethod
    def check_portrait_url(cls, value: str | None) -> str | None:
        return _portrait_url(value)


class PersonaSelect(BaseModel):
    model_config = ConfigDict(strict=True)

    user_id: UUID


class PersonaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scope: str
    name: str
    description: str
    personality: str
    scenario: str
    greeting: str
    example_dialogue: str
    system_prompt: str
    post_history: str
    portrait_url: str | None
    role: str | None = None
    created_at: datetime
    updated_at: datetime


def parse_persona_id(value: int | str) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError
        if isinstance(value, int):
            return _snowflake(value)
        if isinstance(value, str) and value.isdigit():
            return _snowflake(int(value))
    except ValueError as error:
        raise BizException("人设编号无效", code=BizCode.BAD_REQUEST) from error
    raise BizException("人设编号无效", code=BizCode.BAD_REQUEST)


def parse_model[ModelT: BaseModel](model: type[ModelT], value: ModelT | dict[str, Any]) -> ModelT:
    if isinstance(value, model):
        return value
    try:
        return model.model_validate(value)
    except ValidationError as error:
        raise BizException(_message(error), code=BizCode.BAD_REQUEST) from error


def changed_fields(data: PersonaUpdate) -> dict[str, str | None]:
    fields: dict[str, str | None] = {}
    for name in data.model_fields_set:
        if name == "user_id":
            continue
        value = getattr(data, name)
        if name == "portrait_url" or value is not None:
            fields[name] = value
    if not fields:
        raise BizException("没有要修改的字段", code=BizCode.BAD_REQUEST)
    return fields


def _required(value: str, empty: str, too_long: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    if not text:
        raise ValueError(empty)
    if len(text) > limit:
        raise ValueError(too_long)
    return text


def _portrait_url(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("立绘地址无效")
    url = value.strip()
    if not url:
        return None
    if not url.startswith(("https://", "http://")) or len(url) > PORTRAIT_URL_MAX:
        raise ValueError("立绘地址无效")
    return url


def _optional(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    if len(text) > TEXT_MAX:
        raise ValueError(f"长度不能超过{TEXT_MAX}个字符")
    return text


def _snowflake(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= _SNOWFLAKE_MAX:
        raise ValueError("人设编号无效")
    return value


def _message(error: ValidationError) -> str:
    item = error.errors()[0]
    text = str(item["msg"])
    prefix = "Value error, "
    if text.startswith(prefix):
        return text.removeprefix(prefix)
    return "参数无效"
