import asyncio
from uuid import uuid4

import pytest

from chatbot.chat.persona.schemas import NAME_MAX, TEXT_MAX, PersonaCreate, parse_model, parse_persona_id
from chatbot.chat.persona.service import create_persona
from chatbot.framework.exceptions.biz import BizException


def _card(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "scope": "private",
        "user_id": uuid4(),
        "name": "  阿酥  ",
        "description": "  住在旧书店  ",
        "personality": "  话少，会接话  ",
    }
    data.update(overrides)
    return data


def test_create_private_strips_card_fields() -> None:
    data = parse_model(PersonaCreate, _card(example_dialogue="  {{char}}：嗯。  "))
    assert data.name == "阿酥"
    assert data.description == "住在旧书店"
    assert data.personality == "话少，会接话"
    assert data.example_dialogue == "{{char}}：嗯。"
    assert data.scenario == ""


def test_create_system_rejects_user() -> None:
    with pytest.raises(BizException, match="系统人设不绑定用户"):
        parse_model(PersonaCreate, _card(scope="system"))


def test_create_private_user_comes_from_session() -> None:
    payload = _card()
    payload.pop("user_id")
    assert parse_model(PersonaCreate, payload).user_id is None
    with pytest.raises(BizException, match="自建人设需要用户编号"):
        asyncio.run(create_persona(object(), payload))


def test_create_accepts_portrait_url() -> None:
    data = parse_model(
        PersonaCreate,
        _card(portrait_url="  https://cdn.example.com/persona/portraits/1.png  "),
    )
    assert data.portrait_url == "https://cdn.example.com/persona/portraits/1.png"


def test_create_rejects_portrait_without_http() -> None:
    with pytest.raises(BizException, match="立绘地址无效"):
        parse_model(PersonaCreate, _card(portrait_url="cdn.example.com/1.png"))


def test_create_rejects_blank_personality() -> None:
    with pytest.raises(BizException, match="性格不能为空"):
        parse_model(PersonaCreate, _card(personality="  "))


def test_create_rejects_long_name() -> None:
    with pytest.raises(BizException, match="人设名称长度不能超过"):
        parse_model(PersonaCreate, _card(name="名" * (NAME_MAX + 1)))


def test_create_rejects_long_description() -> None:
    with pytest.raises(BizException, match="描述长度不能超过"):
        parse_model(PersonaCreate, _card(description="文" * (TEXT_MAX + 1)))


def test_parse_persona_id() -> None:
    assert parse_persona_id("42") == 42
    with pytest.raises(BizException, match="人设编号无效"):
        parse_persona_id(0)
    with pytest.raises(BizException, match="人设编号无效"):
        parse_persona_id("abc")
