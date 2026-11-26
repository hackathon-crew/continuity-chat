"""一轮对话的入参。用户消息沿用 parts，不能带思考或工具。"""

from pydantic import BaseModel, ConfigDict, field_validator

from chatbot.chat.conversation.schemas import parse_conversation_id
from chatbot.chat.message.schemas import MessagePart, parse_parts
from chatbot.chat.persona.schemas import parse_persona_id
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException


class ChatTurnIn(BaseModel):
    model_config = ConfigDict(strict=True)

    persona_id: int
    conversation_id: int | None = None
    parts: list[MessagePart]

    @field_validator("persona_id")
    @classmethod
    def check_persona_id(cls, value: int) -> int:
        return parse_persona_id(value)

    @field_validator("conversation_id")
    @classmethod
    def check_conversation_id(cls, value: int | None) -> int | None:
        if value is None:
            return None
        return parse_conversation_id(value)

    @field_validator("parts", mode="before")
    @classmethod
    def check_parts(cls, value: object) -> list[MessagePart]:
        parts = parse_parts(value)
        for part in parts:
            if part.thought or part.function_call is not None or part.function_response is not None:
                raise ValueError("这一轮只能包含文字、图片或文件")
            if part.file is not None and not (part.file.text and part.file.text.strip()):
                raise ValueError("文件需要解析后的正文")
        return parts


class StopIn(BaseModel):
    model_config = ConfigDict(strict=True)

    task_id: int

    @field_validator("task_id", mode="before")
    @classmethod
    def check_task_id(cls, value: object) -> int:
        if isinstance(value, str) and value.isdigit():
            value = int(value)
        try:
            return parse_conversation_id(value)  # type: ignore[arg-type]
        except BizException as error:
            raise ValueError("任务编号无效") from error
