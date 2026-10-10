/**
 * window.slidesApi for the Slides web frame (GO-B5, UNI-1015).
 *
 * On the desktop the document engine runs in Electron main and the renderer reaches it over
 * 158 IPC channels. Here the same session core (apps/slides/src/session) runs in the frame on
 * the main thread (B5 decision 8): every engine method calls the session handler registry
 * directly with a structured clone of its arguments and result, which is exactly what IPC did
 * (so the renderer can never mutate the live deck through a returned object, nor the deck keep
 * a reference to a renderer object). File I/O goes over the frame protocol through the web
 * HostIO (./web-host-io.ts); everything else is a browser feature or a typed stub. The method
 * classes follow docs/web-modules/inventory-b5.md 1.2:
 *
 * | class            | methods                                                                   |
 * |------------------|---------------------------------------------------------------------------|
 * | engine           | the `slides:*` session handlers (edits, queries, history, save, save-as)  |
 * | protocol         | consumePendingOpen (init.open / api.open), onOpened (host `open`), openPptx (file.pick), openPptxPath / getRecentFiles (api.open / api.recents), onRenamed (file.renamed), host save / saveAs / print / doc.closeCheck |
 * | browser          | exports (zip / PDF downloads), printSlides (srcdoc frame), clipboard, fullscreen, media blob: URLs |
 * | presenter        | presenter* / onAudienceNav: the audience window (./presenter-window.ts, SP1)              |
 * | hidden (stubs)   | AI (27), fonts download/install, headless export, autosave (C10)                         |
 * | draft recovery   | C18: encrypted IndexedDB copy of savePptx(session) every 30 s while dirty; offered before the init / host `open` deck is built (Restore = `recovered`, starts dirty) |
 *
 * Typed as the full SlidesApi (no Partial): a new preload method is a build error here.
 */
import { createBlankPptx, savePptx } from '@genoffice/pptx-engine'
import type { AiPanelPrefs } from '@genoffice/ui'
import { base64ToBytes, bytesToBase64 } from '../../../apps/slides/src/session/bytes'
import {
  appClipboard,
  callSessionHandler,
  configureSessionPlatform,
  ELEMENTS_MARKER,
  openResultFor,
  openSessionFromBytes,
  resetFontMetricsCache,
  sessionDirty,
  sessions,
  SLIDE_MARKER,
  type HandlerContext,
  type HostIO,
  type SessionChannel,
} from '../../../apps/slides/src/session'
import type {
  ExportImagesOp,
  ExportImagesResult,
  ExportPdfOp,
  SavePictureOp,
  SavePictureResult,
  ExportPdfResult,
  MenuCommand,
  OpenResult,
  PrintSlidesOp,
  SlidesApi,
} from '../../../apps/slides/src/shared/ipc'
import {
  toProtocolError,
  type FileMeta,
  type FileSource,
  type OpenPayload,
  type ProtocolErrorShape,
  type SaveResult,
} from '../../docs/protocol/types'
import aiStubs, { aiUnavailableMessage } from '../../docs/bridge/ai'
import browser, { downloadBlob, safeFileName } from '../../docs/bridge/browser'
import type { DraftHost, DraftRecovery } from '../../docs/bridge/draft-recovery'
import { TIMEOUTS, errorCode } from '../../docs/bridge/frame-port'
import type { ModuleBridgePort } from '../../docs/bridge/module-bridge'
import { idFromPath, pathFor } from '../../docs/bridge/webapi'
import { bridgeDraftRecovery } from '../shared/recovery-prompt'
import { ask, hideFatal, showFatal, text, type WebKey } from './dialogs'
import { createFullscreenControl } from './fullscreen-hint'
import { exportPagesToPngs, printDocument, printHtml, slidesPdf, zipImages } from './exports'
import {
  createWebFontMetrics,
  embeddedFontSources,
  loadBundledFonts,
  registerEmbeddedFonts,
} from './fonts'
import { nativeOpen } from './native-open'
import { createPresenterWindow, type PresenterWindow } from './presenter-window'
import type { ScreenPlacer } from './screens'
import { tiffToPng } from './tiff'
import { pictureDpiFor } from '../../../apps/slides/src/main/picture-frame'
import { createDocState, createWebHostIO, SENTINEL_PREFIX, WebSaveError } from './web-host-io'

/**
 * Engine channels that never change the deck: the only ones a view-only frame (no host `save`
 * grant) still serves; every other channel answers null (save / save-as: {ok:false}).
 */
const READ_ONLY_CHANNELS: ReadonlySet<SessionChannel> = new Set<SessionChannel>([
  'slides:get-render-slides',
  'slides:get-slide-size',
  'slides:get-layouts',
  'slides:chart-color-schemes',
  'slides:get-chart-data',
  'slides:get-link',
  'slides:get-slide-links',
  'slides:get-run-links',
  'slides:get-header-footer',
  'slides:get-transition',
  'slides:get-animations',
  'slides:get-shape-keys',
  'slides:get-sections',
  'slides:get-notes',
  'slides:get-comments',
  'slides:is-dirty',
  'slides:recent',
  'slides:media-data',
  'slides:master-enter',
  'slides:master-open',
  'slides:master-close',
  'slides:copy-slides',
  'slides:copy-elements',
  'slides:has-slide-clipboard',
  'slides:clipboard-probe',
  'slides:clipboard-external',
])

/** the one client of the frame (Electron keys sessions by webContents id) */
export const WEB_CLIENT_ID = 1

