"""系统常量。提示词常量的值是模板名，由提示词工厂读取对应文件。"""


class Prompt:
    CHAT_SYSTEM = "chat_system"
    CONVERSATION_TITLE = "conversation_title"
    CONSOLIDATION_SUMMARY_PRIVATE = "consolidation_summary_private"
    CONSOLIDATION_SUMMARY_WORK = "consolidation_summary_work"
    CONSOLIDATION_EXTRACT = "consolidation_extract"
    CONSOLIDATION_CLASSIFY = "consolidation_classify"


class Cookie:
    OAUTH_STATE = "chatbot_oauth_state"
    SESSION = "chatbot_session"


OAUTH_STATE_SECONDS = 10 * 60
SESSION_SECONDS = 14 * 24 * 60 * 60
