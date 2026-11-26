from fastapi.testclient import TestClient

from chatbot.bootstrap.app import create_app
from chatbot.framework.db import Base
from chatbot.chat import models as _chat_models
from chatbot.system import models as _models

assert _models is not None and _chat_models is not None


def test_health() -> None:
    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_schema_tables() -> None:
    assert set(Base.metadata.tables) == {
        "users",
        "upstream_credentials",
        "auth_sessions",
        "audit_logs",
        "personas",
        "user_personas",
        "conversations",
        "messages",
        "conversation_summaries",
    }
