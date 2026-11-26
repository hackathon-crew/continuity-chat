"""产品自己发起的模型管线。

步骤是加载提示词、组装提示、调用模型、取出结果。
目前包含会话标题、一轮对话的默认系统提示词。窗口滑动时的摘要正文、长期记忆的短句也在这里生成。
本模块不决定窗口边界，也不直接读写 Mem0。
用户的一轮聊天转发不放在这里。
"""

from chatbot.chat.llm_pipeline.title import generate_title

__all__ = ["generate_title"]
