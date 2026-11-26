import base64

from chatbot.framework.crypto.secrets import decrypt, encrypt, load_key


def test_encrypt_roundtrip() -> None:
    key = load_key(base64.b64encode(b"k" * 32).decode())
    payload = encrypt("upstream-credential", key)
    assert decrypt(payload, key) == "upstream-credential"
    assert payload != encrypt("upstream-credential", key)
