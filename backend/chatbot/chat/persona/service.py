"""人设卡片的列出、创建、选用和停用。

系统人设由后台准备，用户选用后建立关联。用户自己写的人设只关联到这个用户。
同一张卡片可以被多人选用，陪聊记忆按用户和人设分开，不写在卡片上。
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from chatbot.chat.models import Conversation, Persona, UserPersona
from chatbot.system.models import User
from chatbot.chat.persona.schemas import (
    PersonaCreate,
    PersonaUpdate,
    changed_fields,
    parse_model,
    parse_persona_id,
)
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.user.schemas import parse_user_id


async def list_system_personas(session: AsyncSession) -> list[Persona]:
    rows = await session.scalars(
        select(Persona)
        .where(Persona.scope == "system", Persona.deleted_at.is_(None))
        .order_by(Persona.created_at.desc(), Persona.id.desc())
    )
    return list(rows)


async def list_user_personas(session: AsyncSession, user_id: UUID | str) -> list[tuple[Persona, str]]:
    owner_id = parse_user_id(user_id)
    rows = await session.execute(
        select(Persona, UserPersona.role)
        .join(UserPersona, UserPersona.persona_id == Persona.id)
        .where(UserPersona.user_id == owner_id, Persona.deleted_at.is_(None))
        .order_by(UserPersona.created_at.desc(), Persona.id.desc())
    )
    return [(persona, role) for persona, role in rows.all()]


async def create_persona(
    session: AsyncSession,
    payload: PersonaCreate | dict,
    *,
    actor_id: UUID | None = None,
) -> tuple[Persona, str | None]:
    data = parse_model(PersonaCreate, payload)
    persona = Persona(
        scope=data.scope,
        name=data.name,
        description=data.description,
        personality=data.personality,
        scenario=data.scenario,
        greeting=data.greeting,
        example_dialogue=data.example_dialogue,
        system_prompt=data.system_prompt,
        post_history=data.post_history,
        portrait_url=data.portrait_url,
    )
    if data.scope == "private" and data.user_id is None:
        raise BizException("自建人设需要用户编号", code=BizCode.BAD_REQUEST)
    if data.scope == "system":
        await _require_admin(session, actor_id)
    session.add(persona)
    await session.flush()
    if data.user_id is None:
        return persona, None
    session.add(UserPersona(user_id=data.user_id, persona_id=persona.id, role="owner"))
    try:
        await session.flush()
    except IntegrityError as error:
        raise BizException("用户不存在", code=BizCode.NOT_FOUND) from error
    return persona, "owner"


async def update_persona(
    session: AsyncSession,
    persona_id: int | str,
    payload: PersonaUpdate | dict,
) -> Persona:
    data = parse_model(PersonaUpdate, payload)
    persona = await _active(session, persona_id)
    if persona.scope == "system":
        await _require_admin(session, data.user_id)
    elif data.user_id is None:
        raise BizException("自建人设需要用户编号", code=BizCode.BAD_REQUEST)
    else:
        await _owner_link(session, persona.id, data.user_id)
    for name, value in changed_fields(data).items():
        setattr(persona, name, value)
    await session.flush()
    return persona


async def select_persona(session: AsyncSession, persona_id: int | str, user_id: UUID | str) -> Persona:
    owner_id = parse_user_id(user_id)
    persona = await _active(session, persona_id)
    if persona.scope != "system":
        raise BizException("只能选用系统人设", code=BizCode.BAD_REQUEST)
    link = await session.get(UserPersona, (owner_id, persona.id))
    if link is not None:
        return persona
    session.add(UserPersona(user_id=owner_id, persona_id=persona.id, role="selected"))
    try:
        await session.flush()
    except IntegrityError as error:
        raise BizException("用户不存在", code=BizCode.NOT_FOUND) from error
    return persona


async def delete_persona(session: AsyncSession, persona_id: int | str, user_id: UUID | str) -> None:
    owner_id = parse_user_id(user_id)
    persona = await _active(session, persona_id)
    link = await session.get(UserPersona, (owner_id, persona.id))
    if link is None:
        raise BizException("人设不存在", code=BizCode.NOT_FOUND)
    if link.role == "selected":
        await session.delete(link)
        await session.flush()
        return
    conversation_count = await session.scalar(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.persona_id == persona.id, Conversation.deleted_at.is_(None))
    )
    if conversation_count:
        raise BizException("人设有会话，不能删除", code=BizCode.CONFLICT)
    persona.deleted_at = datetime.now(UTC)
    await session.flush()


async def linked_persona(session: AsyncSession, persona_id: int | str, user_id: UUID | str) -> Persona:
    owner_id = parse_user_id(user_id)
    persona = await _active(session, persona_id)
    link = await session.get(UserPersona, (owner_id, persona.id))
    if link is None:
        raise BizException("人设不存在", code=BizCode.NOT_FOUND)
    return persona


async def release_user_personas(session: AsyncSession, user_id: UUID) -> None:
    owned_ids = list(
        await session.scalars(
            select(UserPersona.persona_id).where(UserPersona.user_id == user_id, UserPersona.role == "owner")
        )
    )
    await session.execute(delete(UserPersona).where(UserPersona.user_id == user_id))
    for persona_id in owned_ids:
        used = await session.scalar(
            select(func.count()).select_from(Conversation).where(Conversation.persona_id == persona_id)
        )
        if used:
            continue
        persona = await session.get(Persona, persona_id)
        if persona is not None and persona.scope == "private":
            await session.delete(persona)


async def _active(session: AsyncSession, persona_id: int | str) -> Persona:
    persona = await session.get(Persona, parse_persona_id(persona_id))
    if persona is None or persona.deleted_at is not None:
        raise BizException("人设不存在", code=BizCode.NOT_FOUND)
    return persona


async def _require_admin(session: AsyncSession, user_id: UUID | None) -> None:
    if user_id is None:
        raise BizException("系统人设不能由用户修改", code=BizCode.FORBIDDEN)
    actor = await session.get(User, user_id)
    if actor is None or actor.role != "admin":
        raise BizException("系统人设不能由用户修改", code=BizCode.FORBIDDEN)


async def _owner_link(session: AsyncSession, persona_id: int, user_id: UUID | None) -> UserPersona:
    if user_id is None:
        raise BizException("自建人设需要用户编号", code=BizCode.BAD_REQUEST)
    link = await session.get(UserPersona, (user_id, persona_id))
    if link is None or link.role != "owner":
        raise BizException("人设不存在", code=BizCode.NOT_FOUND)
    return link
