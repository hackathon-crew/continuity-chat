"""中转站授权码登录配置。对话用的全局 Key 不在这里。"""

import os
from dataclasses import dataclass

from chatbot.framework.crypto.secrets import load_key


@dataclass(frozen=True)
class OAuthConfig:
    base_url: str
    client_id: str
    client_secret: str
    redirect_uri: str
    credential_key: bytes


def get_oauth_settings() -> OAuthConfig | None:
    base_url = os.environ.get("SUB2API_BASE_URL", "").strip().rstrip("/")
    client_id = os.environ.get("SUB2API_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SUB2API_CLIENT_SECRET", "").strip()
    redirect_uri = os.environ.get("SUB2API_REDIRECT_URI", "").strip()
    key_text = os.environ.get("CREDENTIAL_KEY", "").strip()
    if not base_url or not client_id or not client_secret or not redirect_uri or not key_text:
        return None
    return OAuthConfig(
        base_url=base_url,
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        credential_key=load_key(key_text),
    )
