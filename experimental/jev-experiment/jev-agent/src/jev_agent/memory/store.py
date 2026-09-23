"""Abstract memory backend. The core is not coupled to a single database."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .items import MemoryItem


@runtime_checkable
class MemoryStore(Protocol):
    def add(self, item: MemoryItem) -> None: ...

    def all(self) -> list[MemoryItem]: ...

    def update(self, item: MemoryItem) -> None: ...

    def delete(self, item_id: str) -> None: ...

    def count(self) -> int: ...

    def close(self) -> None: ...
