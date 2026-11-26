"""审计日志的查询结果。"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_user_id: UUID | None
    action: str
    target_type: str | None
    target_id: UUID | None
    ip: str | None
    created_at: datetime


class AuditPage(BaseModel):
    items: list[AuditOut]
    page: int
    page_size: int
    has_more: bool


def parse_audit_id(value: UUID | str) -> UUID:
    if isinstance(value, UUID):
        return value
    try:
        return UUID(value)
    except (TypeError, ValueError) as error:
        raise BizException("日志编号无效", code=BizCode.BAD_REQUEST) from error
