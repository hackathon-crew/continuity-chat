"""对象存储凭证。浏览器拿凭证后直接把文件传到七牛。"""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict

from chatbot.bootstrap.deps import current_user
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.models import User
from chatbot.framework.storage.qiniu import (
    UploadCredential,
    callback_file_url,
    issue_upload_credential,
    verify_upload_callback,
)

router = APIRouter(prefix="/api/storage", tags=["storage"])


class UploadCredentialIn(BaseModel):
    model_config = ConfigDict(strict=True)

    content_type: str
    purpose: str = "chat"


class UploadCredentialOut(BaseModel):
    token: str
    key: str
    upload_url: str
    url: str

    @classmethod
    def from_credential(cls, credential: UploadCredential) -> "UploadCredentialOut":
        return cls(
            token=credential.token,
            key=credential.key,
            upload_url=credential.upload_url,
            url=credential.url,
        )


class UploadCallbackOut(BaseModel):
    url: str


@router.post("/upload-token", response_model=UploadCredentialOut)
def upload_token(
    payload: UploadCredentialIn,
    user: User = Depends(current_user),
) -> UploadCredentialOut:
    del user
    return UploadCredentialOut.from_credential(
        issue_upload_credential(payload.content_type, payload.purpose)
    )


@router.post("/callback", response_model=UploadCallbackOut)
async def upload_callback(request: Request) -> UploadCallbackOut:
    body = await request.body()
    authorization = request.headers.get("authorization", "")
    content_type = request.headers.get("content-type", "application/x-www-form-urlencoded")
    if not verify_upload_callback(authorization, str(request.url), body, content_type):
        raise BizException("上传签名无效", code=BizCode.UNAUTHORIZED)
    return UploadCallbackOut(url=callback_file_url(body))
