from chatbot.framework.config.embedding import get_embedding_settings
from chatbot.framework.config.upstream import get_upstream_settings


def test_upstream_settings_absent(monkeypatch) -> None:
    monkeypatch.delenv("SUB2API_BASE_URL", raising=False)
    assert get_upstream_settings() is None


def test_upstream_settings(monkeypatch) -> None:
    monkeypatch.setenv("SUB2API_BASE_URL", "http://127.0.0.1:8080/")
    monkeypatch.setenv("SUB2API_API_KEY", "relay-key")
    settings = get_upstream_settings()
    assert settings is not None
    assert settings.base_url == "http://127.0.0.1:8080"
    assert not hasattr(settings, "api_key")


def test_embedding_settings(monkeypatch) -> None:
    monkeypatch.setenv("EMBEDDING_URL", "https://embed.example/v1/")
    monkeypatch.setenv("EMBEDDING_API_KEY", "embed-key")
    monkeypatch.setenv("EMBEDDING_MODEL", "Qwen3-Embedding-8B")
    settings = get_embedding_settings()
    assert settings is not None
    assert settings.url == "https://embed.example/v1"
    assert settings.api_key == "embed-key"
    assert settings.embedding_model == "Qwen3-Embedding-8B"
    assert settings.dimensions == 4096


def test_embedding_settings_requires_all_fields(monkeypatch) -> None:
    monkeypatch.setenv("EMBEDDING_URL", "https://embed.example/v1")
    monkeypatch.setenv("EMBEDDING_API_KEY", "embed-key")
    monkeypatch.delenv("EMBEDDING_MODEL", raising=False)
    assert get_embedding_settings() is None
