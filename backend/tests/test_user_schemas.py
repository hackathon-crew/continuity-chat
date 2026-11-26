import pytest

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.user.schemas import UserCreate, UserUpdate, changed_fields, parse_model, parse_user_id


def test_create_strips_text() -> None:
    data = parse_model(
        UserCreate,
        {
            "upstream_user_id": "  u-1  ",
            "email": " user@example.com ",
            "display_name": " 显示名 ",
        },
    )
    assert data.upstream_user_id == "u-1"
    assert data.email == "user@example.com"
    assert data.display_name == "显示名"
    assert data.role == "user"
    assert data.status == "active"
    assert data.balance == 0


def test_create_rejects_bad_email() -> None:
    with pytest.raises(BizException) as error:
        parse_model(UserCreate, {"upstream_user_id": "u-1", "email": "no-at", "display_name": "名"})
    assert error.value.code == BizCode.BAD_REQUEST


def test_update_requires_a_field() -> None:
    with pytest.raises(BizException) as error:
        changed_fields(UserUpdate())
    assert error.value.code == BizCode.BAD_REQUEST


def test_update_keeps_only_provided_fields() -> None:
    assert changed_fields(UserUpdate(status="disabled")) == {"status": "disabled"}


def test_user_id_must_be_uuid() -> None:
    with pytest.raises(BizException) as error:
        parse_user_id("not-a-uuid")
    assert error.value.code == BizCode.BAD_REQUEST
