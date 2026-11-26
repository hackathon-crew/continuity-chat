"""人设接口。自建、选用和修改都使用 chatbot_session 里的用户。"""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.bootstrap.deps import current_user, get_session
from chatbot.chat.persona.schemas import PersonaCreate, PersonaOut, PersonaUpdate
from chatbot.chat.persona.service import (
    create_persona,
    delete_persona,
    list_system_personas,
    list_user_personas,
    select_persona,
    update_persona,
)
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.models import User

router = APIRouter(prefix="/api/personas", tags=["personas"])


@router.get("", response_model=list[PersonaOut])
async def list_personas(
    user: User = Depends(current_user),
    scope: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> list[PersonaOut]:
    if scope is not None:
        if scope != "system":
            raise BizException("只能列出系统人设", code=BizCode.BAD_REQUEST)
        return [PersonaOut.model_validate(row) for row in await list_system_personas(session)]
    return [
        PersonaOut.model_validate(row).model_copy(update={"role": role})
        for row, role in await list_user_personas(session, user.id)
    ]


@router.post("", response_model=PersonaOut, status_code=201)
async def create(
    payload: PersonaCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PersonaOut:
    if payload.scope == "private":
        payload = payload.model_copy(update={"user_id": user.id})
    persona, role = await create_persona(session, payload, actor_id=user.id)
    return PersonaOut.model_validate(persona).model_copy(update={"role": role})


@router.post("/{persona_id}/select", response_model=PersonaOut)
async def select(
    persona_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PersonaOut:
    persona = await select_persona(session, persona_id, user.id)
    return PersonaOut.model_validate(persona).model_copy(update={"role": "selected"})


@router.patch("/{persona_id}", response_model=PersonaOut)
async def update(
    persona_id: int,
    payload: PersonaUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PersonaOut:
    persona = await update_persona(session, persona_id, payload.model_copy(update={"user_id": user.id}))
    role = "owner" if persona.scope == "private" else None
    return PersonaOut.model_validate(persona).model_copy(update={"role": role})


@router.delete("/{persona_id}", status_code=204)
async def delete(
    persona_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await delete_persona(session, persona_id, user.id)
    return Response(status_code=204)