export interface WebSlidesOptions {
  /** test seams */
  pickFiles?: (accept: string, multiple: boolean) => Promise<File[]>
  clipboard?: Pick<Clipboard, 'writeText' | 'readText'> & Partial<Pick<Clipboard, 'read'>>
  download?: (name: string, blob: Blob) => void
  print?: (html: string) => Promise<{ ok: boolean; error?: string }>
  /** how long the editor may take to start a host-requested Save As / save flow */
  editorStartMs?: number
  /** the presenter's audience window: window.open and screen placement */
  openWindow?: typeof window.open | null
  screens?: ScreenPlacer
  /** draft recovery (C18; default: IndexedDB + the shared prompt); injectable for tests */
  drafts?: (host: DraftHost) => DraftRecovery
}

type Listener<T> = (value: T) => void

function listeners<T>() {
  const set = new Set<Listener<T>>()
  return {
    add(fn: Listener<T>): () => void {
      set.add(fn)
      return () => {
        set.delete(fn)
      }
    },
    emit(value: T): void {
      for (const fn of [...set]) fn(value)
    },
    get size() {
      return set.size
    },
  }
}

/** detached copy of a protocol source */
async function readSource(source: FileSource): Promise<Uint8Array> {
  if (source.kind === 'bytes') return new Uint8Array(source.data).slice()
  const res = await fetch(source.url, { credentials: 'omit', headers: source.headers })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** legacy .ppt / encrypted OOXML share the CFB magic; an EncryptedPackage stream tells them apart */
export function cfbKind(bytes: Uint8Array): 'legacy' | 'encrypted' | null {
  if (bytes.length < 8 || CFB_MAGIC.some((b, i) => bytes[i] !== b)) return null
  const name = 'EncryptedPackage'
  const needle = new Uint8Array(name.length * 2)
  for (let i = 0; i < name.length; i++) needle[i * 2] = name.charCodeAt(i)
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer
    return 'encrypted'
  }
  return 'legacy'
}

/** IPC semantics: arguments and results are structured clones */
function clone<T>(value: T): T {
  return value === undefined || value === null || typeof value !== 'object'
    ? value
    : structuredClone(value)
}

function withExt(name: string, ext: string): string {
  return name.replace(/\.(pptx|pdf|zip)$/i, '') + ext
}

const noop = (): void => {}
const disposer = (): (() => void) => noop

