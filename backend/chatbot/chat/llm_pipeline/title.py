"""会话标题管线。"""

from langchain_core.messages import SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda

from chatbot.framework.gemini import create_gemini_chat
from chatbot.chat.llm_pipeline.text import clean_title, frame_title_input, reply_text
from chatbot.chat.llm_pipeline.prompt import prompt_factory
from chatbot.framework.const import Prompt
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException

_TITLE_MODEL = "gemini-3.8-flash"


def build_title_chain(api_key: str):
    prompt = ChatPromptTemplate.from_messages(
        [
            SystemMessage(content=prompt_factory.load(Prompt.CONVERSATION_TITLE)),
            ("human", "{dialogue}"),
        ]
    )
    return prompt | create_gemini_chat(_TITLE_MODEL, api_key) | RunnableLambda(_title_from_message)


async def generate_title(messages: list[tuple[str, str]], api_key: str) -> str:
    dialogue = frame_title_input(messages)
    if not dialogue:
        raise BizException("没有可用于生成标题的消息", code=BizCode.BAD_REQUEST)
    title = await build_title_chain(api_key).ainvoke({"dialogue": dialogue})
    if not title:
        raise BizException("标题生成失败", code=BizCode.BAD_GATEWAY)
    return title


def _title_from_message(message: object) -> str:
    content = message.content if hasattr(message, "content") else message
    return clean_title(reply_text(content))
