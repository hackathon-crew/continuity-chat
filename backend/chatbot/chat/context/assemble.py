"""把一场对话拼成送给模型的顺序。图片字节由调用方读好后传入。"""

from chatbot.chat.llm_pipeline.prompt import prompt_factory
from chatbot.chat.memory.schemas import MemoryItem, MemoryLoaded
from chatbot.framework.const import Prompt


def turn_query(parts: list[dict]) -> str:
    """联想只用本轮文字。没有文字时用文件名。只有图片时返回空字符串。"""
    texts = [_text(part) for part in parts if _text(part)]
    if texts:
        return "\n".join(texts)
    names = [str(part["file"]["name"]).strip() for part in parts if _file_name(part)]
    return "\n".join(names)


def turn_title(parts: list[dict]) -> str:
    query = turn_query(parts)
    if query:
        return query
    return "图片"


def build_prompt(
    persona,
    summary: str,
    history: list,
    loaded: MemoryLoaded,
    current_parts: list[dict],
    images: dict[str, tuple[bytes, str]],
) -> list[dict]:
    """前缀、窗口原文、post_history、联想、当前这轮。立绘不进入结果。"""
    messages: list[dict] = [{"role": "system", "parts": [{"text": _prefix(persona, summary, loaded)}]}]
    for message in history:
        messages.append({"role": message.role, "parts": _model_parts(_as_dicts(message.parts), images)})
    if persona.post_history.strip():
        messages.append({"role": "system", "parts": [{"text": persona.post_history.strip()}]})
    if loaded.associative:
        lines = "\n".join(f"- {item.text}" for item in loaded.associative)
        messages.append({"role": "system", "parts": [{"text": f"相关记忆：\n{lines}"}]})
    messages.append({"role": "user", "parts": _model_parts(current_parts, images)})
    return messages


def _prefix(persona, summary: str, loaded: MemoryLoaded) -> str:
    system = persona.system_prompt.strip() or prompt_factory.load(Prompt.CHAT_SYSTEM)
    blocks = [
        system,
        f"名字：{persona.name.strip()}",
        f"描述：{persona.description.strip()}",
        f"性格：{persona.personality.strip()}",
    ]
    if persona.scenario.strip():
        blocks.append(f"情景：{persona.scenario.strip()}")
    if persona.example_dialogue.strip():
        blocks.append(f"示例对话：\n{persona.example_dialogue.strip()}")
    blocks.append(_memory_block("自我", loaded.self_memories))
    blocks.append(_memory_block("近事", loaded.recent))
    blocks.append(f"本场摘要：\n{summary.strip() or '无'}")
    return "\n\n".join(blocks)


def _memory_block(title: str, items: list[MemoryItem]) -> str:
    if not items:
        return f"{title}：\n无"
    lines = "\n".join(f"- {item.text}" for item in items)
    return f"{title}：\n{lines}"


def _model_parts(parts: list[dict], images: dict[str, tuple[bytes, str]]) -> list[dict]:
    converted: list[dict] = []
    for part in parts:
        if part.get("thought") is True and _text(part):
            converted.append(
                {
                    "text": _text(part),
                    "thought": True,
                    "thought_signature": part.get("thought_signature"),
                }
            )
            continue
        if _text(part) and "image" not in part and "file" not in part:
            converted.append({"text": _text(part)})
            continue
        image = part.get("image")
        if isinstance(image, dict) and image.get("url"):
            data, mime = images[str(image["url"])]
            converted.append({"image": {"data": data, "mime_type": mime}})
            continue
        file = part.get("file")
        if isinstance(file, dict):
            name = str(file.get("name") or "文件").strip()
            body = str(file.get("text") or "").strip()
            converted.append({"text": f"文件 {name}：\n{body}"})
    return converted


def _as_dicts(parts: object) -> list[dict]:
    rows: list[dict] = []
    if not isinstance(parts, list):
        return rows
    for part in parts:
        if hasattr(part, "model_dump"):
            rows.append(part.model_dump(exclude_none=True))
        elif isinstance(part, dict):
            rows.append(part)
    return rows


def _text(part: dict) -> str:
    value = part.get("text")
    return value.strip() if isinstance(value, str) else ""


def _file_name(part: dict) -> bool:
    file = part.get("file")
    return isinstance(file, dict) and isinstance(file.get("name"), str) and bool(file["name"].strip())
