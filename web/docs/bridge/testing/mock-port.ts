/**
 * Mocked protocol transport for the bridge unit tests (replaces the spike's
 * in-memory FakeBackend). An in-memory "UniWork" behind the `api.*` requests
 * with etag concurrency, plus per-type overrides to inject errors, timeouts
 * and odd results, and access to the host->frame handlers the bridge
 * registered so tests can play the host.
 */
import {
  DocsProtocolError,
  type FileMeta,
  type FrameRequestType,
  type FrameRequests,
  type HostRequests,
  type OpenPayload,
  type ProtocolErrorCode,
  type SavedPayload,
  type Theme,
} from '../../protocol/types'
import type { FramePort, PortRequestOptions, PortSession } from '../frame-port'

type Override = (payload: unknown, opts?: PortRequestOptions) => unknown
type HostHandlers = { [K in keyof HostRequests]?: (p: HostRequests[K]['payload']) => unknown }

interface StoredFile {
  meta: FileMeta
  bytes: Uint8Array
}

export function protocolError(code: ProtocolErrorCode, message: string = code): DocsProtocolError {
  return new DocsProtocolError({ code, message })
}

/** a request that never answers until `timeoutMs`, then rejects like the client does */
export function timeoutAfter(_payload: unknown, opts?: PortRequestOptions): Promise<never> {
  return Promise.reject(protocolError('timeout', `timed out after ${opts?.timeoutMs} ms`))
}

