"""聊天域。表结构统一在 models.py。

llm_pipeline 加载提示词，包括一轮对话的默认系统提示词，再生成标题、摘要、候选短句和分类结论。
Gemini 客户端在 framework，按中转站配置组装。
persona 保存可复用的人设卡片，用户通过关联选用或自建。
conversation 负责会话，并记下选定的人设。新建会话时补写其他已完成会话。
message 保存原文。context 组装滑动窗口和这一轮送给模型的顺序，并在静默满 30 分钟时写入长期记忆。
memory 用 Mem0 保存自我、近事和联想。人设正文不写入 Mem0。
turn 完成一轮 SSE 对话，调用上述模块，并在调模型前经过 system 的全站限流。
登录和 Cookie 仍在 system，后续再迁入这个域。
"""
