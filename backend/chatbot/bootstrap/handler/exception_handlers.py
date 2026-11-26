"""把 BizException 转成 HTTP 响应。"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from chatbot.framework.exceptions.biz import BizException


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(BizException)
    async def handle_biz(_request: Request, exc: BizException) -> JSONResponse:
        return JSONResponse(
            status_code=int(exc.code),
            content={"code": int(exc.code), "message": exc.message, "data": exc.data},
        )
