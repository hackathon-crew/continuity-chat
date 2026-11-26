from uuid import uuid4

import pytest

from chatbot.chat.conversation.schemas import parse_model
from chatbot.chat.context.schemas import SummarySave
from chatbot.chat.message.schemas import MessageCreate, parse_limit, parse_order
from chatbot.framework.exceptions.biz import BizException


def test_message_keeps_part_order_and_separates_grounding() -> None:
    data = parse_model(
        MessageCreate,
        {
            "user_id": uuid4(),
            "role": "assistant",
            "finish_reason": " STOP ",
            "parts": [
                {"text": "  先看付款节点  ", "thought": True, "thought_signature": " sig "},
                {"text": "签约后 5 个工作日付 30%。"},
            ],
            "grounding_metadata": {
                "web_search_queries": ["合同 付款节点"],
                "grounding_chunks": [{"web": {"uri": "https://example.com/pay", "title": "付款条款"}}],
                "grounding_supports": [
                    {
                        "segment": {"part_index": 1, "start_index": 0, "end_index": 18, "text": "签约后 5 个工作日付 30%。"},
                        "grounding_chunk_indices": [0],
                    }
                ],
            },
        },
    )
    assert data.parts[0].thought is True
    assert data.parts[0].thought_signature == "sig"
    assert data.parts[1].text == "签约后 5 个工作日付 30%。"
    assert data.grounding_metadata is not None
    assert data.grounding_metadata.grounding_supports[0].segment.part_index == 1
    assert data.finish_reason == "STOP"


def test_user_message_keeps_upload_order() -> None:
    data = parse_model(
        MessageCreate,
        {
            "user_id": uuid4(),
            "role": "user",
            "parts": [
                {"text": "  看图  "},
                {"image": {"url": "https://cdn.example.com/chat/images/1.png", "name": " a.png "}},
                {"file": {"url": "https://cdn.example.com/chat/files/3.pdf", "name": "合同.pdf", "text": "  正文  "}},
            ],
        },
    )
    assert data.parts[0].text == "看图"
    assert data.parts[1].image is not None
    assert data.parts[1].image.url == "https://cdn.example.com/chat/images/1.png"
    assert data.parts[1].image.name == "a.png"
    assert data.parts[2].file is not None
    assert data.parts[2].file.text == "正文"


def test_message_allows_image_and_file_without_text() -> None:
    data = parse_model(
        MessageCreate,
        {
            "user_id": uuid4(),
            "role": "user",
            "parts": [
                {"image": {"url": "https://cdn.example.com/chat/images/1.png"}},
                {"file": {"url": "https://cdn.example.com/chat/files/3.pdf", "text": "  "}},
            ],
        },
    )
    assert data.parts[0].image is not None
    assert data.parts[0].image.name is None
    assert data.parts[1].file is not None
    assert data.parts[1].file.text is None


def test_message_rejects_invalid_parts() -> None:
    with pytest.raises(BizException, match="消息内容不能为空"):
        parse_model(MessageCreate, {"user_id": uuid4(), "role": "assistant", "parts": []})
    with pytest.raises(BizException, match="文字不能为空"):
        parse_model(MessageCreate, {"user_id": uuid4(), "role": "assistant", "parts": [{"text": "  "}]})
    with pytest.raises(BizException, match="文件地址无效"):
        parse_model(
            MessageCreate,
            {"user_id": uuid4(), "role": "user", "parts": [{"image": {"url": "cdn.example.com/a.png"}}]},
        )
    with pytest.raises(BizException, match="引用位置无效"):
        parse_model(
            MessageCreate,
            {
                "user_id": uuid4(),
                "role": "assistant",
                "parts": [{"text": "回答"}],
                "grounding_metadata": {
                    "grounding_supports": [{"segment": {"part_index": 2}, "grounding_chunk_indices": []}]
                },
            },
        )


def test_summary_rejects_unknown_message() -> None:
    with pytest.raises(BizException, match="消息编号无效"):
        parse_model(SummarySave, {"user_id": uuid4(), "content": "摘要", "until_message_id": 0})


def test_limit_and_order() -> None:
    assert parse_limit(None) is None
    assert parse_limit(20) == 20
    assert parse_order(None) == "asc"
    assert parse_order("desc") == "desc"
    with pytest.raises(BizException, match="消息条数无效"):
        parse_limit(0)
    with pytest.raises(BizException, match="排序方式无效"):
        parse_order("random")
