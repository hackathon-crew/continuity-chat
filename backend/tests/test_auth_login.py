import asyncio
import base64
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from chatbot.bootstrap.app import create_app
from chatbot.framework.const import Cookie
from chatbot.bootstrap.deps import get_session
from chatbot.framework.crypto.secrets import decrypt, encrypt, load_key
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.access.service import require_user
from chatbot.system.auth.schemas import parse_profile
from chatbot.system.auth.service import complete_login, hash_token, logout, user_api_key
from chatbot.system.auth.upstream import exchange_code
from chatbot.system.models import AuthSession, UpstreamCredential, User

KEY = base64.b64encode(b"k" * 32).decode()


def test_login_redirects_with_state_cookie(monkeypatch) -> None:
    _oauth_env(monkeypatch)
    response = TestClient(create_app()).get("/api/auth/login", follow_redirects=False)
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("https://unigate.top/oauth/authorize?")
    assert "client_id=chat" in location
    assert "response_type=code" in location
    cookie = response.headers["set-cookie"].lower()
    assert "chatbot_oauth_state=" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie


def test_callback_rejects_missing_code() -> None:
    response = TestClient(create_app()).get("/api/auth/callback?state=abc")
    assert response.status_code == 400
    assert response.json()["message"] == "缺少授权码"


def test_callback_rejects_state_mismatch() -> None:
    client = TestClient(create_app())
    client.cookies.set(Cookie.OAUTH_STATE, "expected-state")
    response = client.get("/api/auth/callback?code=once&state=other-state")
    assert response.status_code == 401
    assert response.json()["message"] == "登录状态无效"


def test_exchange_rejects_upstream_status(monkeypatch) -> None:
    _oauth_env(monkeypatch)

    async def post(url, payload):
        del url, payload
        return 400, "{}"

    with pytest.raises(BizException, match="登录失败"):
        _run(exchange_code(_config(), "once", post=post))


def test_exchange_reports_network_failure(monkeypatch) -> None:
    _oauth_env(monkeypatch)

    async def post(url, payload):
        del url, payload
        raise httpx.ConnectError("down")

    with pytest.raises(BizException, match="中转站不可用"):
        _run(exchange_code(_config(), "once", post=post))


def test_profile_requires_credential() -> None:
    with pytest.raises(BizException, match="登录失败"):
        parse_profile(
            {
                "upstream_user_id": "up-1",
                "email": "user@example.com",
                "username": "显示名",
            }
        )


def test_complete_login_creates_then_updates_same_user() -> None:
    store = _Store()
    profile = parse_profile(_token_body())
    first = _run(complete_login(store, profile, _key()))
    again = parse_profile(_token_body(email="new@example.com", username="新名字", credential="next-secret", balance="12.5"))
    second = _run(complete_login(store, again, _key()))
    assert store.user.email == "new@example.com"
    assert store.user.display_name == "新名字"
    assert store.user.balance == Decimal("12.50000000")
    assert store.user.id is not None
    assert decrypt(base64.b64decode(store.credential.ciphertext), _key()) == "next-secret"
    sessions = [row for row in store.added if isinstance(row, AuthSession)]
    assert len(sessions) == 2
    assert sessions[0].user_id == sessions[1].user_id == store.user.id
    assert hash_token(first) == sessions[0].token_hash
    assert hash_token(second) == sessions[1].token_hash


