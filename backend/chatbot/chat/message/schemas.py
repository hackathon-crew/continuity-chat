"""消息和记忆的入参、返回值。

parts 按 Gemini content.parts 的顺序保存。思考是带 thought 的文本 part，
thought_signature 随 part 保存。搜索来源、网页抓取和训练数据引用单独保存，
用 part_index 指回对应 part。用户上传的图片和文件只存七牛地址。
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException

Role = Literal["user", "assistant"]
MessageStatus = Literal["streaming", "normal", "stopped", "failed", "rejected"]
MessageOrder = Literal["asc", "desc"]
_LIMIT_MAX = 500
_PART_MAX = 50
_NAME_MAX = 255
_URL_MAX = 2048
_SIGNATURE_MAX = 200_000


class FunctionCall(BaseModel):
    model_config = ConfigDict(strict=True)

    name: str
    id: str | None = None
    args: dict[str, Any] = {}


class FunctionResponse(BaseModel):
    model_config = ConfigDict(strict=True)

    name: str
    id: str | None = None
    response: dict[str, Any]


class ImagePart(BaseModel):
    model_config = ConfigDict(strict=True)

    url: str
    mime_type: str | None = None
    name: str | None = None


class FilePart(BaseModel):
    model_config = ConfigDict(strict=True)

    url: str
    mime_type: str | None = None
    name: str | None = None
    text: str | None = None


class MessagePart(BaseModel):
    model_config = ConfigDict(strict=True)

    text: str | None = None
    thought: bool | None = None
    thought_signature: str | None = None
    function_call: FunctionCall | None = None
    function_response: FunctionResponse | None = None
    image: ImagePart | None = None
    file: FilePart | None = None


class GroundingWeb(BaseModel):
    model_config = ConfigDict(strict=True)

    uri: str
    title: str | None = None


class GroundingImage(BaseModel):
    model_config = ConfigDict(strict=True)

    source_uri: str | None = None
    image_uri: str | None = None
    title: str | None = None
    domain: str | None = None


class GroundingChunk(BaseModel):
    model_config = ConfigDict(strict=True)

    web: GroundingWeb | None = None
    image: GroundingImage | None = None


class GroundingSegment(BaseModel):
    model_config = ConfigDict(strict=True)

    part_index: int
    start_index: int | None = None
    end_index: int | None = None
    text: str | None = None


class GroundingSupport(BaseModel):
    model_config = ConfigDict(strict=True)

    segment: GroundingSegment
    grounding_chunk_indices: list[int]


class GroundingMetadata(BaseModel):
    model_config = ConfigDict(strict=True)

    web_search_queries: list[str] = []
    grounding_chunks: list[GroundingChunk] = []
    grounding_supports: list[GroundingSupport] = []


class UrlMetadata(BaseModel):
    model_config = ConfigDict(strict=True)

    retrieved_url: str
    url_retrieval_status: str


class UrlContextMetadata(BaseModel):
    model_config = ConfigDict(strict=True)

    url_metadata: list[UrlMetadata]


class CitationSource(BaseModel):
    model_config = ConfigDict(strict=True)

    start_index: int | None = None
    end_index: int | None = None
    uri: str | None = None
    license: str | None = None


class CitationMetadata(BaseModel):
    model_config = ConfigDict(strict=True)

    citation_sources: list[CitationSource]


class MessageCreate(BaseModel):
    model_config = ConfigDict(strict=True)

    user_id: UUID | None = None
    role: Role
    parts: list[MessagePart]
    grounding_metadata: GroundingMetadata | None = None
    url_context_metadata: UrlContextMetadata | None = None
    citation_metadata: CitationMetadata | None = None
    finish_reason: str | None = None
    status: MessageStatus = "normal"
    input_tokens: int | None = None
    output_tokens: int | None = None

    @field_validator("parts", mode="before")
    @classmethod
    def check_parts(cls, value: object) -> list[MessagePart]:
        return parse_parts(value)

    @field_validator("grounding_metadata", mode="before")
    @classmethod
    def check_grounding(cls, value: object) -> GroundingMetadata | None:
        return _grounding(value)

    @field_validator("url_context_metadata", mode="before")
    @classmethod
    def check_url_context(cls, value: object) -> UrlContextMetadata | None:
        return _url_context(value)

    @field_validator("citation_metadata", mode="before")
    @classmethod
    def check_citation(cls, value: object) -> CitationMetadata | None:
        return _citations(value)

    @field_validator("finish_reason", mode="before")
    @classmethod
    def check_finish_reason(cls, value: object) -> str | None:
        return _finish_reason(value)

    @field_validator("input_tokens", "output_tokens")
    @classmethod
    def check_non_negative(cls, value: int | None) -> int | None:
        return _non_negative(value)

    @model_validator(mode="after")
    def check_support_indexes(self) -> "MessageCreate":
        _support_indexes(self.parts, self.grounding_metadata)
        return self


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    role: str
    parts: list[MessagePart]
    grounding_metadata: GroundingMetadata | None
    url_context_metadata: UrlContextMetadata | None
    citation_metadata: CitationMetadata | None
    finish_reason: str | None
    status: str
    input_tokens: int | None
    output_tokens: int | None
    created_at: datetime

    @field_validator("parts", mode="before")
    @classmethod
    def check_parts(cls, value: object) -> list[MessagePart]:
        return parse_parts(value)

    @field_validator("grounding_metadata", mode="before")
    @classmethod
    def check_grounding(cls, value: object) -> GroundingMetadata | None:
        return _grounding(value)

    @field_validator("url_context_metadata", mode="before")
    @classmethod
    def check_url_context(cls, value: object) -> UrlContextMetadata | None:
        return _url_context(value)

    @field_validator("citation_metadata", mode="before")
    @classmethod
    def check_citation(cls, value: object) -> CitationMetadata | None:
        return _citations(value)


def parse_parts(value: object) -> list[MessagePart]:
    if not isinstance(value, list) or not value:
        raise ValueError("消息内容不能为空")
    if len(value) > _PART_MAX:
        raise ValueError("消息内容过多")
    return [_part(item) for item in value]


def parse_limit(limit: int | None) -> int | None:
    if limit is None:
        return None
    if isinstance(limit, bool) or type(limit) is not int or not 1 <= limit <= _LIMIT_MAX:
        raise BizException("消息条数无效", code=BizCode.BAD_REQUEST)
    return limit


def parse_order(order: str | None) -> MessageOrder:
    if order is None or order == "asc":
        return "asc"
    if order == "desc":
        return "desc"
    raise BizException("排序方式无效", code=BizCode.BAD_REQUEST)


def _part(value: object) -> MessagePart:
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, dict):
        raise ValueError("消息内容无效")
    text = value.get("text")
    function_call = value.get("function_call")
    function_response = value.get("function_response")
    image = value.get("image")
    file = value.get("file")
    present = [item is not None for item in (text, function_call, function_response, image, file)]
    if sum(present) != 1:
        raise ValueError("消息内容无效")
    thought = value.get("thought")
    if thought is None:
        thought_value = None
    elif thought is True:
        thought_value = True
    elif thought is False:
        thought_value = None
    else:
        raise ValueError("消息内容无效")
    if thought_value and text is None:
        raise ValueError("消息内容无效")
    return MessagePart(
        text=_required_text(text, "文字不能为空") if text is not None else None,
        thought=thought_value,
        thought_signature=_signature(value.get("thought_signature")),
        function_call=_function_call(function_call) if function_call is not None else None,
        function_response=_function_response(function_response) if function_response is not None else None,
        image=_image(image) if image is not None else None,
        file=_file(file) if file is not None else None,
    )


def _function_call(value: object) -> FunctionCall:
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, dict):
        raise ValueError("消息内容无效")
    args = value.get("args", {})
    if not isinstance(args, dict):
        raise ValueError("消息内容无效")
    return FunctionCall(name=_required_text(value.get("name"), "消息内容无效"), id=_optional_id(value.get("id")), args=args)


def _function_response(value: object) -> FunctionResponse:
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, dict) or not isinstance(value.get("response"), dict):
        raise ValueError("消息内容无效")
    return FunctionResponse(
        name=_required_text(value.get("name"), "消息内容无效"),
        id=_optional_id(value.get("id")),
        response=value["response"],
    )


def _image(value: object) -> ImagePart:
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, dict):
        raise ValueError("消息内容无效")
    return ImagePart(url=_url(value.get("url")), mime_type=_mime(value.get("mime_type")), name=_name(value.get("name")))


def _file(value: object) -> FilePart:
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, dict):
        raise ValueError("消息内容无效")
    return FilePart(
        url=_url(value.get("url")),
        mime_type=_mime(value.get("mime_type")),
        name=_name(value.get("name")),
        text=_optional_text(value.get("text")),
    )


def _grounding(value: object) -> GroundingMetadata | None:
    if value is None:
        return None
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, dict):
        raise ValueError("搜索结果无效")
    chunks = [_chunk(item) for item in value.get("grounding_chunks") or []]
    supports = [_support(item) for item in value.get("grounding_supports") or []]
    queries = [_required_text(item, "搜索结果无效") for item in value.get("web_search_queries") or []]
    return GroundingMetadata(web_search_queries=queries, grounding_chunks=chunks, grounding_supports=supports)


def _chunk(value: object) -> GroundingChunk:
    if not isinstance(value, dict):
        raise ValueError("搜索结果无效")
    web = value.get("web")
    image = value.get("image")
    if (web is None) == (image is None):
        raise ValueError("搜索结果无效")
    return GroundingChunk(web=_web(web) if web is not None else None, image=_search_image(image) if image is not None else None)


def _web(value: object) -> GroundingWeb:
    if not isinstance(value, dict):
        raise ValueError("搜索结果无效")
    return GroundingWeb(uri=_url(value.get("uri")), title=_optional_text(value.get("title")))


def _search_image(value: object) -> GroundingImage:
    if not isinstance(value, dict):
        raise ValueError("搜索结果无效")
    return GroundingImage(
        source_uri=_optional_url(value.get("source_uri")),
        image_uri=_optional_url(value.get("image_uri")),
        title=_optional_text(value.get("title")),
        domain=_optional_text(value.get("domain")),
    )


def _support(value: object) -> GroundingSupport:
    if not isinstance(value, dict) or not isinstance(value.get("segment"), dict):
        raise ValueError("搜索结果无效")
    segment = value["segment"]
    indexes = value.get("grounding_chunk_indices") or []
    if not isinstance(indexes, list) or any(_invalid_index(item) for item in indexes):
        raise ValueError("搜索结果无效")
    return GroundingSupport(
        segment=GroundingSegment(
            part_index=_index(segment.get("part_index")),
            start_index=_optional_index(segment.get("start_index")),
            end_index=_optional_index(segment.get("end_index")),
            text=_optional_text(segment.get("text")),
        ),
        grounding_chunk_indices=indexes,
    )


def _url_context(value: object) -> UrlContextMetadata | None:
    if value is None:
        return None
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, dict) or not isinstance(value.get("url_metadata"), list):
        raise ValueError("网页抓取结果无效")
    return UrlContextMetadata(url_metadata=[_url_metadata(item) for item in value["url_metadata"]])


def _url_metadata(value: object) -> UrlMetadata:
    if not isinstance(value, dict):
        raise ValueError("网页抓取结果无效")
    return UrlMetadata(
        retrieved_url=_url(value.get("retrieved_url")),
        url_retrieval_status=_required_text(value.get("url_retrieval_status"), "网页抓取结果无效"),
    )


def _citations(value: object) -> CitationMetadata | None:
    if value is None:
        return None
    if isinstance(value, BaseModel):
        value = value.model_dump()
    if not isinstance(value, dict) or not isinstance(value.get("citation_sources"), list):
        raise ValueError("引用无效")
    return CitationMetadata(citation_sources=[_citation(item) for item in value["citation_sources"]])


def _citation(value: object) -> CitationSource:
    if not isinstance(value, dict):
        raise ValueError("引用无效")
    return CitationSource(
        start_index=_optional_index(value.get("start_index")),
        end_index=_optional_index(value.get("end_index")),
        uri=_optional_url(value.get("uri")),
        license=_optional_text(value.get("license")),
    )


def _support_indexes(parts: list[MessagePart], grounding: GroundingMetadata | None) -> None:
    if grounding is None:
        return
    for support in grounding.grounding_supports:
        if support.segment.part_index >= len(parts):
            raise ValueError("引用位置无效")
        for index in support.grounding_chunk_indices:
            if index >= len(grounding.grounding_chunks):
                raise ValueError("引用来源无效")


def _finish_reason(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("结束原因无效")
    text = value.strip()
    if not text:
        return None
    if len(text) > 64:
        raise ValueError("结束原因无效")
    return text


def _signature(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("消息内容无效")
    text = value.strip()
    if not text or len(text) > _SIGNATURE_MAX:
        raise ValueError("消息内容无效")
    return text


def _optional_id(value: object) -> str | None:
    if value is None:
        return None
    return _required_text(value, "消息内容无效")


def _url(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("文件地址无效")
    url = value.strip()
    if not url.startswith(("https://", "http://")) or len(url) > _URL_MAX:
        raise ValueError("文件地址无效")
    return url


def _optional_url(value: object) -> str | None:
    if value is None:
        return None
    return _url(value)


def _name(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("文件名无效")
    name = value.strip()
    if not name:
        return None
    if len(name) > _NAME_MAX:
        raise ValueError("文件名无效")
    return name


def _mime(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("消息内容无效")
    mime = value.strip().lower()
    if not mime or len(mime) > 128:
        raise ValueError("消息内容无效")
    return mime


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    return text or None


def _index(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("搜索结果无效")
    return value


def _optional_index(value: object) -> int | None:
    if value is None:
        return None
    return _index(value)


def _invalid_index(value: object) -> bool:
    return isinstance(value, bool) or not isinstance(value, int) or value < 0


def _non_negative(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("数量不能为负数")
    return value


def _required_text(value: object, empty_message: str) -> str:
    if not isinstance(value, str):
        raise ValueError("必须是文本")
    text = value.strip()
    if not text:
        raise ValueError(empty_message)
    return text
