"""滑动窗口的摘要。until_message_id 是窗口左界。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator
from uuid import UUID

from chatbot.chat.conversation.schemas import parse_conversation_id
from chatbot.framework.exceptions.biz import BizException


class SummarySave(BaseModel):
    model_config = ConfigDict(strict=True)

    user_id: UUID | None = None
    content: str
    until_message_id: int | None = None

    @field_validator("content")
    @classmethod
    def check_content(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("必须是文本")
        text = value.strip()
        if not text:
            raise ValueError("记忆内容不能为空")
        return text

    @field_validator("until_message_id")
    @classmethod
    def check_until_message_id(cls, value: int | None) -> int | None:
        if value is None:
            return None
        try:
            return parse_conversation_id(value)
        except BizException as error:
            raise ValueError("消息编号无效") from error


class SummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    conversation_id: int
    until_message_id: int | None
    content: str
    updated_at: datetime
