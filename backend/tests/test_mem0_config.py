from chatbot.chat.memory.mem0 import build_memory_config


def _env(monkeypatch) -> None:
    monkeypatch.setenv("EMBEDDING_URL", "https://embed.example/v1/")
    monkeypatch.setenv("EMBEDDING_API_KEY", "embed-key")
    monkeypatch.setenv("EMBEDDING_MODEL", "Qwen3-Embedding-8B")
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "4096")
    monkeypatch.setenv("QDRANT_HOST", "127.0.0.1")
    monkeypatch.setenv("QDRANT_PORT", "6333")
    monkeypatch.setenv("QDRANT_COLLECTION", "chat_memories")
    monkeypatch.delenv("QDRANT_API_KEY", raising=False)
    monkeypatch.setenv("SUB2API_BASE_URL", "https://unigate.top/")
    monkeypatch.setenv("SUB2API_API_KEY", "global-key")


def test_build_memory_config(monkeypatch) -> None:
    _env(monkeypatch)
    config = build_memory_config("user-key")
    assert config["vector_store"]["provider"] == "qdrant"
    assert config["vector_store"]["config"]["host"] == "127.0.0.1"
    assert config["vector_store"]["config"]["embedding_model_dims"] == 4096
    assert "api_key" not in config["vector_store"]["config"]
    assert config["embedder"]["config"]["openai_base_url"] == "https://embed.example/v1"
    assert config["embedder"]["config"]["model"] == "Qwen3-Embedding-8B"
    assert config["llm"]["config"]["openai_base_url"] == "https://unigate.top/v1"
    assert config["llm"]["config"]["api_key"] == "user-key"
