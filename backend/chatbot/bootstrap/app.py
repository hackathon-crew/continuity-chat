"""FastAPI 应用工厂。"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from chatbot.bootstrap.api.personas import router as personas_router
from chatbot.bootstrap.api.audit import router as audit_router
from chatbot.bootstrap.api.auth import router as auth_router
from chatbot.bootstrap.api.conversations import router as conversations_router
from chatbot.bootstrap.api.chat import router as chat_router
from chatbot.bootstrap.api.storage import router as storage_router
from chatbot.bootstrap.api.users import router as users_router
from chatbot.bootstrap.handler import register_exception_handlers
from chatbot.chat.context.flush import SWEEP_EVERY, sweep_idle
from chatbot.framework.config.database import get_database_settings
from chatbot.framework.db import create_engine, create_session_factory

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_database_settings()
    engine = None
    sweep = None
    if settings is not None:
        engine = create_engine(settings)
        app.state.session_factory = create_session_factory(engine)
        sweep = asyncio.create_task(_sweep_idle(app))
    try:
        yield
    finally:
        if sweep is not None:
            sweep.cancel()
            try:
                await sweep
            except asyncio.CancelledError:
                pass
        if engine is not None:
            await engine.dispose()


async def _sweep_idle(app: FastAPI) -> None:
    while True:
        await asyncio.sleep(SWEEP_EVERY.total_seconds())
        factory = getattr(app.state, "session_factory", None)
        if factory is None:
            continue
        try:
            await sweep_idle(factory)
        except Exception:
            logger.exception("静默记忆写入失败")


def create_app() -> FastAPI:
    app = FastAPI(title="聊天站", version="0.1.0", lifespan=lifespan)
    register_exception_handlers(app)
    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(personas_router)
    app.include_router(conversations_router)
    app.include_router(chat_router)
    app.include_router(storage_router)
    app.include_router(audit_router)

    @app.get("/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run("chatbot.bootstrap.app:app", host="127.0.0.1", port=8000, reload=False)
