"""全站对话并发限制。

同时进行的对话不超过上限。多出来的按到达顺序等待。
还在排队时可以取消。已经拿到名额的请求，由调用方在结束时释放；租约到点也会还回去。
"""

import asyncio
import os
from collections import deque
from dataclasses import dataclass

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException

_DEFAULT_MAX_CONCURRENT = 50
_DEFAULT_MAX_WAIT_SECONDS = 20
_DEFAULT_LEASE_SECONDS = 600


class Permit:
    """一个并发名额。release 可以重复调用。"""

    def __init__(self, limiter: "ChatRateLimiter", counted: bool) -> None:
        self._limiter = limiter
        self._counted = counted
        self._released = False
        self._lease: asyncio.Task[None] | None = None

    def start_lease(self, seconds: float) -> None:
        if not self._counted:
            return
        self._lease = asyncio.create_task(self._expire(seconds))

    async def _expire(self, seconds: float) -> None:
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            return
        await self.release()

    async def release(self) -> None:
        if self._released:
            return
        self._released = True
        lease = self._lease
        self._lease = None
        if lease is not None and lease is not asyncio.current_task():
            lease.cancel()
        if self._counted:
            await self._limiter._release()


class ChatRateLimiter:
    def __init__(
        self,
        *,
        enabled: bool = True,
        max_concurrent: int = _DEFAULT_MAX_CONCURRENT,
        max_wait_seconds: float = _DEFAULT_MAX_WAIT_SECONDS,
        lease_seconds: float = _DEFAULT_LEASE_SECONDS,
    ) -> None:
        if max_concurrent < 1 or max_wait_seconds < 0 or lease_seconds <= 0:
            raise BizException("限流配置无效", code=BizCode.INTERNAL_ERROR)
        self.enabled = enabled
        self.max_concurrent = max_concurrent
        self.max_wait_seconds = max_wait_seconds
        self.lease_seconds = lease_seconds
        self._held = 0
        self._queue: deque[_Ticket] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self, cancel: asyncio.Event | None = None) -> Permit | None:
        """等到名额返回 Permit。等待超时或排队期间取消时返回 None。"""
        if not self.enabled:
            return Permit(self, counted=False)
        ticket = _Ticket()
        async with self._lock:
            if self._grant(ticket):
                return self._permit()
            self._queue.append(ticket)
        try:
            await self._wait(ticket, cancel)
        except asyncio.CancelledError:
            await self._settle_cancel(ticket)
            raise
        async with self._lock:
            if ticket.state == "granted":
                return self._permit()
            if ticket.state == "pending":
                ticket.state = "cancelled"
                self._drop(ticket)
            return None

    async def _settle_cancel(self, ticket: "_Ticket") -> None:
        granted = False
        async with self._lock:
            granted = ticket.state == "granted"
            if ticket.state == "pending":
                ticket.state = "cancelled"
                self._drop(ticket)
        if granted:
            await self._permit().release()

    async def _wait(self, ticket: "_Ticket", cancel: asyncio.Event | None) -> None:
        ready = asyncio.create_task(ticket.ready.wait())
        tasks = [ready]
        if cancel is not None:
            tasks.append(asyncio.create_task(cancel.wait()))
        try:
            done, _pending = await asyncio.wait(
                tasks,
                timeout=self.max_wait_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        if not done and ticket.state == "pending":
            return

    def _grant(self, ticket: "_Ticket") -> bool:
        if ticket.state != "pending" or self._held >= self.max_concurrent:
            return False
        ticket.state = "granted"
        self._held += 1
        ticket.ready.set()
        return True

    def _permit(self) -> Permit:
        permit = Permit(self, counted=True)
        permit.start_lease(self.lease_seconds)
        return permit

    def _drop(self, ticket: "_Ticket") -> None:
        try:
            self._queue.remove(ticket)
        except ValueError:
            return

    async def _release(self) -> None:
        async with self._lock:
            if self._held > 0:
                self._held -= 1
            while self._queue:
                ticket = self._queue.popleft()
                if self._grant(ticket):
                    return


class _Ticket:
    def __init__(self) -> None:
        self.state = "pending"
        self.ready = asyncio.Event()


@dataclass(frozen=True)
class RateLimitSettings:
    enabled: bool
    max_concurrent: int
    max_wait_seconds: int
    lease_seconds: int


def read_rate_limit_settings() -> RateLimitSettings:
    return RateLimitSettings(
        enabled=_enabled(),
        max_concurrent=_int("CHAT_RATE_LIMIT_MAX_CONCURRENT", _DEFAULT_MAX_CONCURRENT, 1),
        max_wait_seconds=_int("CHAT_RATE_LIMIT_MAX_WAIT_SECONDS", _DEFAULT_MAX_WAIT_SECONDS, 0),
        lease_seconds=_int("CHAT_RATE_LIMIT_LEASE_SECONDS", _DEFAULT_LEASE_SECONDS, 1),
    )


_limiter: ChatRateLimiter | None = None


def get_chat_limiter() -> ChatRateLimiter:
    global _limiter
    if _limiter is None:
        settings = read_rate_limit_settings()
        _limiter = ChatRateLimiter(
            enabled=settings.enabled,
            max_concurrent=settings.max_concurrent,
            max_wait_seconds=settings.max_wait_seconds,
            lease_seconds=settings.lease_seconds,
        )
    return _limiter


def _enabled() -> bool:
    raw = os.environ.get("CHAT_RATE_LIMIT_ENABLED", "true").strip().lower()
    if raw in {"", "1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise BizException("限流开关无效", code=BizCode.INTERNAL_ERROR)


def _int(name: str, default: int, minimum: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise BizException(f"{name} 无效", code=BizCode.INTERNAL_ERROR) from error
    if value < minimum:
        raise BizException(f"{name} 无效", code=BizCode.INTERNAL_ERROR)
    return value
