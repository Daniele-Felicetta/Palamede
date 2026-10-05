// Palamede hub — stato Jarvis (pesi + porte). Zero dipendenze.
// F0/F1: solo lettura (file in models/Jarvis + porte 8100-8104/7880).
// F3: aggiungerà spawn/stop dei subprocess (come trellis.mjs) via queued().

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './root.mjs'
import { JARVIS_FILES, JARVIS_PORTS } from './jarvis-config.mjs'

async function portOpen(port, timeoutMs = 300) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch {
    return false
  }
}

export async function jarvisStatus() {
  const files = {}
  for (const [k, rel] of Object.entries(JARVIS_FILES)) files[k] = existsSync(join(ROOT, rel))
  const ports = {}
  for (const [k, p] of Object.entries(JARVIS_PORTS)) ports[k] = await portOpen(p)
  return {
    files, ports,
    brainRegistered: true, // gemma-4-12b in chat.mjs TEXT_MODEL_DEFS
    ready: !!(files.brain && files.stt_gguf && files.tts_t3),
    wakeTrained: !!files.wake,
  }
}
