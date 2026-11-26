"""从模型回复里取出纯文本，并把待命名的对话包成标题请求。"""

from chatbot.chat.conversation.schemas import TITLE_MAX

_MAX_CONTEXT = 8000
_MAX_FIRST = 2000


def frame_title_input(messages: list[tuple[str, str]]) -> str:
    """第一条消息单独命名。已有后续对话时，带上最初请求和最近内容。"""
    rows = [(role, content.strip()) for role, content in messages if content and content.strip()]
    if not rows:
        return ""
    if len(rows) == 1:
        return _message_frame(rows[0][1])
    first = next((text for role, text in rows if role == "user"), rows[0][1])
    original = f"最初的请求：\n{first[:_MAX_FIRST]}"
    recent = _recent(rows)
    if not recent:
        return _conversation_frame(original)
    prefix = f"{original}\n\n最近的对话：\n"
    budget = _MAX_CONTEXT - len(_conversation_frame("")) - len(prefix)
    if len(recent) > budget:
        recent = recent[-budget:] if budget > 0 else ""
    return _conversation_frame(f"{prefix}{recent}")


def _message_frame(text: str) -> str:
    return f"下面是这段对话的第一条消息：\n\n<message>\n{text}\n</message>\n\n只回复标题。"


def _conversation_frame(text: str) -> str:
    return f"下面是到目前为止的对话：\n\n<conversation>\n{text}\n</conversation>\n\n只回复标题。"


def _recent(rows: list[tuple[str, str]]) -> str:
    skipped = False
    lines: list[str] = []
    for role, text in rows:
        if role == "user" and not skipped:
            skipped = True
            continue
        label = "用户" if role == "user" else "助手"
        lines.append(f"{label}：{text}")
    return "\n\n".join(lines)


def clean_title(text: str) -> str:
    line = text.strip().splitlines()[0].strip() if text.strip() else ""
    line = line.strip("\"'“”‘’「」")
    line = " ".join(line.split())
    return line[:TITLE_MAX]


def reply_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "\n".join(parts)
    return ""
