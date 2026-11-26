"""签发七牛直传凭证，并核对七牛回调签名。文件字节不经过本服务。"""

import json
from dataclasses import dataclass
from urllib.parse import parse_qs, quote

from qiniu import Auth

from chatbot.framework.config.qiniu import QiniuConfig, get_qiniu_settings
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.framework.utils.snowflake import next_id

_UPLOAD_URL = "https://upload.qiniup.com"
_TOKEN_SECONDS = 3600
_IMAGE_BYTES = 10 * 1024 * 1024
_FILE_BYTES = 20 * 1024 * 1024
_TYPES = {
    "image/jpeg": ("jpg", "chat/images", _IMAGE_BYTES),
    "image/png": ("png", "chat/images", _IMAGE_BYTES),
    "image/webp": ("webp", "chat/images", _IMAGE_BYTES),
    "image/gif": ("gif", "chat/images", _IMAGE_BYTES),
    "application/pdf": ("pdf", "chat/files", _FILE_BYTES),
    "text/plain": ("txt", "chat/files", _FILE_BYTES),
    "text/markdown": ("md", "chat/files", _FILE_BYTES),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
        "docx",
        "chat/files",
        _FILE_BYTES,
    ),
}


@dataclass(frozen=True)
class UploadCredential:
    token: str
    key: str
    upload_url: str
    url: str


def public_url(domain: str, key: str) -> str:
    return f"{domain}/{quote(key, safe='/')}"


def issue_upload_credential(content_type: str, purpose: str = "chat") -> UploadCredential:
    settings = _settings()
    spec = _TYPES.get(content_type.strip().lower())
    if spec is None:
        raise BizException("不支持的文件类型", code=BizCode.BAD_REQUEST)
    extension, prefix, limit = spec
    if purpose == "persona_portrait":
        if prefix != "chat/images":
            raise BizException("不支持的文件类型", code=BizCode.BAD_REQUEST)
        prefix = "persona/portraits"
    elif purpose != "chat":
        raise BizException("上传用途无效", code=BizCode.BAD_REQUEST)
    key = f"{prefix}/{next_id()}.{extension}"
    policy = {
        "insertOnly": 1,
        "fsizeLimit": limit,
        "mimeLimit": content_type.strip().lower(),
        "returnBody": json.dumps(
            {"key": "$(key)", "hash": "$(etag)", "mimeType": "$(mimeType)", "fsize": "$(fsize)"},
            separators=(",", ":"),
        ),
    }
    if settings.callback_url is not None:
        policy["callbackUrl"] = settings.callback_url
        policy["callbackBody"] = "key=$(key)&hash=$(etag)&mimeType=$(mimeType)&fsize=$(fsize)"
        policy["callbackBodyType"] = "application/x-www-form-urlencoded"
    token = Auth(settings.access_key, settings.secret_key).upload_token(
        settings.bucket, key, _TOKEN_SECONDS, policy
    )
    return UploadCredential(
        token=token,
        key=key,
        upload_url=_UPLOAD_URL,
        url=public_url(settings.domain, key),
    )


def verify_upload_callback(authorization: str, url: str, body: bytes, content_type: str) -> bool:
    settings = _settings()
    mime = content_type.split(";", 1)[0].strip().lower() or "application/x-www-form-urlencoded"
    text = body.decode("utf-8")
    return Auth(settings.access_key, settings.secret_key).verify_callback(
        authorization,
        url,
        text,
        content_type=mime,
        method="POST",
    )


def callback_file_url(body: bytes) -> str:
    settings = _settings()
    key = parse_qs(body.decode("utf-8"), keep_blank_values=True).get("key", [""])[0]
    if not key.startswith(("chat/images/", "chat/files/", "persona/portraits/")):
        raise BizException("上传文件无效", code=BizCode.BAD_REQUEST)
    return public_url(settings.domain, key)


def _settings() -> QiniuConfig:
    settings = get_qiniu_settings()
    if settings is None:
        raise BizException("缺少七牛云配置", code=BizCode.INTERNAL_ERROR)
    return settings
