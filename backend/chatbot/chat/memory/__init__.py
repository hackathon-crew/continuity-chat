"""长期记忆。自我、近事和联想放在 Mem0，用 metadata 分区。

外部调用 service.load_memory 一次取回这三槽。本场摘要和滑动窗口由 context 管理。
抽取短句在 llm_pipeline。persona_id 传给 Mem0 时作为 agent_id。
"""
