"""SQLite-backed long-term memory store.

Logical capacity is very large (disk-backed); the active context stays small
because only retrieved items ever reach the decision model.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .items import MemoryItem

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    timestamp REAL NOT NULL,
    importance REAL NOT NULL,
    salience REAL NOT NULL,
    access_count INTEGER NOT NULL,
    decay REAL NOT NULL,
    embedding TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_ids TEXT NOT NULL,
    last_access REAL NOT NULL
);
"""


class SqliteStore:
    def __init__(self, path: str | Path = ":memory:"):
        self._conn = sqlite3.connect(str(path))
        self._conn.executescript(_SCHEMA)

    def add(self, item: MemoryItem) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO memories VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                item.id,
                item.content,
                item.timestamp,
                item.importance,
                item.salience,
                item.access_count,
                item.decay,
                json.dumps(list(item.embedding)),
                item.kind,
                json.dumps(list(item.source_ids)),
                item.last_access,
            ),
        )
        self._conn.commit()

    def all(self) -> list[MemoryItem]:
        rows = self._conn.execute("SELECT * FROM memories").fetchall()
        return [self._row(r) for r in rows]

    def update(self, item: MemoryItem) -> None:
        self.add(item)

    def delete(self, item_id: str) -> None:
        self._conn.execute("DELETE FROM memories WHERE id = ?", (item_id,))
        self._conn.commit()

    def count(self) -> int:
        return int(self._conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0])

    def close(self) -> None:
        self._conn.close()

    @staticmethod
    def _row(r: tuple) -> MemoryItem:
        return MemoryItem(
            id=r[0],
            content=r[1],
            timestamp=r[2],
            importance=r[3],
            salience=r[4],
            access_count=r[5],
            decay=r[6],
            embedding=tuple(json.loads(r[7])),
            kind=r[8],
            source_ids=tuple(json.loads(r[9])),
            last_access=r[10],
        )
