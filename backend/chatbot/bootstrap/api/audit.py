"""审计日志查询。写入由 @audit 在业务函数上完成。"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.bootstrap.deps import get_session
from chatbot.system.audit.schemas import AuditOut, AuditPage
from chatbot.system.audit.service import get_log, page_logs

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])


@router.get("", response_model=AuditPage)
async def list_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    action: str | None = Query(None),
    actor_user_id: UUID | None = Query(None),
    target_type: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> AuditPage:
    rows, has_more = await page_logs(
        session,
        page,
        page_size=page_size,
        action=action,
        actor_user_id=actor_user_id,
        target_type=target_type,
    )
    return AuditPage(
        items=[AuditOut.model_validate(row) for row in rows],
        page=page,
        page_size=page_size,
        has_more=has_more,
    )


@router.get("/{log_id}", response_model=AuditOut)
async def read(log_id: UUID, session: AsyncSession = Depends(get_session)) -> AuditOut:
    return AuditOut.model_validate(await get_log(session, log_id))
