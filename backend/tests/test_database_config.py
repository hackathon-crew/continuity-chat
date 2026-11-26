from chatbot.framework.config.database import get_database_settings


def test_database_settings(monkeypatch) -> None:
    monkeypatch.setenv("POSTGRES_HOST", "127.0.0.1")
    monkeypatch.setenv("POSTGRES_PORT", "5432")
    monkeypatch.setenv("POSTGRES_USER", "chat bot")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p@ss")
    monkeypatch.setenv("POSTGRES_DATABASE", "chatbot")
    monkeypatch.setenv("POSTGRES_POOL_SIZE", "8")
    monkeypatch.setenv("POSTGRES_POOL_PRE_PING", "false")
    settings = get_database_settings()
    assert settings is not None
    assert settings.url == "postgresql+asyncpg://chat+bot:p%40ss@127.0.0.1:5432/chatbot"
    assert settings.pool_size == 8
    assert settings.max_overflow == 10
    assert settings.pool_pre_ping is False
    assert settings.command_timeout == 30


def test_database_settings_absent(monkeypatch) -> None:
    monkeypatch.delenv("POSTGRES_HOST", raising=False)
    monkeypatch.setenv("POSTGRES_USER", "chatbot")
    monkeypatch.setenv("POSTGRES_DATABASE", "chatbot")
    assert get_database_settings() is None
