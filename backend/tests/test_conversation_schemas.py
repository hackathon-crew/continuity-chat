from datetime import UTC, datetime
from uuid import uuid4

import pytest

from chatbot.chat.conversation.schemas import (
    TITLE_MAX,
    ConversationRename,
    ConversationSave,
    parse_conversation_id,
    parse_model,
    title_from_question,
)
from chatbot.framework.exceptions.biz import BizException


def test_title_from_question_collapses_space() -> None:
    assert title_from_question("  今天   天气  ") == "今天 天气"


def test_title_from_question_truncates() -> None:
    assert title_from_question("问" * (TITLE_MAX + 10)) == "问" * TITLE_MAX


def test_title_from_question_rejects_blank() -> None:
    with pytest.raises(BizException, match="问题不能为空"):
        title_from_question("  \n  ")


def test_save_requires_timezone() -> None:
    with pytest.raises(BizException, match="时间需要带时区"):
        parse_model(
            ConversationSave,
            {
                "user_id": uuid4(),
                "persona_id": 1,
                "question": "你好",
                "last_message_at": datetime(2026, 1, 1),
            },
        )


def test_save_accepts_new_conversation() -> None:
    data = parse_model(
        ConversationSave,
        {
            "user_id": uuid4(),
            "persona_id": 1,
            "question": "  你好  ",
            "last_message_at": datetime(2026, 1, 1, tzinfo=UTC),
        },
    )
    assert data.conversation_id is None
    assert data.persona_id == 1
    assert data.question == "你好"


def test_rename_rejects_long_title() -> None:
    with pytest.raises(BizException, match="会话名称长度不能超过"):
        parse_model(ConversationRename, {"user_id": uuid4(), "title": "名" * (TITLE_MAX + 1)})


def test_save_rejects_invalid_persona_id() -> None:
    with pytest.raises(BizException, match="人设编号无效"):
        parse_model(ConversationSave, {"user_id": uuid4(), "persona_id": 0, "question": "你好"})


def test_parse_conversation_id() -> None:
    assert parse_conversation_id("42") == 42
    with pytest.raises(BizException, match="会话编号无效"):
        parse_conversation_id(0)
    with pytest.raises(BizException, match="会话编号无效"):
        parse_conversation_id("abc")
