"""按中转站地址组装 Gemini 对话客户端。调用方传入该用户的 Key。"""

from langchain_google_genai import ChatGoogleGenerativeAI

from chatbot.framework.config.upstream import get_upstream_settings
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException


def create_gemini_chat(model: str, api_key: str) -> ChatGoogleGenerativeAI:
    settings = get_upstream_settings()
    key = api_key.strip()
    if settings is None or not key:
        raise BizException("缺少中转站地址或调用 Key", code=BizCode.INTERNAL_ERROR)
    name = model.strip()
    if not name:
        raise BizException("缺少模型名称", code=BizCode.BAD_REQUEST)
    return ChatGoogleGenerativeAI(
        model=name,
        google_api_key=key,
        base_url=settings.base_url,
        api_version="v1beta",
    )
