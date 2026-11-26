"""长期记忆的分区字段。写入和查询都使用这里的名字和取值。"""

from enum import StrEnum

FACT_REPEAT = 3


class MemoryKind(StrEnum):
    PERSONA = "persona"
    FACT = "fact"
    EPISODE = "episode"


class MemoryScene(StrEnum):
    WORK = "work"
    PRIVATE = "private"


class MemoryStatus(StrEnum):
    CURRENT = "current"
    PAST = "past"


class MemoryField:
    KIND = "kind"
    SCENE = "scene"
    STATUS = "status"
    IDENTITY = "identity"
    TOPIC = "topic"
    VALID_FROM = "valid_from"
    VALID_TO = "valid_to"
    REPEAT_COUNT = "repeat_count"
