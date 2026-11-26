import json

import pytest
from fastapi.testclient import TestClient
from qiniu import Auth
from qiniu.utils import urlsafe_base64_decode

from chatbot.bootstrap.app import create_app
from chatbot.bootstrap.deps import current_user
from chatbot.framework.exceptions.biz import BizException
from chatbot.framework.storage.qiniu import issue_upload_credential, public_url, verify_upload_callback


def _env(monkeypatch) -> None:
    monkeypatch.setenv("QINIU_ACCESS_KEY", "ak")
    monkeypatch.setenv("QINIU_SECRET_KEY", "sk")
    monkeypatch.setenv("QINIU_BUCKET", "chat-images")
    monkeypatch.setenv("QINIU_DOMAIN", "cdn.example.com")
    monkeypatch.delenv("QINIU_CALLBACK_URL", raising=False)


def test_public_url_encodes_key() -> None:
    assert public_url("https://cdn.example.com", "chat/images/1.png") == (
        "https://cdn.example.com/chat/images/1.png"
    )


def test_issue_upload_credential_limits_one_object(monkeypatch) -> None:
    _env(monkeypatch)
    credential = issue_upload_credential("image/png")
    policy = json.loads(urlsafe_base64_decode(credential.token.split(":")[2]))
    assert policy["scope"] == f"chat-images:{credential.key}"
    assert policy["fsizeLimit"] == 10 * 1024 * 1024
    assert policy["mimeLimit"] == "image/png"
    assert "callbackUrl" not in policy
    assert credential.upload_url == "https://upload.qiniup.com"
    assert credential.url == public_url("https://cdn.example.com", credential.key)


def test_issue_portrait_credential(monkeypatch) -> None:
    _env(monkeypatch)
    credential = issue_upload_credential("image/webp", "persona_portrait")
    assert credential.key.startswith("persona/portraits/")
    assert credential.key.endswith(".webp")


def test_issue_portrait_credential_rejects_document(monkeypatch) -> None:
    _env(monkeypatch)
    with pytest.raises(BizException) as error:
        issue_upload_credential("application/pdf", "persona_portrait")
    assert error.value.code == 400


def test_issue_upload_credential_rejects_unknown_type(monkeypatch) -> None:
    _env(monkeypatch)
    with pytest.raises(BizException) as error:
        issue_upload_credential("application/zip")
    assert error.value.code == 400


def test_verify_upload_callback(monkeypatch) -> None:
    _env(monkeypatch)
    url = "http://testserver/api/storage/callback"
    body = "key=chat/files/1.pdf&hash=abc&mimeType=application/pdf&fsize=12"
    authorization = "QBox " + Auth("ak", "sk").token_of_request(
        url, body, "application/x-www-form-urlencoded"
    )
    assert verify_upload_callback(authorization, url, body.encode(), "application/x-www-form-urlencoded")
    assert not verify_upload_callback("QBox ak:bad", url, body.encode(), "application/x-www-form-urlencoded")


def test_upload_token_route(monkeypatch) -> None:
    _env(monkeypatch)
    app = create_app()

    async def logged_in():
        return object()

    app.dependency_overrides[current_user] = logged_in
    response = TestClient(app).post(
        "/api/storage/upload-token",
        json={"content_type": "application/pdf"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["key"].startswith("chat/files/")
    assert payload["key"].endswith(".pdf")
    assert payload["upload_url"] == "https://upload.qiniup.com"
