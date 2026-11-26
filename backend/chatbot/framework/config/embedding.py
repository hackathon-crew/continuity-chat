"""全局向量模型。费用由部署方承担，不进入中转计费。"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class EmbeddingConfig:
    url: str
    api_key: str
    embedding_model: str
    dimensions: int


def get_embedding_settings() -> EmbeddingConfig | None:
    url = os.environ.get("EMBEDDING_URL", "").strip().rstrip("/")
    api_key = os.environ.get("EMBEDDING_API_KEY", "").strip()
    embedding_model = os.environ.get("EMBEDDING_MODEL", "").strip()
    if not url or not api_key or not embedding_model:
        return None
    return EmbeddingConfig(
        url=url,
        api_key=api_key,
        embedding_model=embedding_model,
        dimensions=_dimensions(),
    )


def _dimensions() -> int:
    raw = os.environ.get("EMBEDDING_DIMENSIONS", "").strip()
    if not raw:
        return 4096
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError("EMBEDDING_DIMENSIONS 必须是整数") from error
    if value < 1:
        raise RuntimeError("EMBEDDING_DIMENSIONS 必须大于 0")
    return value
