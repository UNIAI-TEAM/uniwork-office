/**
 * Worker-thread entry for the pure-JS ODF -> OOXML fallback engine (UNI-2279).
 *
 * Runs `@genoffice/odf2ooxml` (`convertOdtToDocx` / `convertOdpToPptx`) off the
 * Electron main process in a short-lived `node:worker_threads` Worker started
 * per fallback job. A large presentation (e.g. a 105-slide deck) would
 * otherwise block the main event loop for ~0.9 s, and a small hostile archive
 * that amplifies XML/table allocations can hit a fatal V8 heap OOM and take the
 * entire shell (and every open document) down with it.
 */
import { parentPort } from 'node:worker_threads'
import { convertOdpToPptx, convertOdtToDocx, OdfConvertError } from '@genoffice/odf2ooxml'

export type OdfWorkerKind = 'odt' | 'odp'

export interface OdfWorkerRequest {
  readonly kind: OdfWorkerKind
  readonly bytes: Uint8Array
}

export interface OdfWorkerDroppedItem {
  readonly what: string
  readonly count: number
}

export type OdfWorkerResponse =
  | {
      readonly ok: true
      readonly kind: 'odt'
      readonly bytes: Uint8Array
      readonly blocks: number
      readonly dropped: OdfWorkerDroppedItem[]
    }
  | {
      readonly ok: true
      readonly kind: 'odp'
      readonly bytes: Uint8Array
      readonly slides: number
      readonly dropped: OdfWorkerDroppedItem[]
    }
  | {
      readonly ok: false
      readonly name: string
      readonly code?: 'unreadable' | 'not-a-text-document' | 'not-a-presentation'
      readonly message: string
    }

export interface OdfWorkerPort {
  on(event: 'message', listener: (req: OdfWorkerRequest) => void): unknown
  postMessage(res: OdfWorkerResponse): void
}

export async function runOdfWorkerRequest(req: OdfWorkerRequest): Promise<OdfWorkerResponse> {
  try {
    const input =
      req.bytes instanceof Uint8Array
        ? new Uint8Array(req.bytes.buffer, req.bytes.byteOffset, req.bytes.byteLength)
        : new Uint8Array(req.bytes)
    if (req.kind === 'odt') {
      const converted = await convertOdtToDocx(input)
      return {
        ok: true,
        kind: 'odt',
        bytes: converted.docx,
        blocks: converted.blocks,
        dropped: converted.dropped,
      }
    }
    if (req.kind === 'odp') {
      const converted = await convertOdpToPptx(input)
      return {
        ok: true,
        kind: 'odp',
        bytes: converted.pptx,
        slides: converted.slides,
        dropped: converted.dropped,
      }
    }
    const unsupportedKind: unknown = 'kind' in req ? req.kind : undefined
    throw new Error(`Unsupported ODF worker kind: ${String(unsupportedKind)}`)
  } catch (err) {
    if (err instanceof OdfConvertError) {
      return {
        ok: false,
        name: 'OdfConvertError',
        code: err.code,
        message: err.message,
      }
    }
    const code =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err.code === 'unreadable' ||
        err.code === 'not-a-text-document' ||
        err.code === 'not-a-presentation')
        ? err.code
        : undefined
    return {
      ok: false,
      name: err instanceof Error && err.name ? err.name : 'Error',
      ...(code ? { code } : {}),
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export function attachOdfFallbackWorker(port: OdfWorkerPort): void {
  let handled = false
  port.on('message', (req: OdfWorkerRequest) => {
    if (handled) return
    if (!req || typeof req !== 'object' || (req.kind !== 'odt' && req.kind !== 'odp')) return
    handled = true
    void runOdfWorkerRequest(req).then((res) => {
      port.postMessage(res)
    })
  })
}

if (parentPort) {
  attachOdfFallbackWorker(parentPort)
}
