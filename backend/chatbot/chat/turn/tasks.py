"""正在进行的一轮。停止只对当前用户自己的 task_id 生效。"""

import asyncio
from uuid import UUID


class TurnHandle:
    def __init__(self, user_id: UUID) -> None:
        self.user_id = user_id
        self.cancel = asyncio.Event()


_handles: dict[int, TurnHandle] = {}
_guard = asyncio.Lock()


async def open_turn(task_id: int, user_id: UUID) -> TurnHandle:
    handle = TurnHandle(user_id)
    async with _guard:
        _handles[task_id] = handle
    return handle


async def stop_turn(task_id: int, user_id: UUID) -> bool:
    async with _guard:
        handle = _handles.get(task_id)
        if handle is None or handle.user_id != user_id:
            return False
        handle.cancel.set()
        return True


async def close_turn(task_id: int) -> None:
    async with _guard:
        _handles.pop(task_id, None)
