"""Append-only JSONL event log of Experience records."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TextIO

from .items import Experience


class EventLog:
    def __init__(self, path: str | Path | None = None):
        self._path = Path(path) if path else None
        self._fh: TextIO | None = None
        self._records: list[Experience] = []
        if self._path:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._fh = self._path.open("a", encoding="utf-8")

    def append(self, exp: Experience) -> None:
        self._records.append(exp)
        if self._fh:
            self._fh.write(json.dumps(exp.to_dict()) + "\n")

    def all(self) -> list[Experience]:
        return list(self._records)

    def close(self) -> None:
        if self._fh:
            self._fh.close()
            self._fh = None
