"""七牛云 Kodo。浏览器直传文件，服务器只保存密钥并核对签名。"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class QiniuConfig:
    access_key: str
    secret_key: str
    bucket: str
    domain: str
    callback_url: str | None


def get_qiniu_settings() -> QiniuConfig | None:
    access_key = os.environ.get("QINIU_ACCESS_KEY", "").strip()
    secret_key = os.environ.get("QINIU_SECRET_KEY", "").strip()
    bucket = os.environ.get("QINIU_BUCKET", "").strip()
    domain = os.environ.get("QINIU_DOMAIN", "").strip().rstrip("/")
    if not access_key or not secret_key or not bucket or not domain:
        return None
    if not domain.startswith(("http://", "https://")):
        domain = f"https://{domain}"
    callback_url = os.environ.get("QINIU_CALLBACK_URL", "").strip() or None
    return QiniuConfig(
        access_key=access_key,
        secret_key=secret_key,
        bucket=bucket,
        domain=domain,
        callback_url=callback_url,
    )
