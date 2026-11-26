"""业务状态码。BizException.code 使用这里的值，并作为 HTTP 状态码。"""

from enum import IntEnum


class BizCode(IntEnum):
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    CONFLICT = 409
    INTERNAL_ERROR = 500
    BAD_GATEWAY = 502
