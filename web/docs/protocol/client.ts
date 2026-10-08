/**
 * Frame-side protocol client (runs inside the genoffice Docs iframe).
 *
 * - Talks only to `window.parent`, only to/from the exact allowed host origins.
 * - Auth is cookie-free: the token arrives in `init` (or `token.update`), is
 *   kept in this closure only (never storage, never cookies), and is renewed
 *   through a single-flight `token.refresh` request when it is about to
 *   expire or an API call returns 401.
 * - Handshake: emits `ready` (retried until the host answers) -> host sends
 *   `init` -> this client answers with an InitAck.
 */
import {
  Endpoint,
  err,
  type MessageSource,
  type PostTarget,
  type RejectInfo,
  type RequestOptions,
} from './endpoint'
import {
  CAPABILITY_KEYS,
  DocsProtocolError,
  PROTOCOL_VERSION,
  errorFromHttpStatus,
  toProtocolError,
  type ApiMode,
  type Capabilities,
  type FileMeta,
  type FrameRequestType,
  type FrameRequests,
  type HostEvents,
  type HostRequests,
  type InitAck,
  type InitPayload,
  type OpenPayload,
  type ProtocolErrorShape,
  type SavedPayload,
  type Theme,
  type TokenPayload,
} from './types'

export interface DocsFrameClientOptions {
  /** exact host origins (scheme://host[:port]); same-origin deployment: [location.origin] */
  allowedOrigins: readonly string[]
  /** what this frame build supports */
  capabilities: Capabilities
  frameVersion?: string
  /** default: window.parent */
  parent?: PostTarget
  /** default: window */
  self?: MessageSource
  /** default request timeout (ms) */
  timeoutMs?: number
  /** refresh the token when it expires within this window (ms, default 60 s) */
  refreshLeadMs?: number
  /** `ready` is re-sent every readyRetryMs until `init` arrives (default 500 ms, 40 tries) */
  readyRetryMs?: number
  readyMaxAttempts?: number
  /** injectable clock + fetch for tests */
  now?: () => number
  fetch?: typeof fetch
  onReject?: (info: RejectInfo) => void
}

/** Everything from `init` except the token, which stays private. */
export interface FrameSession {
  documentId: string
  workspaceId: string
  apiBase: string
  apiMode: ApiMode
  locale: string
  theme: Theme
  /** effective capabilities: granted by the host AND supported by the frame */
  capabilities: Capabilities
  /** document to open right away, if the host put one in `init` */
  open?: OpenPayload
}

type HostRequestHandler<K extends keyof HostRequests> = (
  payload: HostRequests[K]['payload'],
  ctx: { signal: AbortSignal },
) => HostRequests[K]['result'] | Promise<HostRequests[K]['result']>

export interface DocsFrameClient {
  /** resolves on the first valid `init`; rejects with `version_mismatch` if the host speaks another version */
  whenInitialized(): Promise<FrameSession>
  readonly session: FrameSession | null
  /** a token valid for at least `refreshLeadMs` (refreshes first if needed) */
  getToken(): Promise<string>
  /** force a refresh (single-flight) */
  refreshToken(reason: 'expiring' | 'unauthorized'): Promise<string>
  /** frame -> host request; waits for `init` first */
  request<K extends FrameRequestType>(
    type: K,
    payload: FrameRequests[K]['payload'],
    options?: RequestOptions,
  ): Promise<FrameRequests[K]['result']>
  /** 'direct' api mode: fetch `apiBase + path` with the bearer token, credentials omitted, one retry after 401 */
  fetchApi(path: string, init?: RequestInit): Promise<Response>
  handleOpen(handler: HostRequestHandler<'open'>): () => void
  handleSave(handler: HostRequestHandler<'save'>): () => void
  handleSaveAs(handler: HostRequestHandler<'saveAs'>): () => void
  handlePrint(handler: HostRequestHandler<'print'>): () => void
  handleCloseCheck(handler: HostRequestHandler<'doc.closeCheck'>): () => void
  onFileRenamed(listener: (file: FileMeta) => void): () => void
  onTheme(listener: (theme: Theme) => void): () => void
  onLanguage(listener: (locale: string) => void): () => void
  setDirty(dirty: boolean): void
  setTitle(title: string): void
  reportHeight(height: number): void
  reportSaved(payload: SavedPayload): void
  reportError(error: ProtocolErrorShape | unknown, fatal?: boolean): void
  dispose(): void
}

