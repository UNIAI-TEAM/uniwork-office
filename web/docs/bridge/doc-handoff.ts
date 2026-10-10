/**
 * OpenFileResult.dataUrl on the web (UNI-1013): an in-page one-shot handle,
 * the web twin of apps/docs/src/main/byte-handoff.ts.
 *
 * The renderer reads `dataUrl` with fetchDocBytes(). The frame CSP keeps
 * connect-src to 'self' (no blob:/data:, web/docs/build/csp.ts), so a fetch of
 * an object URL is refused. Instead the bytes stay in this map and
 * fetchDocBytes() takes them through the resolver registered here, before any
 * fetch(). Desktop never registers a resolver, so its path is unchanged.
 */
import { setDocBytesResolver } from '../../../apps/docs/src/renderer/doc-bytes'

/** not fetchable on purpose: if the resolver is missing, fetch fails loudly */
export const DOC_HANDOFF_SCHEME = 'uniwork-handoff:'
/** an unclaimed handle (the open was abandoned) is dropped after this */
export const DOC_HANDOFF_TTL_MS = 60_000

const pending = new Map<string, { bytes: Uint8Array; timer: ReturnType<typeof setTimeout> }>()
let seq = 0
let installed = false

function take(url: string): Uint8Array | undefined {
  if (!url.startsWith(DOC_HANDOFF_SCHEME)) return undefined
  const entry = pending.get(url)
  if (!entry) throw new Error('document bytes unavailable (handoff expired)')
  clearTimeout(entry.timer)
  pending.delete(url)
  return entry.bytes
}

/** hand `data` to the renderer's next fetchDocBytes(url) */
export function mintDocHandoff(data: ArrayBuffer): string {
  if (!installed) {
    setDocBytesResolver(take)
    installed = true
  }
  seq += 1
  const url = `${DOC_HANDOFF_SCHEME}${seq}-${Math.random().toString(36).slice(2)}`
  const timer = setTimeout(() => pending.delete(url), DOC_HANDOFF_TTL_MS)
  pending.set(url, { bytes: new Uint8Array(data), timer })
  return url
}

/** drop a handle the renderer will never read (e.g. replaced by a restored draft) */
export function releaseDocHandoff(url: string): void {
  const entry = pending.get(url)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(url)
}

/** handles still waiting for the renderer (tests) */
export function pendingDocHandoffs(): number {
  return pending.size
}
