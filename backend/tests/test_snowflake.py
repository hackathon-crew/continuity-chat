import threading

import pytest

from chatbot.framework.utils.snowflake import Snowflake, SnowflakeError


def test_ids_are_unique_and_positive() -> None:
    clock = _clock(1_767_225_600_000)
    generator = Snowflake(7, clock=clock)
    ids = [generator.next_id() for _ in range(5000)]
    assert len(ids) == len(set(ids))
    assert all(item > 0 for item in ids)
    assert ids == sorted(ids)


def test_threads_do_not_share_a_number() -> None:
    generator = Snowflake(3, clock=_clock(1_767_225_600_000))
    found: list[int] = []
    lock = threading.Lock()

    def produce() -> None:
        batch = [generator.next_id() for _ in range(200)]
        with lock:
            found.extend(batch)

    threads = [threading.Thread(target=produce) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(found) == len(set(found))


def test_worker_id_is_rejected() -> None:
    with pytest.raises(SnowflakeError):
        Snowflake(-1)
    with pytest.raises(SnowflakeError):
        Snowflake(1024)


def test_clock_rollback_is_rejected() -> None:
    ticks = iter([1_767_225_600_100, 1_767_225_600_050])

    def clock() -> int:
        return next(ticks)

    generator = Snowflake(1, clock=clock)
    generator.next_id()
    with pytest.raises(SnowflakeError):
        generator.next_id()


def _clock(start: int):
    current = {"value": start}

    def clock() -> int:
        current["value"] += 1
        return current["value"]

    return clock
