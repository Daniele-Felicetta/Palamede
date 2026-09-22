// Palamede hub — metriche di sistema (ASINCRONE: mai bloccare l'event loop).
// Snapshot in cache servito a /api/metrics; refresh in background ogni 2.5s.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { totalmem, freemem } from 'node:os'

const execFileP = promisify(execFile)

let metrics = {
  ts: 0, cpu: 0,
  ram: { usedGB: 0, totalGB: 0, pct: 0 },
  gpu: { ok: false, utilPct: 0, vramUsedGB: 0, vramTotalGB: 0, vramPct: 0, tempC: 0, powerW: 0, procs: [] },
}

export function currentMetrics() {
  return metrics
}

function num(s) {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : 0
}

// CPU: Win32_Processor.LoadPercentage è rapido e non richiede il counter
// lento di Get-Counter (~1s a chiamata). Se esce 0 (spesso a riposo) usa
// l'ultimo valore noto per non avere strani "buchi" nella sidebar.
let lastCpu = 0
async function psCpu() {
  try {
    const { stdout } = await execFileP('powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
       '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'],
      { timeout: 5000, windowsHide: true })
    const v = num(stdout)
    if (v > 0) lastCpu = v
    return Math.round((v > 0 ? v : lastCpu) * 10) / 10
  } catch {
    return lastCpu
  }
}

// Ultimo sample GPU valido: se nvidia-smi va in timeout (sotto carico) o
// fallisce, continuiamo a servire l'ultimo valore invece di far comparire
// "nvidia-smi non disponibile" a ogni refresh.
let lastGoodGpu = null

async function gpuStats() {
  try {
    const { stdout: smi } = await execFileP('nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw',
       '--format=csv,noheader,nounits'],
      { timeout: 10000, windowsHide: true })
    const [util, vused, vtot, temp, power] = smi.trim().split(',').map(num)
    let procs = []
    try {
      const { stdout: pl } = await execFileP('nvidia-smi',
        ['--query-compute-apps=process_name,used_memory', '--format=csv,noheader'],
        { timeout: 10000, windowsHide: true })
      // i processi senza memoria riportata (desktop compositing, [N/A]) si
      // mostrano comunque con '?': la lista dice "la GPU è viva".
      const interesting = /llama|python|sd-server|node|LM Studio|uv|Palamede/i
      procs = pl.split(/\r?\n/)
        .filter((line) => line && line.includes(','))
        .map((line) => {
          const i = line.lastIndexOf(',')
          const name = line.slice(0, i).trim()
          let mem = line.slice(i + 1).trim()
          if (mem.includes('[N/A]') || mem === '') mem = '?'
          return { name, mem, hot: interesting.test(name) }
        })
        .sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0))
        .slice(0, 8)
        .map(({ name, mem }) => ({ name, mem }))
    } catch { /* nessun processo */ }
    const vramUsedGB = vused / 1024, vramTotalGB = vtot / 1024
    lastGoodGpu = {
      ok: vtot > 0, utilPct: util, vramUsedGB, vramTotalGB,
      vramPct: vtot ? Math.round((vused / vtot) * 100) : 0,
      tempC: temp, powerW: power, procs,
    }
    return lastGoodGpu
  } catch {
    // sample fallito: se prima è andato, serviamo lo stale (mai "non disponibile")
    if (lastGoodGpu) return { ...lastGoodGpu }
    return { ok: false, utilPct: 0, vramUsedGB: 0, vramTotalGB: 0, vramPct: 0, tempC: 0, powerW: 0, procs: [] }
  }
}

async function refreshMetrics() {
  try {
    const [cpu, gpu] = await Promise.all([psCpu(), gpuStats()])
    const totalGB = totalmem() / 2 ** 30
    const freeGB = freemem() / 2 ** 30
    metrics = {
      ts: Date.now(), cpu,
      ram: { usedGB: Math.round((totalGB - freeGB) * 10) / 10, totalGB: Math.round(totalGB * 10) / 10, pct: Math.round(((totalGB - freeGB) / totalGB) * 100) },
      gpu,
    }
  } catch (e) {
    console.error('[metrics]', e)
  }
}

export function startMetrics(intervalMs = 2500) {
  setInterval(() => { refreshMetrics().catch(() => {}) }, intervalMs)
  refreshMetrics().catch(() => {})
}