export function createMockPort(session: Partial<PortSession> = {}) {
  const store = new Map<string, StoredFile>()
  let seq = 0
  const overrides = new Map<string, Override>()
  const handlers: HostHandlers = {}
  const calls: Array<{ type: string; payload: unknown; opts?: PortRequestOptions }> = []
  const dirty: boolean[] = []
  const sent = { dirty: 0 }
  const titles: string[] = []
  const modals: boolean[] = []
  const saved: SavedPayload[] = []
  const errors: Array<{ error: unknown; fatal?: boolean }> = []
  const renameListeners: Array<(file: FileMeta) => void> = []
  const themeListeners: Array<(theme: Theme) => void> = []
  const languageListeners: Array<(locale: string) => void> = []

  function put(name: string, bytes: Uint8Array, fileId = `f${++seq}`): FileMeta {
    const version = (store.get(fileId)?.meta.versionId ?? 'v0').replace(/\d+$/, (n) =>
      String(+n + 1),
    )
    const meta: FileMeta = {
      fileId,
      name,
      versionId: version,
      etag: `"${fileId}-${version}"`,
      sizeBytes: bytes.byteLength,
    }
    store.set(fileId, { meta, bytes: bytes.slice() })
    return meta
  }

  const api: {
    [K in FrameRequestType]: (p: FrameRequests[K]['payload']) => FrameRequests[K]['result']
  } = {
    'token.refresh': () => ({ token: 't2', tokenExpiresAt: Date.now() + 60_000 }),
    'api.open': ({ fileId }) => {
      const f = store.get(fileId)
      if (!f) throw protocolError('not_found', `no file ${fileId}`)
      const data = f.bytes.slice().buffer
      return { file: { ...f.meta }, source: { kind: 'bytes', data } }
    },
    'api.save': ({ fileId, data, etag }) => {
      const f = store.get(fileId)
      if (!f) throw protocolError('not_found')
      if (etag !== undefined && etag !== f.meta.etag) {
        return { ok: false, error: { code: 'conflict', message: 'stale etag', status: 412 } }
      }
      const meta = put(f.meta.name, new Uint8Array(data), fileId)
      return { ok: true, file: meta, versionId: meta.versionId }
    },
    'api.saveAs': ({ name, data }) => {
      const meta = put(name, new Uint8Array(data))
      return { ok: true, file: meta, versionId: meta.versionId }
    },
    'api.recents': ({ limit }) => ({
      files: [...store.values()]
        .map((f) => f.meta)
        .reverse()
        .slice(0, limit ?? 20),
    }),
    'api.export': ({ name }) => ({
      data: new TextEncoder().encode('%PDF-1.7 mock').buffer,
      mimeType: 'application/pdf',
      ...(name ? { name } : {}),
    }),
    'api.attachments.add': () => ({ accepted: [], rejected: [] }),
    'api.images.upload': () => ({ imageId: 'i1', url: '/img/i1' }),
    // the "user" picks the newest file
    'file.pick': () => {
      const last = [...store.keys()].at(-1)
      return { file: last ? api['api.open']({ fileId: last }) : null }
    },
    'image.fetch': () => ({ image: { base64: 'iVBORw0KGgo=', mime: 'image/png' } }),
    'convert.altChunkHtml': () => ({ data: new Uint8Array([0x50, 0x4b]).buffer }),
  }

  const initSession: PortSession = { documentId: session.documentId ?? 'missing', ...session }
  let resolveInit!: (s: PortSession) => void
  const initialized = new Promise<PortSession>((r) => (resolveInit = r))

  const port: FramePort = {
    whenInitialized: () => initialized,
    async request(type, payload, opts) {
      calls.push({ type, payload, opts })
      const o = overrides.get(type)
      if (o) return (await o(payload, opts)) as never
      return api[type](payload as never) as never
    },
    handleOpen: (h) => ((handlers.open = h as never), () => {}),
    handleSave: (h) => ((handlers.save = h as never), () => {}),
    handleSaveAs: (h) => ((handlers.saveAs = h as never), () => {}),
    handlePrint: (h) => ((handlers.print = h as never), () => {}),
    handleCloseCheck: (h) => ((handlers['doc.closeCheck'] = h as never), () => {}),
    onFileRenamed: (l) => (renameListeners.push(l), () => {}),
    onTheme: (l) => (themeListeners.push(l), () => {}),
    onLanguage: (l) => (languageListeners.push(l), () => {}),
    setDirty: (d, opts) => {
      // the real client dedupes an unchanged flag unless the caller forces it (after a failed save)
      if (opts?.force || dirty[dirty.length - 1] !== d) {
        dirty.push(d)
        sent.dirty++
      }
    },
    setTitle: (t) => titles.push(t),
    setModal: (open) => modals.push(open),
    reportSaved: (p) => saved.push(p),
    reportError: (error, fatal) => errors.push({ error, fatal }),
  }

  return {
    port,
    /** finish the handshake (call after seeding files) */
    init(extra: Partial<PortSession> = {}) {
      resolveInit({ ...initSession, ...extra })
    },
    seed(name: string, bytes: Uint8Array): FileMeta {
      return put(name, bytes)
    },
    /** simulate another user saving the file on the server */
    bumpRemote(fileId: string): FileMeta {
      const f = store.get(fileId)!
      return put(f.meta.name, f.bytes, fileId)
    },
    /** write new bytes as the next version (a save that landed on the server) */
    commit(fileId: string, bytes: Uint8Array): FileMeta {
      return put(store.get(fileId)!.meta.name, bytes, fileId)
    },
    bytesOf: (fileId: string) => store.get(fileId)?.bytes,
    openPayload(fileId: string): OpenPayload {
      return api['api.open']({ fileId })
    },
    /** host event file.renamed */
    rename(fileId: string, name: string) {
      const f = store.get(fileId)!
      f.meta = { ...f.meta, name }
      for (const l of renameListeners) l({ ...f.meta })
    },
    /** host events theme / language */
    sendTheme: (theme: Theme) => themeListeners.forEach((l) => l(theme)),
    sendLanguage: (locale: string) => languageListeners.forEach((l) => l(locale)),
    override(type: FrameRequestType, fn: Override) {
      overrides.set(type, fn)
    },
    clearOverrides: () => overrides.clear(),
    host: handlers as Required<HostHandlers>,
    calls,
    dirty,
    /** dirty events that reached the host, duplicates included (a forced re-send) */
    get dirtySent() {
      return sent.dirty
    },
    titles,
    modals,
    saved,
    errors,
  }
}

export type MockPort = ReturnType<typeof createMockPort>
