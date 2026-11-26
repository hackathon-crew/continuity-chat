import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.audit.schemas import parse_audit_id
from chatbot.system.audit.service import audit


def test_log_id_must_be_uuid() -> None:
    with pytest.raises(BizException) as error:
        parse_audit_id("not-a-uuid")
    assert error.value.code == BizCode.BAD_REQUEST


def test_decorator_records_returned_id(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict]] = []

    async def fake_record(session, action, **kwargs):
        calls.append((action, kwargs))

    monkeypatch.setattr("chatbot.system.audit.service.record", fake_record)
    user_id = uuid4()

    @audit("user.create", target_type="user")
    async def create(session, payload):
        return SimpleNamespace(id=user_id)

    asyncio.run(create(object(), {}))
    assert calls == [("user.create", {"target_type": "user", "target_id": user_id})]


def test_decorator_skips_record_when_function_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_record(session, action, **kwargs):
        raise AssertionError("失败时不应写入审计")

    monkeypatch.setattr("chatbot.system.audit.service.record", fake_record)

    @audit("user.delete", target_type="user")
    async def remove(session, user_id):
        raise BizException("用户有会话，不能删除", code=BizCode.CONFLICT)

    with pytest.raises(BizException):
        asyncio.run(remove(object(), uuid4()))


def test_decorator_uses_argument_id_when_result_has_none(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    async def fake_record(session, action, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr("chatbot.system.audit.service.record", fake_record)
    user_id = uuid4()

    @audit("user.delete", target_type="user")
    async def remove(session, user_id):
        return None

    asyncio.run(remove(object(), user_id))
    assert calls[0]["target_id"] == user_id
