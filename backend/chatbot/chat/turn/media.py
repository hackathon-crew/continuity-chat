"""按公开地址读取图片字节。文件正文已经在 part 里，不在这里下载。"""

import httpx

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException

_MAX_BYTES = 10 * 1024 * 1024


async def fetch_image(url: str) -> tuple[bytes, str]:
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(url)
    except httpx.HTTPError as error:
        raise BizException("图片读取失败", code=BizCode.BAD_GATEWAY) from error
    if response.status_code != 200:
        raise BizException("图片读取失败", code=BizCode.BAD_GATEWAY)
    mime = response.headers.get("content-type", "image/png").split(";")[0].strip() or "image/png"
    data = response.content
    if not data or len(data) > _MAX_BYTES:
        raise BizException("图片读取失败", code=BizCode.BAD_GATEWAY)
    return data, mime
