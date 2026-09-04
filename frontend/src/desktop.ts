// Ponte opzionale verso l'app desktop Tauri.
// Quando la UI gira dentro Palamede.exe, espone:
//   notify(title, body)  → notifica nativa di Windows (tray)
// Tutte le funzioni sono no-op sicure se la UI è aperta in un browser.

type TauriApi = {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
}

function tauri(): TauriApi | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: TauriApi }
  if (w.__TAURI_INTERNALS__ && w.__TAURI__) return w.__TAURI__
  return null
}

/** Notifica nativa di sistema (solo dentro Palamede.exe). */
export function notify(title: string, body: string): void {
  const api = tauri()
  if (!api) return
  api.core.invoke('notify', { title, body }).catch(() => {})
}

/** True se la UI gira dentro l'app desktop (non nel browser). */
export function inDesktop(): boolean {
  return tauri() !== null
}