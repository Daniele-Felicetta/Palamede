"""Launcher: run the game with rizzo-flow's Python (it holds the Spark stack).

    ..\\rizzo-flow\\.venv\\Scripts\\python.exe run.py
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "src"))

from agent_encounter.server import main

if __name__ == "__main__":
    raise SystemExit(main())
