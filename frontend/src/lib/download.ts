// Utilità di download file (Blob/dataURL → file su disco).
// Estratto da 3d.svelte: riusabile ovunque serva "scarica questo risultato"
// (GLB/STL, immagini, export wiki…). In Tauri il target=_blank non funziona,
// quindi si usa sempre l'anchor + objectURL.

/** Scarica un Blob con nome file (revoca l'objectURL dopo 5 s). */
export function saveBlob(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/** dataURL base64 → byte grezzi (per viewer/anteprime senza fetch). */
export function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const bin = atob(b64 ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Scarica da URL (stessa origin hub) con fallback su `fallback()` se il
 *  fetch fallisce (es. file già ruotato fuori da outputs/). */
export async function downloadUrl(
  url: string,
  name: string,
  fallback?: () => Blob,
): Promise<'url' | 'fallback'> {
  try {
    const blob = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(String(r.status))
      return r.blob()
    })
    saveBlob(blob, name)
    return 'url'
  } catch {
    if (!fallback) throw new Error(`download non riuscito: ${name}`)
    saveBlob(fallback(), name)
    return 'fallback'
  }
}
