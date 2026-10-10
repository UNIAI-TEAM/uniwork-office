/**
 * "Is the head version our own write?" after a save whose outcome is unknown (timeout / network:
 * the request was cancelled but the host may have committed it). Review finding RF-7: comparing
 * only the size adopted a foreign same-size version and the next save then overwrote it without a
 * conflict. The head is adopted only when its bytes equal the bytes we sent; anything else keeps
 * the old etag, so a real concurrent edit still surfaces as a conflict prompt on the next save.
 */
import type { FileMeta, FileSource, OpenPayload } from '../protocol/types'
import { TIMEOUTS, type FramePort } from './frame-port'

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false
  return true
}

async function readHead(source: FileSource): Promise<Uint8Array> {
  if (source.kind === 'bytes') return new Uint8Array(source.data)
  const res = await fetch(source.url, {
    credentials: 'omit',
    headers: source.headers,
    signal: AbortSignal.timeout(TIMEOUTS.transfer),
  })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * The head's metadata when it moved past `beforeEtag` and holds exactly `sent`, else null. A head
 * that cannot be read counts as "not ours".
 */
export async function ownHeadAfterUnknown(
  port: Pick<FramePort, 'request'>,
  fileId: string,
  beforeEtag: string | undefined,
  sent: ArrayBuffer | Uint8Array,
): Promise<FileMeta | null> {
  if (!beforeEtag) return null
  try {
    const head: OpenPayload = await port.request(
      'api.open',
      { fileId },
      { timeoutMs: TIMEOUTS.short },
    )
    if (head?.file?.fileId !== fileId || !head.file.etag || head.file.etag === beforeEtag) {
      return null
    }
    const bytes = sent instanceof Uint8Array ? sent : new Uint8Array(sent)
    if (head.file.sizeBytes !== undefined && head.file.sizeBytes !== bytes.byteLength) return null
    return sameBytes(await readHead(head.source), bytes) ? head.file : null
  } catch (err) {
    console.warn('[office-web] reading the head version failed:', err)
    return null
  }
}
