import pytest

from chatbot.chat.llm_pipeline.prompt import prompt_factory
from chatbot.framework.const import Prompt
from chatbot.framework.exceptions.biz import BizException


def test_summary_prompt_follows_the_scene() -> None:
    from chatbot.chat.llm_pipeline.consolidate import summary_prompt

    work = prompt_factory.load(summary_prompt("work"))
    private = prompt_factory.load(summary_prompt("private"))
    assert "## 工作状态" in work
    assert "## 闲聊" not in work
    assert "## 聊过的内容" in private
    assert "## 工作状态" not in private
    with pytest.raises(BizException, match="场景无效"):
        summary_prompt("both")


def test_load_chat_system() -> None:
    text = prompt_factory.load(Prompt.CHAT_SYSTEM)
    assert "自我" in text
    assert "相关记忆" in text
    assert "本场摘要" in text


def test_load_conversation_title() -> None:
    text = prompt_factory.load(Prompt.CONVERSATION_TITLE)
    assert "为对话命名" in text
    assert "仅回复一个标题" in text


def test_load_rejects_path() -> None:
    with pytest.raises(BizException, match="提示词名称无效"):
        prompt_factory.load("../const")


def test_load_rejects_missing_prompt() -> None:
    with pytest.raises(BizException, match="提示词不存在"):
        prompt_factory.load("missing")
