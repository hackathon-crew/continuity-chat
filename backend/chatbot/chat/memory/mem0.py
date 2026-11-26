"""组装自托管 Mem0。向量库存放在外接 Qdrant，向量模型使用全局 embedding 配置。"""

from chatbot.framework.config.embedding import get_embedding_settings
from chatbot.framework.config.qdrant import get_qdrant_settings
from chatbot.framework.config.upstream import get_upstream_settings
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException


def build_memory_config(api_key: str) -> dict:
    embedding = get_embedding_settings()
    qdrant = get_qdrant_settings()
    upstream = get_upstream_settings()
    key = api_key.strip()
    if embedding is None:
        raise BizException("缺少向量模型配置", code=BizCode.INTERNAL_ERROR)
    if qdrant is None:
        raise BizException("缺少 Qdrant 配置", code=BizCode.INTERNAL_ERROR)
    if upstream is None or not key:
        raise BizException("缺少中转站配置", code=BizCode.INTERNAL_ERROR)
    vector_store: dict = {
        "host": qdrant.host,
        "port": qdrant.port,
        "collection_name": qdrant.collection,
        "embedding_model_dims": embedding.dimensions,
    }
    if qdrant.api_key is not None:
        vector_store["api_key"] = qdrant.api_key
    return {
        "vector_store": {"provider": "qdrant", "config": vector_store},
        "embedder": {
            "provider": "openai",
            "config": {
                "model": embedding.embedding_model,
                "api_key": embedding.api_key,
                "openai_base_url": embedding.url,
                "embedding_dims": embedding.dimensions,
            },
        },
        "llm": {
            "provider": "openai",
            "config": {
                "model": "gemini-3.8-flash",
                "api_key": key,
                "openai_base_url": f"{upstream.base_url}/v1",
            },
        },
    }


def create_memory(api_key: str):
    from mem0 import Memory

    return Memory.from_config(build_memory_config(api_key))


def call_memory(action):
    """调用 Mem0。找不到记为不存在，其余连接失败记为记忆服务不可用。"""
    try:
        return action()
    except BizException:
        raise
    except ValueError as error:
        if "not found" in str(error).lower():
            raise BizException("记忆不存在", code=BizCode.NOT_FOUND) from error
        raise BizException("记忆参数无效", code=BizCode.BAD_REQUEST) from error
    except Exception as error:
        raise BizException("记忆服务不可用", code=BizCode.BAD_GATEWAY) from error
