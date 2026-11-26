"""中转站地址。对话请求使用登录时保存的用户 Key。"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class UpstreamConfig:
    base_url: str


def get_upstream_settings() -> UpstreamConfig | None:
    base_url = _base_url()
    if not base_url:
        return None
    return UpstreamConfig(base_url=base_url)


def _base_url() -> str:
    return os.environ.get("SUB2API_BASE_URL", "").strip().rstrip("/")
