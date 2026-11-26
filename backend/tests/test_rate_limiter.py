import asyncio

import pytest

from chatbot.framework.exceptions.biz import BizException
from chatbot.system.ratelimit.limiter import ChatRateLimiter, read_rate_limit_settings


def test_waiters_acquire_in_arrival_order() -> None:
    async def run() -> list[str]:
        limiter = ChatRateLimiter(max_concurrent=1, max_wait_seconds=1, lease_seconds=30)
        first = await limiter.acquire()
        assert first is not None
        order: list[str] = []

        async def wait(name: str) -> None:
            permit = await limiter.acquire()
            assert permit is not None
            order.append(name)
            await permit.release()

        earlier = asyncio.create_task(wait("earlier"))
        await asyncio.sleep(0.02)
        later = asyncio.create_task(wait("later"))
        await asyncio.sleep(0.02)
        await first.release()
        await earlier
        await later
        return order

    assert asyncio.run(run()) == ["earlier", "later"]


def test_wait_timeout_rejects_without_taking_slot() -> None:
    async def run() -> None:
        limiter = ChatRateLimiter(max_concurrent=1, max_wait_seconds=0.05, lease_seconds=30)
        first = await limiter.acquire()
        assert first is not None
        assert await limiter.acquire() is None
        await first.release()
        again = await limiter.acquire()
        assert again is not None
        await again.release()

    asyncio.run(run())


def test_cancel_while_waiting_leaves_slot_held() -> None:
    async def run() -> None:
        limiter = ChatRateLimiter(max_concurrent=1, max_wait_seconds=1, lease_seconds=30)
        first = await limiter.acquire()
        assert first is not None
        cancel = asyncio.Event()

        async def stop() -> None:
            await asyncio.sleep(0.02)
            cancel.set()

        asyncio.create_task(stop())
        assert await limiter.acquire(cancel) is None
        await first.release()
        nxt = await limiter.acquire()
        assert nxt is not None
        await nxt.release()

    asyncio.run(run())


def test_lease_returns_slot() -> None:
    async def run() -> None:
        limiter = ChatRateLimiter(max_concurrent=1, max_wait_seconds=0.2, lease_seconds=0.05)
        permit = await limiter.acquire()
        assert permit is not None
        await asyncio.sleep(0.12)
        nxt = await limiter.acquire()
        assert nxt is not None
        await nxt.release()
        await permit.release()

    asyncio.run(run())


def test_disabled_limiter_does_not_queue() -> None:
    async def run() -> None:
        limiter = ChatRateLimiter(enabled=False, max_concurrent=1, max_wait_seconds=0.05, lease_seconds=30)
        first = await limiter.acquire()
        second = await limiter.acquire()
        assert first is not None and second is not None
        await first.release()
        await second.release()

    asyncio.run(run())


def test_rate_limit_settings_defaults(monkeypatch) -> None:
    monkeypatch.delenv("CHAT_RATE_LIMIT_ENABLED", raising=False)
    monkeypatch.delenv("CHAT_RATE_LIMIT_MAX_CONCURRENT", raising=False)
    monkeypatch.delenv("CHAT_RATE_LIMIT_MAX_WAIT_SECONDS", raising=False)
    monkeypatch.delenv("CHAT_RATE_LIMIT_LEASE_SECONDS", raising=False)
    settings = read_rate_limit_settings()
    assert settings.enabled is True
    assert settings.max_concurrent == 50
    assert settings.max_wait_seconds == 20
    assert settings.lease_seconds == 600


def test_rate_limit_settings_reject_bad_switch(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_RATE_LIMIT_ENABLED", "maybe")
    with pytest.raises(BizException, match="限流开关无效"):
        read_rate_limit_settings()
