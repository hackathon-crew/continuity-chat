"""把组装好的内容交给 Gemini，并取出正文或思考增量。"""

import base64
from collections.abc import AsyncIterator

from chatbot.chat.llm_pipeline.text import reply_text
from chatbot.framework.gemini import create_gemini_chat

_CHAT_MODEL = "gemini-3.8-flash"


async def stream_model(messages: list[dict], api_key: str) -> AsyncIterator[tuple[str, str]]:
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    chat = create_gemini_chat(_CHAT_MODEL, api_key)
    async for chunk in chat.astream(_langchain_messages(messages, AIMessage, HumanMessage, SystemMessage)):
        for event in chunk_events(chunk):
            yield event


def chunk_events(chunk: object) -> list[tuple[str, str, str | None]]:
    content = chunk.content if hasattr(chunk, "content") else chunk
    fallback = _signature(getattr(chunk, "additional_kwargs", None))
    events: list[tuple[str, str, str | None]] = []
    if isinstance(content, str):
        if content:
            events.append(("response", content, None))
        return events
    if isinstance(content, list):
        for block in content:
            if isinstance(block, str) and block:
                events.append(("response", block, None))
            elif isinstance(block, dict):
                text = reply_text(block.get("text"))
                if not text:
                    continue
                if block.get("thought") is True:
                    events.append(("thought", text, _signature(block) or fallback))
                else:
                    events.append(("response", text, None))
    return events


def _langchain_messages(messages, ai_message, human_message, system_message) -> list:
    converted = []
    for message in messages:
        content = [_block(part) for part in message["parts"]]
        role = message["role"]
        if role == "assistant":
            converted.append(ai_message(content=content))
        elif role == "system":
            converted.append(system_message(content=content))
        else:
            converted.append(human_message(content=content))
    return converted


def _block(part: dict) -> dict:
    image = part.get("image")
    if isinstance(image, dict) and isinstance(image.get("data"), bytes):
        encoded = base64.b64encode(image["data"]).decode()
        mime = image.get("mime_type") or "image/png"
        return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}}
    text = str(part.get("text") or "")
    if part.get("thought") is True:
        block = {"type": "text", "text": text, "thought": True}
        signature = _signature(part)
        if signature is not None:
            block["thought_signature"] = signature
        return block
    return {"type": "text", "text": text}


def _signature(value: object) -> str | None:
    if not isinstance(value, dict):
        return None
    for key in ("thought_signature", "thoughtSignature"):
        signature = value.get(key)
        if isinstance(signature, str) and signature.strip():
            return signature.strip()
    return None