export function createWebSlidesApi(
  ctx: { client: ModuleBridgePort; capabilities: Record<string, unknown> },
  opts: WebSlidesOptions = {},
) {
  const port = ctx.client
  const state = createDocState()
  const download = opts.download ?? downloadBlob
  const editorStartMs = opts.editorStartMs ?? TIMEOUTS.editorStart

  const historyEvents = listeners<{ canUndo: boolean; canRedo: boolean }>()
  const deckEvents = listeners<{ slides: OpenResult['slides']; size: { cx: number; cy: number } }>()
  const openedEvents = listeners<OpenResult>()
  const renamedEvents = listeners<string>()
  const menuEvents = listeners<MenuCommand>()
  const closeSaveEvents = listeners<void>()

  let userName: string | undefined
  // set below; deck edits reach an open audience window through it
  let presenter: PresenterWindow | null = null
  let fontsPending: Promise<void> = Promise.resolve()
  let fontsRelaid = false

  configureSessionPlatform({
    createFontMetrics: () => createWebFontMetrics(),
    decodeTiff: tiffToPng,
    defer: (fn) => void setTimeout(fn, 0),
    defaultPictureDpi: pictureDpiFor(/Mac/i.test(navigator.platform)),
    events: {
      historyChanged: (ids, s) => {
        if (!ids.includes(WEB_CLIENT_ID)) return
        historyEvents.emit({ ...s })
        pushDirty()
      },
      deckChanged: (ids, payload) => {
        if (!ids.includes(WEB_CLIENT_ID)) return
        deckEvents.emit(payload)
        presenter?.deckChanged(payload.slides)
      },
    },
    deckOpened: (opened) => {
      fontsPending = registerEmbeddedFonts(opened).then((added) => {
        if (!added) return
        resetFontMetricsCache()
        fontsRelaid = true
      })
    },
  })

  /** the committed deck differs from the saved file (what a draft copy and a save carry) */
  function sessionIsDirty(): boolean {
    const s = sessions.get(WEB_CLIENT_ID)
    return !!s && sessionDirty(s)
  }

  // Text typed in the on-canvas editor or the notes pane lives in the DOM until it is committed
  // (blur / Escape / Enter), so the session cannot see it. The host asks `isDirty` for its
  // header chip, the leave dialog and the replace guard: typing counts as dirty at once. The
  // Save of the leave dialog runs the renderer's save flow, which commits the open editor first.
  let typingIn: Element | null = null
  let typingWatch: ReturnType<typeof setInterval> | undefined
  const TYPING_SELECTOR = '.slide-text-editor, .notes-pane textarea'

  function setTyping(target: Element | null): void {
    if (target === typingIn) return
    typingIn = target
    if (typingWatch) clearInterval(typingWatch)
    typingWatch = undefined
    if (target) {
      // an Escape / cancel removes the editor without a blur the page can rely on
      typingWatch = setInterval(() => {
        if (typingIn && !typingIn.isConnected) setTyping(null)
      }, 500)
    }
    pushDirty()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener(
      'input',
      (ev) => {
        const t = ev.target
        if (t instanceof Element && !viewOnly() && t.matches(TYPING_SELECTOR)) setTyping(t)
      },
      true,
    )
    document.addEventListener(
      'focusout',
      (ev) => {
        const t = ev.target
        // let the blur commit land in the session first: it carries the edit from here on
        if (t === typingIn && t) setTimeout(() => t === typingIn && setTyping(null), 300)
      },
      true,
    )
  }

  function isDirty(): boolean {
    return sessionIsDirty() || typingIn !== null
  }

  function pushDirty(): void {
    port.setDirty(isDirty())
  }

  let current: string | null = null

  // ------------------------------------------------------------ draft recovery (C18)

  /** the document `init` names: the only one the host's draft scope ("<user>:<document>") covers */
  let initDocumentId: string | null = null
  /** the file an open is offering the draft of (the session still holds the previous deck) */
  let offering: FileMeta | null = null
  let restoredDraft: ArrayBuffer | null = null
  const drafts = (opts.drafts ?? ((h) => bridgeDraftRecovery(port, 'slides', h)))({
    file: () => {
      const file = offering ?? (current !== null ? state.files.get(current) : undefined)
      return file && file.fileId === initDocumentId ? { etag: file.etag, name: file.name } : null
    },
    isDirty: () => sessionIsDirty(),
    bytes: async () => {
      const session = sessions.get(WEB_CLIENT_ID)
      // master view writes only its part back on save: no draft until it is closed
      if (!session || session.masterEdit) return null
      try {
        return await savePptx(session.opened)
      } catch (err) {
        console.warn('[slides-web] draft bytes skipped:', err)
        return null
      }
    },
    restore: (bytes) => {
      restoredDraft = bytes
    },
  })

  /** offer the stored draft of `file` (resolves once answered); the draft bytes on Restore */
  async function offerDraft(file: FileMeta): Promise<Uint8Array | null> {
    restoredDraft = null
    offering = file
    try {
      await drafts.opened()
    } finally {
      offering = null
    }
    const data = restoredDraft
    restoredDraft = null
    return data ? new Uint8Array(data) : null
  }

  const host: HostIO = createWebHostIO({
    port,
    clientId: WEB_CLIENT_ID,
    state,
    capabilities: ctx.capabilities,
    userName: () => userName,
    reload: async (fileId) => {
      const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.transfer })
      const result = await openPayload(open, sessions.get(WEB_CLIENT_ID)?.fitWidthPx ?? 1280)
      if (result) openedEvents.emit(result)
    },
    onSaved: ({ file, previousPath, kind }) => {
      current = file.fileId
      if (kind === 'save' || kind === 'saveAs') void drafts.saved()
      if (kind === 'save' || kind === 'saveAs') setTyping(null)
      const path = pathFor(file)
      port.setTitle(file.name)
      setTimeout(pushDirty, 0)
      if (kind === 'saveAs' || path !== previousPath) renamedEvents.emit(path)
    },
    ...(opts.pickFiles ? { pickFiles: opts.pickFiles } : {}),
    ...(opts.clipboard ? { clipboard: opts.clipboard } : {}),
  })
  const handlerCtx: HandlerContext = { clientId: WEB_CLIENT_ID, host }

  /** without the host's `save` grant the frame is view-only: the deck is never changed */
  const viewOnly = (): boolean => ctx.capabilities.save === false

  /** a session handler with IPC semantics: cloned in, cloned out, rejections for throws */
  async function invoke(channel: SessionChannel, ...args: unknown[]): Promise<any> {
    if (viewOnly() && !READ_ONLY_CHANNELS.has(channel)) {
      return channel === 'slides:save' || channel === 'slides:save-as'
        ? { ok: false, error: text('webReadOnly') }
        : null
    }
    const handler = callSessionHandler as (
      c: SessionChannel,
      h: HandlerContext,
      ...a: unknown[]
    ) => unknown
    return clone(await handler(channel, handlerCtx, ...args.map(clone)))
  }

  const engine =
    (channel: SessionChannel) =>
    (...args: unknown[]): Promise<any> =>
      invoke(channel, ...args)

  // ------------------------------------------------------------ open

  function fatal(err: unknown, body: WebKey): void {
    state.fatal = toProtocolError(err).toShape()
    port.reportError(err, true)
    showFatal(body)
  }

  /**
   * bytes of an OpenPayload -> the client's session; null after a fatal notice. `withDraft`
   * (the init and host `open` documents) offers the stored draft first: Restore opens the draft
   * bytes as a recovered, dirty deck bound to the same file (the next save uses its etag).
   */
  async function openPayload(
    open: OpenPayload,
    fitWidthPx: number,
    withDraft = false,
  ): Promise<OpenResult | null> {
    let bytes = await readSource(open.source)
    // a new, still empty presentation file: start it as a blank deck bound to that file
    if (bytes.length === 0) bytes = await createBlankPptx()
    const cfb = cfbKind(bytes)
    if (cfb) {
      fatal(
        { code: 'unsupported', message: `${cfb} ppt container` },
        cfb === 'encrypted' ? 'webEncryptedPptx' : 'webLegacyPpt',
      )
      return null
    }
    const draft = withDraft ? await offerDraft(open.file) : null
    if (draft) bytes = draft
    state.remember(open.file)
    current = open.file.fileId
    revokeMedia()
    await loadBundledFonts()
    const { session, result } = await openSessionFromBytes(WEB_CLIENT_ID, {
      path: pathFor(open.file),
      bytes,
      fitWidthPx,
      ...(draft ? { recovered: true } : {}),
    })
    fontsRelaid = false
    await fontsPending
    state.fatal = null
    hideFatal()
    port.setTitle(open.file.name)
    port.setDirty(!!draft)
    // embedded faces registered while opening re-lay the text out with their real metrics
    return fontsRelaid ? openResultFor(session, fitWidthPx) : result
  }

  let booted = false
  let pendingOpen: Promise<OpenPayload | null> | null = port
    .whenInitialized()
    .then(async (s) => {
      userName = (s as { user?: { displayName?: string } }).user?.displayName || undefined
      initDocumentId = s.documentId
      return (
        s.open ??
        (await port.request('api.open', { fileId: s.documentId }, { timeoutMs: TIMEOUTS.transfer }))
      )
    })
    .catch((err: unknown) => {
      console.error('[slides-web] initial open failed:', err)
      fatal(
        err,
        toProtocolError(err).code === 'not_ready' && window.parent === window
          ? 'webNoHost'
          : 'webFatalBody',
      )
      return null
    })
  /** a host `open` that arrived before the renderer mounted */
  let queuedOpen: OpenPayload | null = null

  port.handleOpen(async (payload) => {
    if (!booted) {
      queuedOpen = payload
      return { opened: true, title: payload.file.name }
    }
    const result = await openPayload(payload, sessions.get(WEB_CLIENT_ID)?.fitWidthPx ?? 1280, true)
    if (!result) throw new Error('the document cannot be opened in the browser')
    openedEvents.emit(result)
    return { opened: true, title: payload.file.name }
  })

  port.onFileRenamed((file: FileMeta) => {
    const prev = state.files.get(file.fileId)
    if (!prev || prev.name === file.name) return
    state.remember(file)
    const path = pathFor(state.files.get(file.fileId)!)
    const session = sessions.get(WEB_CLIENT_ID)
    if (session && idFromPath(session.path) === file.fileId) session.path = path
    if (current === file.fileId) port.setTitle(file.name)
    renamedEvents.emit(path)
  })

  /** before another document replaces this one: unsaved edits need an explicit discard */
  async function mayReplace(): Promise<boolean> {
    if (!isDirty()) return true
    const choice = await ask({
      title: 'webDiscardTitle',
      body: 'webDiscardBody',
      choices: [
        { id: 'cancel', label: 'webCancel', primary: true },
        { id: 'discard', label: 'webDiscard', danger: true },
      ],
      cancelId: 'cancel',
      marker: 'discard',
    })
    return choice === 'discard'
  }

  // ------------------------------------------------------------ host save / saveAs / print / close

  async function runRendererSave(): Promise<boolean> {
    if (closeSaveEvents.size === 0) {
      const r = (await invoke('slides:save')) as { ok: boolean }
      return r.ok
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), 180_000)
      const finish = (ok: boolean): void => {
        clearTimeout(timer)
        saveWaiters.delete(finish)
        resolve(ok)
      }
      saveWaiters.add(finish)
      closeSaveEvents.emit()
    })
  }
  const saveWaiters = new Set<(ok: boolean) => void>()

  port.handleSave(async () => {
    if (state.fatal) return { ok: false, error: state.fatal }
    if (!current)
      return { ok: false, error: { code: 'not_ready' as const, message: 'no document is open' } }
    if (state.hostSaving)
      return { ok: false, error: { code: 'busy' as const, message: 'a save is already running' } }
    state.hostSaving = true
    lastSaveError = null
    state.lastFailure = null
    try {
      const ok = await runRendererSave()
      const file = current ? state.files.get(current) : undefined
      if (ok && file)
        return { ok: true, file, ...(file.versionId ? { versionId: file.versionId } : {}) }
      return {
        ok: false,
        error: lastSaveError ?? { code: 'internal' as const, message: 'save did not complete' },
      }
    } finally {
      state.hostSaving = false
    }
  })

  /** set while the host's `saveAs` request waits for the renderer's Save As */
  let hostSaveAs: { name?: string; settle: (ok: boolean) => void; started: () => void } | null =
    null
  let lastSaveError: ProtocolErrorShape | null = null

  port.handleSaveAs(async (payload) => {
    if (state.fatal) return { ok: false, error: state.fatal }
    if (hostSaveAs)
      return {
        ok: false,
        error: { code: 'busy' as const, message: 'a save-as is already running' },
      }
    return new Promise<SaveResult>((resolve) => {
      const timer = setTimeout(() => {
        hostSaveAs = null
        resolve({
          ok: false,
          error: { code: 'timeout' as const, message: 'the editor did not start Save As' },
        })
      }, editorStartMs)
      hostSaveAs = {
        ...(payload?.name ? { name: payload.name } : {}),
        started: () => clearTimeout(timer),
        settle: (ok) => {
          clearTimeout(timer)
          hostSaveAs = null
          const file = current ? state.files.get(current) : undefined
          resolve(
            ok && file
              ? { ok: true, file }
              : {
                  ok: false,
                  error: lastSaveError ?? {
                    code: 'cancelled' as const,
                    message: 'save as cancelled',
                  },
                },
          )
        },
      }
      state.hostSaving = true
      if (menuEvents.size === 0) {
        state.hostSaving = false
        hostSaveAs.settle(false)
        return
      }
      menuEvents.emit('save-as')
    })
  })

  let hostPrint: ((printed: boolean) => void) | null = null
  port.handlePrint(async () => {
    if (menuEvents.size === 0) return { printed: false }
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(false), 10 * 60_000)
      const settle = (printed: boolean): void => {
        clearTimeout(timer)
        hostPrint = null
        resolve({ printed })
      }
      hostPrint = settle
      menuEvents.emit('print')
    })
  })

  port.handleCloseCheck(() => ({ dirty: isDirty(), autoSave: false }))

  /** save / save-as results: remember the failure for the host request, keep the renderer shape */
  function noteResult(r: { ok: boolean; error?: string }): void {
    if (!r.ok && r.error)
      lastSaveError = state.lastFailure ?? { code: 'internal', message: r.error }
  }

  // ------------------------------------------------------------ menu accelerators

  /**
   * The desktop's File shortcuts are accelerators of the native application menu, which sends
   * `slides:menu` commands; the web has no such menu, so the frame maps the same keys onto
   * onMenuCommand (and keeps the browser's own Save page / Open file from firing). Print
   * (mod+P) and the edit keys are handled by the renderer itself.
   */
  function onAccelerator(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const key = e.key.toLowerCase()
    const command: MenuCommand | null =
      key === 's' ? (e.shiftKey ? 'save-as' : 'save') : key === 'o' && !e.shiftKey ? 'open' : null
    if (!command) return
    e.preventDefault()
    if (command === 'open' && ctx.capabilities.open !== true) return
    if (command === 'save' && ctx.capabilities.save === false) return
    if (command === 'save-as' && ctx.capabilities.saveAs === false) return
    if (state.fatal) return
    menuEvents.emit(command)
  }
  if (typeof window !== 'undefined') window.addEventListener('keydown', onAccelerator, true)

  // ------------------------------------------------------------ media

  const mediaUrls = new Map<string, string>()

  function revokeMedia(): void {
    for (const url of mediaUrls.values()) URL.revokeObjectURL(url)
    mediaUrls.clear()
  }

  /** an embedded media part as kind + mime + base64 (null: none, or external linked media) */
  async function mediaPart(slideIndex: number, sourceId: string) {
    const r = (await invoke('slides:media-data', slideIndex, sourceId)) as {
      kind: 'video' | 'audio'
      dataUrl: string
    } | null
    const m = r ? /^data:([^;,]*);base64,(.*)$/s.exec(r.dataUrl) : null
    return r && m ? { kind: r.kind, mime: m[1] || 'application/octet-stream', base64: m[2]! } : null
  }

  /** data: -> blob: (CSP media-src blob:); external linked media stay hidden (poster only) */
  async function mediaData(slideIndex: number, sourceId: string) {
    const part = await mediaPart(slideIndex, sourceId)
    if (!part) return null
    const key = `${slideIndex}|${sourceId}|${part.base64.length}`
    let url = mediaUrls.get(key)
    if (!url) {
      url = URL.createObjectURL(
        new Blob([base64ToBytes(part.base64) as Uint8Array<ArrayBuffer>], { type: part.mime }),
      )
      mediaUrls.set(key, url)
    }
    return { kind: part.kind, dataUrl: url }
  }

  // ------------------------------------------------------------ presenter view

  const presenterWindow = createPresenterWindow({
    open: opts.openWindow === undefined ? nativeOpen : opts.openWindow,
    screens: opts.screens,
    // read-only queries only (AUDIENCE_METHODS): the audience window renders, never edits
    source: {
      getRenderSlides: () => invoke('slides:get-render-slides'),
      getTransition: (i) => invoke('slides:get-transition', i),
      getAnimations: (i) => invoke('slides:get-animations', i),
      getShapeKeys: (i) => invoke('slides:get-shape-keys', i),
      getMediaBytes: async (i, sourceId) => {
        const part = await mediaPart(i, sourceId)
        if (!part) return null
        const bytes = base64ToBytes(part.base64)
        return { kind: part.kind, mime: part.mime, bytes: bytes.slice().buffer as ArrayBuffer }
      },
      getEmbeddedFonts: () => embeddedFontSources(),
      getLanguage: () => browser.getLanguage(),
    },
  })
  presenter = presenterWindow

  // ------------------------------------------------------------ clipboard

  const clip = (): (Pick<Clipboard, 'readText'> & Partial<Pick<Clipboard, 'read'>>) | null =>
    opts.clipboard ?? (typeof navigator !== 'undefined' ? (navigator.clipboard ?? null) : null)

  async function clipboardExternal(): ReturnType<SlidesApi['clipboardExternal']> {
    const c = clip()
    const text = c ? await c.readText().catch(() => null) : null
    const ours = (format: string, value?: string) =>
      host.clipboard.hasMarker(format, value) &&
      (text === null || text === SENTINEL_PREFIX + format)
    if (appClipboard.slide && ours(SLIDE_MARKER)) return { kind: 'slide' }
    if (appClipboard.elements && ours(ELEMENTS_MARKER, appClipboard.elements.token))
      return { kind: 'internal' }
    if (c?.read) {
      try {
        for (const item of await c.read()) {
          const type = item.types.find((t) => t.startsWith('image/'))
          if (!type) continue
          const blob = await item.getType(type)
          const png = type === 'image/png' ? blob : await toPng(blob)
          if (!png) continue
          return {
            kind: 'image',
            base64: bytesToBase64(new Uint8Array(await png.arrayBuffer())),
            ext: 'png',
          }
        }
      } catch {
        /* no permission / no image: fall through to text */
      }
    }
    if (text && text.trim() && !text.startsWith(SENTINEL_PREFIX)) return { kind: 'text', text }
    return { kind: 'none' }
  }

  async function toPng(blob: Blob): Promise<Blob | null> {
    try {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      bitmap.close()
      return await new Promise((r) => canvas.toBlob(r, 'image/png'))
    } catch {
      return null
    }
  }

  // ------------------------------------------------------------ the api

  const fullscreen = createFullscreenControl(() => text('webFullscreenHint'))
  const slidesApi: SlidesApi = {
    // appearance (host-authoritative, shared with Docs)
    getLanguage: () => browser.getLanguage() as ReturnType<SlidesApi['getLanguage']>,
    onLanguageChanged: (handler) =>
      browser.onLanguageChanged((lang) => handler(lang as Parameters<typeof handler>[0])),
    getTheme: () => browser.getTheme(),
    onThemeChanged: (handler) => browser.onThemeChanged(handler),
    getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
    onAutoSaveDefaultChanged: disposer,
    getAiPanelPrefs: () => aiStubs.getAiPanelPrefs() as Promise<AiPanelPrefs>,
    onAiPanelPrefsChanged: disposer,
    setAiPanelPrefs: () => aiStubs.getAiPanelPrefs() as Promise<AiPanelPrefs>,
    onChromePressed: disposer,

    // show: the Fullscreen API on the frame (the desktop snaps the native window)
    // a refused request (no user activation) shows a hint and goes full screen on the next click
    setShowFullScreen: (on) => (on ? fullscreen.enter() : fullscreen.leave()),

    // fonts: no catalog download / local install on the web (hidden); embedded faces are
    // registered by the bridge itself, so the renderer has no private faces to load
    privateFontFaces: async () => [],
    privateFontData: async () => null,
    fontCatalog: async () => [],
    fontDownload: async () => ({ ok: false, error: 'font download is not available on the web' }),
    fontInstallLocal: async () => ({ families: [] }),
    fontMissing: async () => [],
    onFontsChanged: disposer,

    // open / lifecycle
    openPptx: async (fitWidthPx) => {
      try {
        const res = await port.request(
          'file.pick',
          { purpose: 'open', accept: ['pptx'] },
          { timeoutMs: TIMEOUTS.dialog },
        )
        if (!res?.file || !(await mayReplace())) return null
        return await openPayload(res.file, fitWidthPx)
      } catch (err) {
        if (errorCode(err) !== 'cancelled') console.error('[slides-web] file.pick failed:', err)
        return null
      }
    },
    openPptxPath: async (path, fitWidthPx) => {
      const fileId = idFromPath(path)
      if (!fileId || !(await mayReplace())) return null
      try {
        const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.transfer })
        return await openPayload(open, fitWidthPx)
      } catch (err) {
        console.error('[slides-web] openPptxPath failed:', err)
        return null
      }
    },
    consumePendingOpen: async (fitWidthPx) => {
      booted = true
      const queued = queuedOpen
      queuedOpen = null
      const pending = pendingOpen
      pendingOpen = null
      const open = queued ?? (pending ? await pending : null)
      if (open) {
        try {
          return await openPayload(open, fitWidthPx, true)
        } catch (err) {
          console.error('[slides-web] opening the document failed:', err)
          fatal(err, 'webFatalBody')
          return null
        }
      }
      // remount (renderer reload) with a live session: restore it, as the desktop does
      const session = sessions.get(WEB_CLIENT_ID)
      if (session) {
        session.fitWidthPx = fitWidthPx
        return openResultFor(session, fitWidthPx)
      }
      return null
    },
    onOpened: (handler) => openedEvents.add(handler),
    onRenamed: (handler) => renamedEvents.add(handler),
    newBlank: engine('slides:new-blank'),
    save: async () => {
      const r = (await invoke('slides:save')) as { ok: boolean; error?: string }
      noteResult(r)
      return r as Awaited<ReturnType<SlidesApi['save']>>
    },
    // the frame is the UniWork document: no desktop working-copy state. A frame without the
    // host's `save` grant is read-only: the renderer then stays in Reading view (no text, cell or
    // notes editing surface), the same path as a view-only working copy on the desktop
    uniworkState: async () => ({ bound: false, readOnly: viewOnly() }),
    saveAs: async (defaultName) => {
      const pending = hostSaveAs
      pending?.started()
      const r = (await invoke('slides:save-as', pending?.name || defaultName)) as {
        ok: boolean
        error?: string
      }
      noteResult(r)
      if (pending) {
        state.hostSaving = false
        pending.settle(r.ok)
      }
      return r as Awaited<ReturnType<SlidesApi['saveAs']>>
    },
    onCloseSaveRequest: (handler) => closeSaveEvents.add(() => handler()),
    reportCloseSaveResult: (ok) => {
      for (const w of [...saveWaiters]) w(ok === true)
    },
    setAutoSavePref: noop,
    isDirty: engine('slides:is-dirty'),
    getRecentFiles: engine('slides:recent'),
    onMenuCommand: (handler) => menuEvents.add(handler),
    onHistoryChanged: (handler) => historyEvents.add(handler),
    onDeckChanged: (handler) => deckEvents.add(handler),
    consumeHeadlessExport: async () => null,
    headlessExportDone: noop,

    // engine: text, shapes, geometry
    editText: engine('slides:edit-text'),
    setElementFont: engine('slides:set-element-font'),
    setElementParagraphFormat: engine('slides:set-element-paragraph-format'),
    findReplace: engine('slides:find-replace'),
    setSlideLayout: engine('slides:set-slide-layout'),
    setSlideSize: engine('slides:set-slide-size'),
    getSlideSize: engine('slides:get-slide-size'),
    editTransform: engine('slides:edit-transform'),
    editConnectorEndpoints: engine('slides:edit-connector-endpoints'),
    batchEditTransform: engine('slides:batch-edit-transform'),
    getRenderSlides: engine('slides:get-render-slides'),
    editPictureSrcRect: engine('slides:edit-picture-src-rect'),
    editPictureOpacity: engine('slides:edit-picture-opacity'),
    editImageFill: engine('slides:edit-image-fill'),
    changeShape: engine('slides:change-shape'),
    setShapeAdjust: engine('slides:set-shape-adjust'),
    setTextAnchor: engine('slides:set-text-anchor'),
    setEffects: engine('slides:set-effects'),
    setTextBodyProps: engine('slides:set-text-body-props'),
    groupElements: engine('slides:group-elements'),
    ungroupElement: engine('slides:ungroup-element'),
    addElement: engine('slides:add-element'),
    deleteElement: engine('slides:delete-element'),
    reorderElement: engine('slides:reorder-element'),
    editFill: engine('slides:edit-fill'),
    editStroke: engine('slides:edit-stroke'),
    flipElements: engine('slides:flip-elements'),
    editBackground: engine('slides:edit-background'),

    // engine: slides, layouts, master view
    addSlide: engine('slides:add-slide'),
    addBlankSlide: engine('slides:add-blank-slide'),
    addSlideWithLayout: engine('slides:add-slide-with-layout'),
    getLayouts: engine('slides:get-layouts'),
    deleteSlide: engine('slides:delete-slide'),
    moveSlide: engine('slides:move-slide'),
    setSlideHidden: engine('slides:set-hidden'),
    masterEnter: engine('slides:master-enter'),
    masterOpen: engine('slides:master-open'),
    masterClose: engine('slides:master-close'),
    masterEditText: engine('slides:master-edit-text'),
    masterEditTransform: engine('slides:master-edit-transform'),
    masterEditFill: engine('slides:master-edit-fill'),
    masterEditStroke: engine('slides:master-edit-stroke'),
    masterDeleteElement: engine('slides:master-delete-element'),

    // engine: tables, charts, links, header/footer, themes
    editTableCell: engine('slides:edit-table-cell'),
    tableStructure: engine('slides:table-structure'),
    tableMerge: engine('slides:table-merge'),
    setTableColWidth: engine('slides:set-table-col-width'),
    setTableRowHeight: engine('slides:set-table-row-height'),
    setTableCellAnchor: engine('slides:set-table-cell-anchor'),
    editTableStyle: engine('slides:edit-table-style'),
    editChart: engine('slides:edit-chart'),
    getChartColorSchemes: engine('slides:chart-color-schemes'),
    getChartData: engine('slides:get-chart-data'),
    addTable: engine('slides:add-table'),
    addChart: engine('slides:add-chart'),
    addSmartArt: engine('slides:add-smartart'),
    addInk: engine('slides:add-ink'),
    setLink: engine('slides:set-link'),
    getLink: engine('slides:get-link'),
    getSlideLinks: engine('slides:get-slide-links'),
    getRunLinks: engine('slides:get-run-links'),
    applyHeaderFooter: engine('slides:apply-header-footer'),
    getHeaderFooter: engine('slides:get-header-footer'),
    applyTheme: engine('slides:apply-theme'),

    // engine: show data, sections, notes, comments, history, scripting
    setTransition: engine('slides:set-transition'),
    getTransition: engine('slides:get-transition'),
    setAdvanceTimes: engine('slides:set-advance-times'),
    getAnimations: engine('slides:get-animations'),
    getShapeKeys: engine('slides:get-shape-keys'),
    setAnimations: engine('slides:set-animations'),
    getSections: engine('slides:get-sections'),
    setSections: engine('slides:set-sections'),
    addSection: engine('slides:add-section'),
    renameSection: engine('slides:rename-section'),
    removeSection: engine('slides:remove-section'),
    moveSection: engine('slides:move-section'),
    getNotes: engine('slides:get-notes'),
    setNotes: engine('slides:set-notes'),
    getComments: engine('slides:get-comments'),
    addComment: engine('slides:add-comment'),
    deleteComment: engine('slides:delete-comment'),
    beginHistoryBatch: engine('slides:history-batch-begin'),
    endHistoryBatch: engine('slides:history-batch-end'),
    applyEditScript: engine('slides:apply-edit-script'),
    applyTxn: engine('slides:apply-txn'),
    aiSnapshotRestore: engine('slides:ai-snapshot-restore'),
    undo: engine('slides:undo'),
    redo: engine('slides:redo'),

    // pictures, media, clipboard
    pickPictureFile: engine('slides:pick-picture-file'),
    insertImage: engine('slides:insert-image'),
    addImageBytes: engine('slides:add-image-bytes'),
    replacePictureBytes: engine('slides:replace-picture-bytes'),
    insertMedia: engine('slides:insert-media'),
    addMediaBytes: engine('slides:add-media-bytes'),
    getMediaData: mediaData,
    insertModel3d: engine('slides:insert-model3d'),
    copySlides: engine('slides:copy-slides'),
    pasteSlide: engine('slides:paste-slide'),
    repasteSlide: engine('slides:repaste-slide'),
    hasSlideClipboard: engine('slides:has-slide-clipboard'),
    copyElements: engine('slides:copy-elements'),
    // the desktop adds a picture of the copied elements for other apps; the frame keeps the
    // text sentinel on the system clipboard only (an image write would replace it)
    copyElementsImage: async () => false,
    editTransformMulti: engine('slides:edit-transform-multi'),
    setShapeGeometry: engine('slides:set-shape-geometry'),
    deleteElements: engine('slides:delete-elements'),
    deleteSlides: engine('slides:delete-slides'),
    duplicateSlides: engine('slides:duplicate-slides'),
    setSlidesHidden: engine('slides:set-slides-hidden'),
    removeSectionSlides: engine('slides:remove-section-slides'),
    moveSlides: engine('slides:move-slides'),
    pasteElements: engine('slides:paste-elements'),
    duplicateElements: engine('slides:duplicate-elements'),
    clipboardExternal,
    // reading the clipboard needs a gesture + permission: answer optimistically
    // (clipboardExternal then reports {kind:'none'} when there is nothing)
    clipboardProbe: async () => true,
    nativeClipboard: async (op) => {
      if (op !== 'paste') {
        document.execCommand(op)
        return
      }
      const text = await clip()
        ?.readText()
        .catch(() => '')
      if (text) document.execCommand('insertText', false, text)
    },

    // export / print: in-frame downloads and printing (no directory or path on the web)
    pickExportDir: async () => 'web-download',
    savePicture: async (op: SavePictureOp): Promise<SavePictureResult> => {
      const name = withExt(safeFileName(op.defaultName, 'picture'), '.png')
      download(
        name,
        new Blob([base64ToBytes(op.pngBase64) as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
      )
      return { ok: true, path: name }
    },
    exportImages: async (op: ExportImagesOp): Promise<ExportImagesResult> => {
      try {
        const name = safeFileName(`${op.baseName}-images.zip`, 'slides-images.zip')
        const zip = await zipImages(op.baseName, op.pngsBase64)
        download(name, new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
        return { ok: true, paths: [name] }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
    pickExportPdfPath: async (defaultName) => withExt(safeFileName(defaultName, 'slides'), '.pdf'),
    exportPdf: async (op: ExportPdfOp): Promise<ExportPdfResult> => {
      try {
        const name = withExt(
          safeFileName(op.filePath.split(/[\\/]/).pop() || 'slides', 'slides'),
          '.pdf',
        )
        const pdf = await slidesPdf({
          pngsBase64: await exportPagesToPngs(op),
          widthPx: op.widthPx,
          heightPx: op.heightPx,
        })
        download(name, new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }))
        return { ok: true, path: name }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
    printSlides: async (op: PrintSlidesOp) => {
      const r = await (opts.print ?? printHtml)(printDocument(op))
      hostPrint?.(r.ok)
      return r
    },

    // AI: hidden on the web (capability `ai` false); same shapes as the Docs stubs
    getAiSettings: () => aiStubs.getAiSettings() as ReturnType<SlidesApi['getAiSettings']>,
    setAiSettings: async () => {},
    aiStream: async (request) => {
      await aiStubs.aiStream(request as Parameters<typeof aiStubs.aiStream>[0])
    },
    aiStreamCancel: async () => {},
    onAiStream: (handler) =>
      aiStubs.onAiStream(handler as Parameters<typeof aiStubs.onAiStream>[0]),
    aiGskStatus: async () => ({ loggedIn: false }),
    aiLogRunFailure: async () => {},
    onAiSettingsChanged: disposer,
    openAiModelSettings: async () => {},
    webSearch: async () => ({
      results: [],
      method: 'none',
      error: aiUnavailableMessage('web search'),
    }),
    imageSearch: async () => ({
      images: [],
      method: 'none',
      error: aiUnavailableMessage('image search'),
    }),
    insertImageUrl: async () => null,
    replacePictureUrl: async () => null,
    generateImage: async () => ({ error: aiUnavailableMessage('image generation') }),
    analyzeMedia: async () => ({ error: aiUnavailableMessage('media analysis') }),
    cloudGenStatus: async () => ({ enabled: false }),
    cloudPageCancel: async () => {},
    cloudGeneratePage: async () => ({ ok: false, error: aiUnavailableMessage('slide generation') }),
    localGeneratePage: async () => ({ ok: false, error: aiUnavailableMessage('slide generation') }),
    landGeneratedPages: async () => ({ error: aiUnavailableMessage('slide generation') }),
    consumeAiPreset: async () => null,
    onAiPreset: disposer,
    saveStyleSidecar: async () => ({ ok: false }),
    saveStyleTemplate: async () => ({ ok: false, error: aiUnavailableMessage('style templates') }),
    listStyleTemplates: async () => [],
    loadStyleTemplate: async () => ({ ok: false, error: aiUnavailableMessage('style templates') }),

    // presenter view: the audience window it opens (CONTRACT C15(2)); the audience* / onShow*
    // members belong to the audience window's own bridge (./audience-bridge.ts)
    ...presenterWindow.api,
    audienceReady: async () => null,
    audienceNav: noop,
    onShowSync: disposer,
    onShowInk: disposer,
  }

  return {
    slidesApi,
    /** for tests and the e2e driver */
    state,
    host,
    isDirty,
    revokeMedia,
    presenter: presenterWindow,
    drafts,
  }
}

export type WebSlides = ReturnType<typeof createWebSlidesApi>
export { WebSaveError }
