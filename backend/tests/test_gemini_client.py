import pytest

from chatbot.framework.gemini import create_gemini_chat
from chatbot.framework.exceptions.biz import BizException


def test_create_gemini_chat_requires_upstream(monkeypatch) -> None:
    monkeypatch.delenv("SUB2API_BASE_URL", raising=False)
    with pytest.raises(BizException, match="缺少中转站地址或调用 Key"):
        create_gemini_chat("gemini-2.5-flash", "user-key")


def test_create_gemini_chat_requires_model(monkeypatch) -> None:
    monkeypatch.setenv("SUB2API_BASE_URL", "https://unigate.top")
    with pytest.raises(BizException, match="缺少模型名称"):
        create_gemini_chat("  ", "user-key")


def test_create_gemini_chat_requires_user_key(monkeypatch) -> None:
    monkeypatch.setenv("SUB2API_BASE_URL", "https://unigate.top")
    monkeypatch.setenv("SUB2API_API_KEY", "global-key")
    with pytest.raises(BizException, match="缺少中转站地址或调用 Key"):
        create_gemini_chat("gemini-2.5-flash", "  ")


def test_create_gemini_chat(monkeypatch) -> None:
    monkeypatch.setenv("SUB2API_BASE_URL", "https://unigate.top/")
    monkeypatch.setenv("SUB2API_API_KEY", "global-key")
    chat = create_gemini_chat("gemini-2.5-flash", "user-key")
    assert chat.model == "gemini-2.5-flash"
    assert chat.base_url == "https://unigate.top"
    assert chat.api_version == "v1beta"
    options = chat.client._api_client._http_options
    assert options.base_url == "https://unigate.top"
    assert options.api_version == "v1beta"
    assert options.headers["x-goog-api-key"] == "user-key"
