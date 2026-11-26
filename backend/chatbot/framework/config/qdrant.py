"""Mem0 使用的外接 Qdrant。"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class QdrantConfig:
    host: str
    port: int
    api_key: str | None
    collection: str


def get_qdrant_settings() -> QdrantConfig | None:
    host = os.environ.get("QDRANT_HOST", "").strip()
    if not host:
        return None
    return QdrantConfig(
        host=host,
        port=_port(),
        api_key=os.environ.get("QDRANT_API_KEY", "").strip() or None,
        collection=os.environ.get("QDRANT_COLLECTION", "").strip() or "chat_memories",
    )


def _port() -> int:
    raw = os.environ.get("QDRANT_PORT", "").strip()
    if not raw:
        return 6333
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError("QDRANT_PORT 必须是整数") from error
    if not 1 <= value <= 65535:
        raise RuntimeError("QDRANT_PORT 无效")
    return value
