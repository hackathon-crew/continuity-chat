"""向中转站发起授权跳转和换票。本模块不保存用户。"""

import json
from collections.abc import Awaitable, Callable
from urllib.parse import urlencode

import httpx

from chatbot.framework.config.oauth import OAuthConfig
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.auth.schemas import UpstreamProfile, parse_profile

_TIMEOUT = 10.0


def authorize_url(config: OAuthConfig, state: str) -> str:
    query = urlencode(
        {
            "response_type": "code",
            "client_id": config.client_id,
            "redirect_uri": config.redirect_uri,
            "state": state,
        }
    )
    return f"{config.base_url}/oauth/authorize?{query}"


async def exchange_code(
    config: OAuthConfig,
    code: str,
    *,
    post: Callable[[str, dict], Awaitable[tuple[int, str]]] | None = None,
) -> UpstreamProfile:
    sender = post or _post
    try:
        status, body = await sender(
            f"{config.base_url}/oauth/token",
            {
                "grant_type": "authorization_code",
                "code": code,
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "redirect_uri": config.redirect_uri,
            },
        )
    except httpx.HTTPError as error:
        raise BizException("中转站不可用", code=BizCode.BAD_GATEWAY) from error
    if status != 200:
        raise BizException("登录失败", code=BizCode.UNAUTHORIZED)
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise BizException("登录失败", code=BizCode.UNAUTHORIZED) from error
    return parse_profile(payload)


async def _post(url: str, payload: dict) -> tuple[int, str]:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(url, json=payload)
    return response.status_code, response.text
