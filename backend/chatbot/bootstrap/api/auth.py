"""登录路由。授权码在中转站签发，本站只换票并建立会话。"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from chatbot.bootstrap.deps import session_scope
from chatbot.framework.config.oauth import get_oauth_settings
from chatbot.framework.const import OAUTH_STATE_SECONDS, SESSION_SECONDS, Cookie
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.access.service import require_user
from chatbot.system.auth.service import complete_login, logout, new_state, same_secret
from chatbot.system.auth.upstream import authorize_url, exchange_code
from chatbot.system.auth.schemas import SessionUser

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/login")
def login() -> RedirectResponse:
    config = _config()
    state = new_state()
    response = RedirectResponse(authorize_url(config, state), status_code=302)
    _state_cookie(response, state)
    return response


@router.get("/callback")
async def callback(request: Request, code: str | None = None, state: str | None = None):
    if not code or not code.strip() or not state or not state.strip():
        return _failure(BizException("缺少授权码", code=BizCode.BAD_REQUEST))
    saved = request.cookies.get(Cookie.OAUTH_STATE, "")
    if not saved or not same_secret(saved, state):
        return _failure(BizException("登录状态无效", code=BizCode.UNAUTHORIZED))
    config = _config()
    try:
        profile = await exchange_code(config, code.strip())
    except BizException as error:
        return _failure(error)
    try:
        async with session_scope(request) as session:
            token = await complete_login(session, profile, config.credential_key)
    except BizException as error:
        return _failure(error)
    response = RedirectResponse("/", status_code=302)
    response.delete_cookie(Cookie.OAUTH_STATE, path="/")
    _session_cookie(response, token)
    return response


@router.get("/me")
async def me(request: Request) -> dict:
    async with session_scope(request) as session:
        user = await require_user(session, request.cookies.get(Cookie.SESSION))
    return {"user": SessionUser.model_validate(user).model_dump(mode="json")}


@router.post("/logout", status_code=204)
async def sign_out(request: Request) -> Response:
    async with session_scope(request) as session:
        await logout(session, request.cookies.get(Cookie.SESSION))
    response = Response(status_code=204)
    response.delete_cookie(Cookie.SESSION, path="/")
    return response


def _config():
    try:
        config = get_oauth_settings()
    except ValueError as error:
        raise BizException(str(error), code=BizCode.INTERNAL_ERROR) from error
    if config is None:
        raise BizException("缺少中转站登录配置", code=BizCode.INTERNAL_ERROR)
    return config


def _failure(error: BizException) -> JSONResponse:
    response = JSONResponse(
        status_code=int(error.code),
        content={"code": int(error.code), "message": error.message, "data": None},
    )
    response.delete_cookie(Cookie.OAUTH_STATE, path="/")
    return response


def _state_cookie(response: RedirectResponse, state: str) -> None:
    response.set_cookie(
        Cookie.OAUTH_STATE,
        state,
        max_age=OAUTH_STATE_SECONDS,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _session_cookie(response: RedirectResponse, token: str) -> None:
    response.set_cookie(
        Cookie.SESSION,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        path="/",
    )
