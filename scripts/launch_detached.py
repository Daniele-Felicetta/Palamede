"""Palamede — avvia un processo staccato dalla console (own code).

Uso: pythonw launch_detached.py <logbase> <exe> [args...] [--cwd DIR]
Il figlio parte con DETACHED_PROCESS|CREATE_NO_WINDOW e log su <logbase>.log/.err.
Sopravvive alla chiusura della console che lo ha generato.
"""
import os
import subprocess
import sys

DETACHED_PROCESS = 0x00000008
CREATE_NO_WINDOW = 0x08000000


def main() -> int:
    if len(sys.argv) < 3:
        print("uso: launch_detached.py <logbase> <exe> [args...] [--cwd DIR]")
        return 2
    argv = sys.argv[1:]
    cwd = None
    if "--cwd" in argv:
        i = argv.index("--cwd")
        cwd = argv[i + 1]
        del argv[i:i + 2]
    logbase, exe, args = argv[0], argv[1], argv[2:]
    if cwd:
        os.makedirs(cwd, exist_ok=True)
    out = open(logbase + ".log", "ab", buffering=0)
    err = open(logbase + ".err", "ab", buffering=0)
    subprocess.Popen(
        [exe] + args,
        stdout=out, stderr=err, stdin=subprocess.DEVNULL,
        creationflags=DETACHED_PROCESS | CREATE_NO_WINDOW,
        close_fds=False, cwd=cwd or None,
    )
    print(f"avviato: {exe} {args}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
