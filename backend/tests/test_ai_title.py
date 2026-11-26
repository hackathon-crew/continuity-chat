from chatbot.chat.llm_pipeline.text import clean_title, frame_title_input


def test_clean_title_keeps_first_line() -> None:
    assert clean_title("  「今天的天气」\n不要解释  ") == "今天的天气"


def test_clean_title_collapses_space() -> None:
    assert clean_title('  "你好   世界"  ') == "你好 世界"


def test_clean_title_empty() -> None:
    assert clean_title("   \n  ") == ""


def test_frame_title_names_the_first_message() -> None:
    framed = frame_title_input([("user", "帮我排查生产环境的 500 报错")])
    assert "<message>" in framed
    assert "帮我排查生产环境的 500 报错" in framed
    assert framed.endswith("只回复标题。")
    assert "user:" not in framed


def test_frame_title_keeps_original_request_and_recent_turns() -> None:
    framed = frame_title_input(
        [
            ("user", "最初想看合同"),
            ("assistant", "合同在第三页"),
            ("user", "改一下金额"),
        ]
    )
    assert "<conversation>" in framed
    assert "最初的请求：" in framed
    assert "最初想看合同" in framed
    assert "助手：合同在第三页" in framed
    assert "用户：改一下金额" in framed
    assert "<message>" not in framed
