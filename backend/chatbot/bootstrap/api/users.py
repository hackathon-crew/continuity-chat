"""用户管理接口。登录授权完成前，这些接口不校验身份。"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.bootstrap.deps import get_session
from chatbot.system.user.schemas import UserCreate, UserOut, UserPage, UserUpdate
from chatbot.system.user.service import create_user, delete_user, get_user, page_users, update_user

router = APIRouter(prefix="/api/users", tags=["users"])


@router.post("", response_model=UserOut, status_code=201)
async def create(payload: UserCreate, session: AsyncSession = Depends(get_session)) -> UserOut:
    return UserOut.model_validate(await create_user(session, payload))


@router.get("", response_model=UserPage)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> UserPage:
    rows, has_more = await page_users(session, page, page_size=page_size, status=status)
    return UserPage(
        items=[UserOut.model_validate(row) for row in rows],
        page=page,
        page_size=page_size,
        has_more=has_more,
    )


@router.get("/{user_id}", response_model=UserOut)
async def read(user_id: UUID, session: AsyncSession = Depends(get_session)) -> UserOut:
    return UserOut.model_validate(await get_user(session, user_id))


@router.patch("/{user_id}", response_model=UserOut)
async def update(user_id: UUID, payload: UserUpdate, session: AsyncSession = Depends(get_session)) -> UserOut:
    return UserOut.model_validate(await update_user(session, user_id, payload))


@router.delete("/{user_id}", status_code=204)
async def delete(user_id: UUID, session: AsyncSession = Depends(get_session)) -> Response:
    await delete_user(session, user_id)
    return Response(status_code=204)