def test_callback_sets_session_cookie(monkeypatch) -> None:
    _oauth_env(monkeypatch)
    store = _Store()
    state = "state-value"

    async def exchange(config, code, *, post=None):
        del config, code, post
        return parse_profile(_token_body())

    @asynccontextmanager
    async def scope(request):
        del request
        yield store

    monkeypatch.setattr("chatbot.bootstrap.api.auth.exchange_code", exchange)
    monkeypatch.setattr("chatbot.bootstrap.api.auth.session_scope", scope)
    client = TestClient(create_app())
    client.cookies.set(Cookie.OAUTH_STATE, state)
    response = client.get(f"/api/auth/callback?code=once&state={state}", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/"
    assert "chatbot_session=" in response.headers["set-cookie"].lower()
    assert store.user.upstream_user_id == "up-1"


def test_me_requires_session(monkeypatch) -> None:
    @asynccontextmanager
    async def scope(request):
        del request
        yield _Store()

    monkeypatch.setattr("chatbot.bootstrap.api.auth.session_scope", scope)
    response = TestClient(create_app()).get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["message"] == "未登录"


def test_user_api_key_decrypts_stored_credential(monkeypatch) -> None:
    monkeypatch.setenv("CREDENTIAL_KEY", KEY)
    user_id = uuid4()
    sealed = base64.b64encode(encrypt("sk-user", load_key(KEY))).decode()

    class Store:
        async def get(self, model, key):
            assert model is UpstreamCredential
            assert key == user_id
            return UpstreamCredential(user_id=user_id, ciphertext=sealed)

    assert asyncio.run(user_api_key(Store(), user_id)) == "sk-user"


def test_conversations_require_session() -> None:
    app = create_app()

    async def empty_session():
        class Session:
            async def scalar(self, statement):
                return None

            async def commit(self):
                return None

            async def rollback(self):
                return None

        yield Session()

    app.dependency_overrides[get_session] = empty_session
    response = TestClient(app).get("/api/conversations")
    assert response.status_code == 401
    assert response.json()["message"] == "未登录"


def test_require_user_rejects_expired_session() -> None:
    user = User(
        id=uuid4(),
        upstream_user_id="up-1",
        email="user@example.com",
        display_name="显示名",
        role="user",
        status="active",
    )
    row = AuthSession(
        user_id=user.id,
        token_hash=hash_token("token"),
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )

    class Lookup:
        async def scalar(self, statement):
            del statement
            return row

        async def get(self, model, key):
            del model, key
            return user

    with pytest.raises(BizException, match="未登录"):
        _run(require_user(Lookup(), "token"))


def test_logout_deletes_session() -> None:
    store = _Store()
    row = AuthSession(user_id=uuid4(), token_hash=hash_token("token"), expires_at=datetime.now(UTC))
    store.row = row
    _run(logout(store, "token"))
    assert store.deleted is row


class _Store:
    def __init__(self) -> None:
        self.user = None
        self.credential = None
        self.row = None
        self.added: list = []
        self.deleted = None

    async def scalar(self, statement):
        del statement
        return self.row if self.row is not None else self.user

    async def get(self, model, key):
        del model, key
        return self.credential

    def add(self, obj) -> None:
        self.added.append(obj)
        if isinstance(obj, User):
            obj.id = uuid4()
            self.user = obj
        if isinstance(obj, UpstreamCredential):
            self.credential = obj

    async def flush(self) -> None:
        return None

    async def delete(self, obj) -> None:
        self.deleted = obj


def _oauth_env(monkeypatch) -> None:
    monkeypatch.setenv("SUB2API_BASE_URL", "https://unigate.top")
    monkeypatch.setenv("SUB2API_CLIENT_ID", "chat")
    monkeypatch.setenv("SUB2API_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SUB2API_REDIRECT_URI", "https://chat.example/api/auth/callback")
    monkeypatch.setenv("CREDENTIAL_KEY", KEY)


def _config():
    from chatbot.framework.config.oauth import get_oauth_settings

    config = get_oauth_settings()
    assert config is not None
    return config


def _key() -> bytes:
    return base64.b64decode(KEY)


def _token_body(**overrides) -> dict:
    body = {
        "upstream_user_id": "up-1",
        "email": "user@example.com",
        "username": "显示名",
        "credential": "upstream-secret",
    }
    body.update(overrides)
    return body


def _run(awaitable):
    import asyncio

    return asyncio.run(awaitable)
