// Palamede hub — gestione processi figli con log su file.
// chat (llama-server) e trellis (uvicorn) condividevano lo stesso rituale
// spawn + header di log + handler d'errore: ora sta qui, in un punto solo.

import { spawn } from 'node:child_process'
import { mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

// Avvia un processo nascosto con stdout/stderr accodati su logFile.
// L'fd del log resta aperto per la vita del processo (i figli lo ereditano
// come stdio): gli avvii sono rari, niente leak rilevante.
export function spawnLogged({ exe, args, cwd, env, logFile, header }) {
  mkdirSync(dirname(logFile), { recursive: true })
  const logFd = openSync(logFile, 'a')
  try { writeSync(logFd, header) } catch { /* log best-effort */ }
  const proc = spawn(exe, args, {
    cwd, windowsHide: true, stdio: ['ignore', logFd, logFd],
    ...(env ? { env } : {}),
  })
  proc.on('error', (e) => { try { writeSync(logFd, 'errore spawn: ' + e.message + '\n') } catch { /* log chiuso */ } })
  return { proc, logFd }
}

// Terminazione best-effort (il processo potrebbe essere già morto).
export function killChild(proc) {
  if (!proc) return
  try { proc.kill('SIGKILL') } catch { /* già morto */ }
}
