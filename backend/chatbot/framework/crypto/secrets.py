"""用 AES-GCM 加密上游调用凭证。"""

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def load_key(value: str) -> bytes:
    try:
        key = base64.b64decode(value, validate=True)
    except Exception as error:
        raise ValueError("CREDENTIAL_KEY 不是合法的 Base64") from error
    if len(key) != 32:
        raise ValueError("CREDENTIAL_KEY 解码后必须是 32 字节")
    return key


def encrypt(plaintext: str, key: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plaintext.encode(), None)


def decrypt(payload: bytes, key: bytes) -> str:
    return AESGCM(key).decrypt(payload[:12], payload[12:], None).decode()
