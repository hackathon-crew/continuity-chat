"""从原文生成摘要、候选短句和分类结论。不读取、也不写入 Mem0。"""

import json

from langchain_core.messages import SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda

from chatbot.chat.llm_pipeline.candidates import MemoryCandidate, MemoryDecision, parse_candidates, parse_decisions
from chatbot.chat.llm_pipeline.prompt import prompt_factory
from chatbot.chat.llm_pipeline.text import reply_text
from chatbot.chat.memory.service import MemoryItem
from chatbot.framework.const import Prompt
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.enums.memory import MemoryScene
from chatbot.framework.exceptions.biz import BizException
from chatbot.framework.gemini import create_gemini_chat

_MODEL = "gemini-3.8-flash"


def summary_prompt(scene: str) -> str:
    """工作会话和闲聊会话各用一份摘要提示词。"""
    if scene == MemoryScene.WORK:
        return Prompt.CONSOLIDATION_SUMMARY_WORK
    if scene == MemoryScene.PRIVATE:
        return Prompt.CONSOLIDATION_SUMMARY_PRIVATE
    raise BizException("场景无效", code=BizCode.BAD_REQUEST)


async def generate_summary(dialogue: str, previous: str, api_key: str, scene: str) -> str:
    text = await _invoke(
        summary_prompt(scene),
        f"已有摘要：\n{previous.strip() or '无'}\n\n原文：\n{dialogue}",
        api_key,
    )
    if not text:
        raise BizException("摘要生成失败", code=BizCode.BAD_GATEWAY)
    return text


async def extract_candidates(dialogue: str, on, api_key: str) -> list[MemoryCandidate]:
    text = await _invoke(Prompt.CONSOLIDATION_EXTRACT, f"原文：\n{dialogue}", api_key)
    return parse_candidates(text, on)


async def classify_candidates(
    rows: list[tuple[MemoryCandidate, list[MemoryItem]]],
    api_key: str,
) -> list[MemoryDecision]:
    payload = [
        {
            "text": candidate.text,
            "topic": candidate.topic,
            "identity": candidate.identity,
            "memories": [{"id": item.id, "text": item.text} for item in neighbors],
        }
        for candidate, neighbors in rows
    ]
    text = await _invoke(
        Prompt.CONSOLIDATION_CLASSIFY,
        json.dumps({"items": payload}, ensure_ascii=False),
        api_key,
    )
    return parse_decisions(text, len(rows))


async def _invoke(prompt_name: str, content: str, api_key: str) -> str:
    prompt = ChatPromptTemplate.from_messages(
        [SystemMessage(content=prompt_factory.load(prompt_name)), ("human", "{content}")]
    )
    chain = prompt | create_gemini_chat(_MODEL, api_key) | RunnableLambda(_text)
    return await chain.ainvoke({"content": content})


def _text(message: object) -> str:
    content = message.content if hasattr(message, "content") else message
    return reply_text(content).strip()
