"""长期记忆的入参和返回值。格式由 Pydantic 校验，不负责读写 Mem0。"""

from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator, model_validator

from chatbot.chat.persona.schemas import parse_persona_id
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.enums.memory import MemoryKind, MemoryScene, MemoryStatus
from chatbot.framework.exceptions.biz import BizException

TEXT_MAX = 500
TOPIC_MAX = 64
_SNOWFLAKE_MAX = (1 << 63) - 1


class MemoryWrite(BaseModel):
    model_config = ConfigDict(strict=True)

    user_id: UUID
    persona_id: int
    text: str
    scene: str
    valid_from: date
    kind: str = MemoryKind.EPISODE
    status: str = MemoryStatus.CURRENT
    identity: bool = False
    topic: str | None = None
    valid_to: date | None = None
    repeat_count: int = 1
    conversation_id: int | None = None

    @field_validator("persona_id")
    @classmethod
    def check_persona_id(cls, value: int) -> int:
        return parse_persona_id(value)

    @field_validator("scene")
    @classmethod
    def check_scene(cls, value: str) -> str:
        return _scene(value)

    @field_validator("kind")
    @classmethod
    def check_kind(cls, value: str) -> str:
        return _kind(value)

    @field_validator("status")
    @classmethod
    def check_status(cls, value: str) -> str:
        return _status(value)

    @field_validator("text")
    @classmethod
    def check_text(cls, value: str) -> str:
        return _text(value)

    @field_validator("topic")
    @classmethod
    def check_topic(cls, value: str | None) -> str | None:
        return _topic(value)

    @field_validator("repeat_count")
    @classmethod
    def check_repeat_count(cls, value: int) -> int:
        return _repeat_count(value)

    @field_validator("conversation_id")
    @classmethod
    def check_conversation_id(cls, value: int | None) -> int | None:
        if value is None:
            return None
        return _snowflake(value)

    @model_validator(mode="after")
    def check_range(self) -> "MemoryWrite":
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("结束日期不能早于开始日期")
        return self


class MemoryRepeat(BaseModel):
    model_config = ConfigDict(strict=True)

    memory_id: str
    repeat_count: int
    identity: bool | None = None

    @field_validator("memory_id")
    @classmethod
    def check_memory_id(cls, value: str) -> str:
        return _memory_id(value)

    @field_validator("repeat_count")
    @classmethod
    def check_repeat_count(cls, value: int) -> int:
        return _repeat_count(value)


class MemoryClose(BaseModel):
    model_config = ConfigDict(strict=True)

    memory_id: str
    valid_to: date

    @field_validator("memory_id")
    @classmethod
    def check_memory_id(cls, value: str) -> str:
        return _memory_id(value)


class MemoryForget(BaseModel):
    model_config = ConfigDict(strict=True)

    memory_id: str

    @field_validator("memory_id")
    @classmethod
    def check_memory_id(cls, value: str) -> str:
        return _memory_id(value)


class MemoryLoad(BaseModel):
    """一次取回这场可用的长期记忆。query 是当前这句话，只用于联想。"""

    model_config = ConfigDict(strict=True)

    user_id: UUID
    persona_id: int
    scene: str
    query: str

    @field_validator("persona_id")
    @classmethod
    def check_persona_id(cls, value: int) -> int:
        return parse_persona_id(value)

    @field_validator("scene")
    @classmethod
    def check_scene(cls, value: str) -> str:
        return _scene(value)

    @field_validator("query")
    @classmethod
    def check_query(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("必须是文本")
        return value.strip()


class MemoryItem(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    text: str
    kind: str
    scene: str
    status: str
    identity: bool
    topic: str | None
    valid_from: date
    valid_to: date | None
    repeat_count: int


class MemoryLoaded(BaseModel):
    """一次加载的结果。自我和近事给稳定前缀，联想给当前这句话。"""

    model_config = ConfigDict(strict=True)

    self_memories: list[MemoryItem]
    recent: list[MemoryItem]
    associative: list[MemoryItem]


def parse_model[ModelT: BaseModel](model: type[ModelT], value: ModelT | dict[str, Any]) -> ModelT:
    if isinstance(value, model):
        return value
    try:
        return model.model_validate(value)
    except ValidationError as error:
        raise BizException(_message(error), code=BizCode.BAD_REQUEST) from error


def _kind(value: str) -> str:
    if not isinstance(value, str) or value not in MemoryKind:
        raise ValueError("记忆类型无效")
    return value


def _scene(value: str) -> str:
    if not isinstance(value, str) or value not in MemoryScene:
        raise ValueError("场景无效")
    return value


def _status(value: str) -> str:
    if not isinstance(value, str) or value not in MemoryStatus:
        raise ValueError("记忆状态无效")
    return value


def _text(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    if not text:
        raise ValueError("记忆内容不能为空")
    if len(text) > TEXT_MAX:
        raise ValueError(f"记忆内容长度不能超过{TEXT_MAX}个字符")
    return text


def _topic(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    if not text:
        return None
    if len(text) > TOPIC_MAX:
        raise ValueError(f"主题长度不能超过{TOPIC_MAX}个字符")
    return text


def _repeat_count(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("重复次数无效")
    return value


def _memory_id(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    if not text:
        raise ValueError("记忆编号无效")
    return text


def _snowflake(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= _SNOWFLAKE_MAX:
        raise ValueError("会话编号无效")
    return value


def _message(error: ValidationError) -> str:
    item = error.errors()[0]
    text = str(item["msg"])
    prefix = "Value error, "
    if text.startswith(prefix):
        return text.removeprefix(prefix)
    return "参数无效"
