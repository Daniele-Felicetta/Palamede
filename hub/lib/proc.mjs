// Palamede hub — gestione processi figli con log su file.
// chat (llama-server) e trellis (uvicorn) condividevano lo stesso rituale
// spawn + header di log + handler d'errore: ora sta qui, in un punto solo.

import { spawn } from 'node:child_process'
import { mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

// Registro di tutti i figli spawnati: serve solo per la pulizia all'uscita
// dell'hub (killAllChildren). I figli si tolgono da soli quando escono.
const alive = new Set()

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
  alive.add(proc)
  proc.on('exit', () => alive.delete(proc))
  proc.on('error', (e) => { try { writeSync(logFd, 'errore spawn: ' + e.message + '\n') } catch { /* log chiuso */ } })
  return { proc, logFd }
}

// Terminazione best-effort (il processo potrebbe essere gia' morto).
export function killChild(proc) {
  if (!proc) return
  try { proc.kill('SIGKILL') } catch { /* gia' morto */ }
}

/** Termina tutti i figli ancora vivi. Da chiamare all'uscita dell'hub: senza
 *  questo, chiudendo o crashando l'hub llama-server, TRELLIS, il reranker e
 *  jev-hub restano orfani a tenere occupate porte e VRAM. */
export function killAllChildren() {
  for (const p of [...alive]) killChild(p)
  alive.clear()
}
