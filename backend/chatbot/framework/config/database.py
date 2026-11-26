"""PostgreSQL 连接、连接池和会话超时。"""

import os
from dataclasses import dataclass
from urllib.parse import quote_plus


@dataclass(frozen=True)
class DatabaseConfig:
    url: str
    pool_size: int
    max_overflow: int
    pool_timeout: int
    pool_recycle: int
    pool_pre_ping: bool
    command_timeout: int


def get_database_settings() -> DatabaseConfig | None:
    host = os.environ.get("POSTGRES_HOST", "").strip()
    user = os.environ.get("POSTGRES_USER", "").strip()
    database = os.environ.get("POSTGRES_DATABASE", "").strip()
    if not host or not user or not database:
        return None
    password = os.environ.get("POSTGRES_PASSWORD", "")
    port = _int("POSTGRES_PORT", 5432)
    url = (
        "postgresql+asyncpg://"
        f"{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(database)}"
    )
    return DatabaseConfig(
        url=url,
        pool_size=_int("POSTGRES_POOL_SIZE", 5),
        max_overflow=_int("POSTGRES_MAX_OVERFLOW", 10),
        pool_timeout=_int("POSTGRES_POOL_TIMEOUT", 30),
        pool_recycle=_int("POSTGRES_POOL_RECYCLE", 1800),
        pool_pre_ping=_bool("POSTGRES_POOL_PRE_PING", True),
        command_timeout=_int("POSTGRES_COMMAND_TIMEOUT", 30),
    )


def require_database_url() -> str:
    settings = get_database_settings()
    if settings is None:
        raise RuntimeError("缺少 PostgreSQL 连接配置")
    return settings.url


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} 必须是整数") from error
    if value < 0:
        raise RuntimeError(f"{name} 不能为负数")
    return value


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no"}:
        return False
    raise RuntimeError(f"{name} 必须是 true 或 false")