export function createDocsFrameClient(options: DocsFrameClientOptions): DocsFrameClient {
  const now = options.now ?? Date.now
  const refreshLeadMs = options.refreshLeadMs ?? 60_000
  const parent = options.parent ?? (globalThis as unknown as { parent: PostTarget }).parent
  const self = options.self ?? (globalThis as unknown as MessageSource)
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  const ep = new Endpoint({
    self,
    peer: () => parent,
    allowedOrigins: options.allowedOrigins,
    timeoutMs: options.timeoutMs,
    idPrefix: 'f',
    onReject: options.onReject,
  })

  // private auth state: closure only
  let token: TokenPayload | null = null
  let refreshing: Promise<string> | null = null
  let session: FrameSession | null = null
  let lastDirty: boolean | null = null

  let resolveInit!: (s: FrameSession) => void
  let rejectInit!: (e: DocsProtocolError) => void
  const initialized = new Promise<FrameSession>((res, rej) => {
    resolveInit = res
    rejectInit = rej
  })
  initialized.catch(() => {}) // observed via whenInitialized()

  // ---- handshake
  let readyTimer: ReturnType<typeof setInterval> | null = null
  const stopReady = (): void => {
    if (readyTimer !== null) clearInterval(readyTimer)
    readyTimer = null
  }
  const sendReady = (): void => {
    try {
      ep.emit('ready', {
        protocolVersion: PROTOCOL_VERSION,
        frameVersion: options.frameVersion,
        capabilities: options.capabilities,
      })
    } catch {
      // not framed / parent gone: keep retrying until the budget runs out
    }
  }

  ep.handle('init', (raw) => {
    const p = raw as InitPayload
    if (p.protocolVersion !== PROTOCOL_VERSION) {
      const e = err(
        'version_mismatch',
        `host protocol v${p.protocolVersion}, frame v${PROTOCOL_VERSION}`,
        {
          details: { remoteVersion: p.protocolVersion, localVersion: PROTOCOL_VERSION },
        },
      )
      rejectInit(e)
      throw e
    }
    stopReady()
    token = { token: p.token, tokenExpiresAt: p.tokenExpiresAt }
    const capabilities: Capabilities = {}
    for (const k of CAPABILITY_KEYS) {
      capabilities[k] = p.capabilities[k] === true && options.capabilities[k] === true
    }
    const next: FrameSession = {
      documentId: p.documentId,
      workspaceId: p.workspaceId,
      apiBase: p.apiBase,
      apiMode: p.apiMode,
      locale: p.locale,
      theme: p.theme,
      capabilities,
    }
    if (p.open) next.open = p.open
    // a repeated init (host re-handshake) updates the object callers already hold
    if (session) {
      delete session.open
      Object.assign(session, next)
    } else session = next
    resolveInit(session)
    const ack: InitAck = { protocolVersion: PROTOCOL_VERSION, capabilities }
    if (options.frameVersion !== undefined) ack.frameVersion = options.frameVersion
    return ack
  })

  ep.on('$version_mismatch', (shape) => {
    stopReady()
    rejectInit(new DocsProtocolError(shape as ProtocolErrorShape))
  })

  ep.on('token.update', (raw) => {
    const p = raw as HostEvents['token.update']
    if (!token || p.tokenExpiresAt >= token.tokenExpiresAt) token = { ...p }
  })
  ep.on('theme', (raw) => {
    if (session) session.theme = (raw as HostEvents['theme']).theme
  })
  ep.on('language', (raw) => {
    if (session) session.locale = (raw as HostEvents['language']).locale
  })

  sendReady()
  {
    let attempts = 1
    const max = options.readyMaxAttempts ?? 40
    readyTimer = setInterval(() => {
      if (session || attempts >= max) return stopReady()
      attempts += 1
      sendReady()
    }, options.readyRetryMs ?? 500)
  }

  // ---- auth
  async function refreshToken(reason: 'expiring' | 'unauthorized'): Promise<string> {
    if (!refreshing) {
      refreshing = (async () => {
        await initialized
        try {
          const next = (await ep.request('token.refresh', { reason })) as TokenPayload
          token = { ...next }
          return next.token
        } catch (e) {
          const pe = toProtocolError(e)
          throw pe.code === 'timeout' || pe.code === 'cancelled'
            ? pe
            : new DocsProtocolError({
                ...pe.toShape(),
                code: 'unauthorized',
                message: `token refresh failed: ${pe.message}`,
              })
        } finally {
          refreshing = null
        }
      })()
    }
    return refreshing
  }

  async function getToken(): Promise<string> {
    await initialized
    if (refreshing) return refreshing
    if (!token || token.tokenExpiresAt - now() <= refreshLeadMs) return refreshToken('expiring')
    return token.token
  }

  async function request<K extends FrameRequestType>(
    type: K,
    payload: FrameRequests[K]['payload'],
    opts?: RequestOptions,
  ): Promise<FrameRequests[K]['result']> {
    await initialized
    return (await ep.request(type, payload, opts)) as FrameRequests[K]['result']
  }

  async function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
    const s = await initialized
    const base = s.apiBase.replace(/\/+$/, '')
    const url = /^https?:\/\//.test(path) ? path : `${base}/${path.replace(/^\/+/, '')}`
    // the bearer token never leaves apiBase
    if (url !== base && !url.startsWith(`${base}/`) && !url.startsWith(`${base}?`)) {
      throw err('forbidden', 'fetchApi only calls apiBase')
    }
    const attempt = async (bearer: string): Promise<Response> => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${bearer}`)
      try {
        return await doFetch(url, { ...init, headers, credentials: 'omit' })
      } catch (e) {
        throw toProtocolError(e)
      }
    }
    let res = await attempt(await getToken())
    if (res.status === 401) res = await attempt(await refreshToken('unauthorized'))
    if (res.status === 401) throw errorFromHttpStatus(401, 'unauthorized after token refresh')
    return res
  }

  function guarded(fn: () => void): void {
    try {
      fn()
    } catch {
      // parent gone; nothing to report to
    }
  }

  return {
    whenInitialized: () => initialized,
    get session() {
      return session
    },
    getToken,
    refreshToken,
    request,
    fetchApi,
    handleOpen: (h) => ep.handle('open', (p, ctx) => h(p as HostRequests['open']['payload'], ctx)),
    handleSave: (h) => ep.handle('save', (p, ctx) => h(p as HostRequests['save']['payload'], ctx)),
    handleSaveAs: (h) =>
      ep.handle('saveAs', (p, ctx) => h(p as HostRequests['saveAs']['payload'], ctx)),
    handlePrint: (h) =>
      ep.handle('print', (p, ctx) => h(p as HostRequests['print']['payload'], ctx)),
    handleCloseCheck: (h) =>
      ep.handle('doc.closeCheck', (p, ctx) =>
        h(p as HostRequests['doc.closeCheck']['payload'], ctx),
      ),
    onFileRenamed: (l) => ep.on('file.renamed', (p) => l((p as HostEvents['file.renamed']).file)),
    onTheme: (l) => ep.on('theme', (p) => l((p as HostEvents['theme']).theme)),
    onLanguage: (l) => ep.on('language', (p) => l((p as HostEvents['language']).locale)),
    setDirty(dirty) {
      if (dirty === lastDirty) return
      lastDirty = dirty
      guarded(() => ep.emit('dirty', { dirty }))
    },
    setTitle: (title) => guarded(() => ep.emit('title', { title })),
    reportHeight: (height) =>
      guarded(() => ep.emit('resize', { height: Math.max(0, Math.ceil(height)) })),
    reportSaved: (payload) => guarded(() => ep.emit('saved', payload)),
    reportError(error, fatal = false) {
      guarded(() => ep.emit('error', { error: toProtocolError(error).toShape(), fatal }))
    },
    dispose() {
      stopReady()
      token = null
      rejectInit(err('cancelled', 'client disposed'))
      ep.dispose()
    },
  }
}
