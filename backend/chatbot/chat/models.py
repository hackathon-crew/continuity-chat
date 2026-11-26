"""聊天域的表。人设、会话、消息和窗口摘要放在一起。主键由雪花算法在应用内生成。"""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from chatbot.framework.db import Base
from chatbot.framework.utils.snowflake import next_id


def _snowflake() -> Mapped[int]:
    return mapped_column(BigInteger, primary_key=True, default=next_id)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Persona(Base):
    """可复用的人设卡片。不绑定用户，也不写入 Mem0。

    名字、描述、性格和情景每轮都进入提示词。开场白只用于新对话。
    示例对话用来固定说话语气，上下文变满后可以先拿掉。
    portrait_url 是对话框里的人物立绘，不进入提示词。
    """

    __tablename__ = "personas"
    __table_args__ = (
        CheckConstraint("scope IN ('system', 'private')", name="personas_scope"),
        Index("idx_personas_scope", "scope"),
    )

    id: Mapped[int] = _snowflake()
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    personality: Mapped[str] = mapped_column(Text, nullable=False)
    scenario: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    greeting: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    example_dialogue: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    post_history: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    portrait_url: Mapped[str | None] = mapped_column(String(2048))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserPersona(Base):
    """用户选用或自建的人设。陪聊记忆仍按用户和人设分开，不放在这张表。"""

    __tablename__ = "user_personas"
    __table_args__ = (CheckConstraint("role IN ('owner', 'selected')", name="user_personas_role"),)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    persona_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("personas.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = _created_at()


class Conversation(Base):
    """一个用户在某个人设下的一个聊天会话。"""

    __tablename__ = "conversations"
    __table_args__ = (
        Index("idx_conversations_user_last_message", "user_id", "last_message_at"),
        Index("idx_conversations_persona", "persona_id"),
    )

    id: Mapped[int] = _snowflake()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    persona_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("personas.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(Base):
    """一条会话消息。parts 的数组顺序就是展示顺序。

    搜索、网页抓取和训练数据引用挂在消息上，用 part_index 指回 parts。
    """

    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="messages_role"),
        CheckConstraint(
            "status IN ('streaming', 'normal', 'stopped', 'failed', 'rejected')",
            name="messages_status",
        ),
        Index("idx_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[int] = _snowflake()
    conversation_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("conversations.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    parts: Mapped[list] = mapped_column(JSONB, nullable=False)
    grounding_metadata: Mapped[dict | None] = mapped_column(JSONB)
    url_context_metadata: Mapped[dict | None] = mapped_column(JSONB)
    citation_metadata: Mapped[dict | None] = mapped_column(JSONB)
    finish_reason: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = _created_at()


class ConversationSummary(Base):
    """一个会话一份记忆。主键沿用会话的雪花编号。"""

    __tablename__ = "conversation_summaries"

    conversation_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("conversations.id"), primary_key=True)
    until_message_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("messages.id"))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
