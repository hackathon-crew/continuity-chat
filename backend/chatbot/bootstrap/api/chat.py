"""一轮对话的 SSE 接口。用户从登录会话取出。"""

from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

from chatbot.bootstrap.deps import session_scope
from chatbot.chat.persona.service import linked_persona
from chatbot.chat.turn.schemas import ChatTurnIn, StopIn
from chatbot.chat.turn.service import chat_events
from chatbot.chat.turn.tasks import stop_turn
from chatbot.framework.const import Cookie
from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException
from chatbot.system.access.service import require_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("")
async def speak(payload: ChatTurnIn, request: Request) -> StreamingResponse:
    async with session_scope(request) as session:
        user = await require_user(session, request.cookies.get(Cookie.SESSION))
        await linked_persona(session, payload.persona_id, user.id)
        user_id = user.id
    return StreamingResponse(
        chat_events(request, user_id, payload),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/stop", status_code=204)
async def stop(payload: StopIn, request: Request) -> Response:
    async with session_scope(request) as session:
        user = await require_user(session, request.cookies.get(Cookie.SESSION))
        user_id = user.id
    if not await stop_turn(payload.task_id, user_id):
        raise BizException("任务不存在", code=BizCode.NOT_FOUND)
    return Response(status_code=204)
