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
 * | hidden (stubs)   | AI (27), fonts download/install, presenter second screen, headless export, autosave (C10) |
 *
 * Typed as the full SlidesApi (no Partial): a new preload method is a build error here.
 */
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
import { TIMEOUTS, errorCode } from '../../docs/bridge/frame-port'
import type { ModuleBridgePort } from '../../docs/bridge/module-bridge'
import { idFromPath, pathFor } from '../../docs/bridge/webapi'
import { ask, hideFatal, showFatal, type WebKey } from './dialogs'
import { printDocument, printHtml, slidesPdf, zipImages } from './exports'
import { createWebFontMetrics, loadBundledFonts, registerEmbeddedFonts } from './fonts'
import { tiffToPng } from './tiff'
import { createDocState, createWebHostIO, SENTINEL_PREFIX, WebSaveError } from './web-host-io'

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
  let fontsPending: Promise<void> = Promise.resolve()
  let fontsRelaid = false

  configureSessionPlatform({
    createFontMetrics: () => createWebFontMetrics(),
    decodeTiff: tiffToPng,
    defer: (fn) => void setTimeout(fn, 0),
    events: {
      historyChanged: (ids, s) => {
        if (!ids.includes(WEB_CLIENT_ID)) return
        historyEvents.emit({ ...s })
        pushDirty()
      },
      deckChanged: (ids, payload) => {
        if (ids.includes(WEB_CLIENT_ID)) deckEvents.emit(payload)
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

  function isDirty(): boolean {
    const s = sessions.get(WEB_CLIENT_ID)
    return !!s && sessionDirty(s)
  }

  function pushDirty(): void {
    port.setDirty(isDirty())
  }

  let current: string | null = null

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
      const path = pathFor(file)
      port.setTitle(file.name)
      setTimeout(pushDirty, 0)
      if (kind === 'saveAs' || path !== previousPath) renamedEvents.emit(path)
    },
    ...(opts.pickFiles ? { pickFiles: opts.pickFiles } : {}),
    ...(opts.clipboard ? { clipboard: opts.clipboard } : {}),
  })
  const handlerCtx: HandlerContext = { clientId: WEB_CLIENT_ID, host }

  /** a session handler with IPC semantics: cloned in, cloned out, rejections for throws */
  async function invoke(channel: SessionChannel, ...args: unknown[]): Promise<any> {
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

  /** bytes of an OpenPayload -> the client's session; null after a fatal notice */
  async function openPayload(open: OpenPayload, fitWidthPx: number): Promise<OpenResult | null> {
    const bytes = await readSource(open.source)
    const cfb = cfbKind(bytes)
    if (cfb) {
      fatal(
        { code: 'unsupported', message: `${cfb} ppt container` },
        cfb === 'encrypted' ? 'webEncryptedPptx' : 'webLegacyPpt',
      )
      return null
    }
    state.remember(open.file)
    current = open.file.fileId
    revokeMedia()
    await loadBundledFonts()
    const { session, result } = await openSessionFromBytes(WEB_CLIENT_ID, {
      path: pathFor(open.file),
      bytes,
      fitWidthPx,
    })
    fontsRelaid = false
    await fontsPending
    state.fatal = null
    hideFatal()
    port.setTitle(open.file.name)
    port.setDirty(false)
    // embedded faces registered while opening re-lay the text out with their real metrics
    return fontsRelaid ? openResultFor(session, fitWidthPx) : result
  }

  let booted = false
  let pendingOpen: Promise<OpenPayload | null> | null = port
    .whenInitialized()
    .then(async (s) => {
      userName = (s as { user?: { displayName?: string } }).user?.displayName || undefined
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
    const result = await openPayload(payload, sessions.get(WEB_CLIENT_ID)?.fitWidthPx ?? 1280)
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
        { id: 'discard', label: 'webDiscard' },
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

  // ------------------------------------------------------------ media

  const mediaUrls = new Map<string, string>()

  function revokeMedia(): void {
    for (const url of mediaUrls.values()) URL.revokeObjectURL(url)
    mediaUrls.clear()
  }

  /** data: -> blob: (CSP media-src blob:); external linked media stay hidden (poster only) */
  async function mediaData(slideIndex: number, sourceId: string) {
    const r = (await invoke('slides:media-data', slideIndex, sourceId)) as {
      kind: 'video' | 'audio'
      dataUrl: string
    } | null
    if (!r) return null
    const m = /^data:([^;,]*);base64,(.*)$/s.exec(r.dataUrl)
    if (!m) return null
    const key = `${slideIndex}|${sourceId}|${m[2]!.length}`
    let url = mediaUrls.get(key)
    if (!url) {
      url = URL.createObjectURL(
        new Blob([base64ToBytes(m[2]!) as Uint8Array<ArrayBuffer>], {
          type: m[1] || 'application/octet-stream',
        }),
      )
      mediaUrls.set(key, url)
    }
    return { kind: r.kind, dataUrl: url }
  }

  // ------------------------------------------------------------ clipboard

  const clip = (): (Pick<Clipboard, 'readText'> & Partial<Pick<Clipboard, 'read'>>) | null =>
    opts.clipboard ?? (typeof navigator !== 'undefined' ? (navigator.clipboard ?? null) : null)

  async function clipboardExternal(): ReturnType<SlidesApi['clipboardExternal']> {
    const c = clip()
    const text = c ? await c.readText().catch(() => null) : null
    const ours = (format: string) =>
      host.clipboard.hasMarker(format) && (text === null || text === SENTINEL_PREFIX + format)
    if (appClipboard.slide && ours(SLIDE_MARKER)) return { kind: 'slide' }
    if (appClipboard.elements && ours(ELEMENTS_MARKER)) return { kind: 'internal' }
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
    onChromePressed: disposer,

    // show: the Fullscreen API on the frame (the desktop snaps the native window)
    setShowFullScreen: async (on) => {
      try {
        if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen()
        else if (!on && document.fullscreenElement) await document.exitFullscreen()
      } catch {
        /* no user activation / not allowed: the show stays in the frame */
      }
    },

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
          return await openPayload(open, fitWidthPx)
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
    copySlide: engine('slides:copy-slide'),
    pasteSlide: engine('slides:paste-slide'),
    repasteSlide: engine('slides:repaste-slide'),
    hasSlideClipboard: engine('slides:has-slide-clipboard'),
    copyElements: engine('slides:copy-elements'),
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
        const pdf = await slidesPdf(op)
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
    aiGskLogin: async () => {},
    aiLogRunFailure: async () => {},
    gskStatus: async () => ({ available: false }),
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
    cloudGeneratePage: async () => ({ ok: false, error: aiUnavailableMessage('slide generation') }),
    localGeneratePage: async () => ({ ok: false, error: aiUnavailableMessage('slide generation') }),
    landGeneratedPages: async () => ({ error: aiUnavailableMessage('slide generation') }),
    consumeAiPreset: async () => null,
    onAiPreset: disposer,
    saveStyleSidecar: async () => ({ ok: false }),
    saveStyleTemplate: async () => ({ ok: false, error: aiUnavailableMessage('style templates') }),
    listStyleTemplates: async () => [],
    loadStyleTemplate: async () => ({ ok: false, error: aiUnavailableMessage('style templates') }),

    // presenter: single screen in the frame (B5 decision 4); no audience window
    presenterStart: async () => ({ audience: false }),
    presenterSync: noop,
    presenterInk: noop,
    presenterSwap: async () => false,
    presenterEnd: async () => {},
    audienceReady: async () => null,
    audienceNav: noop,
    onShowSync: disposer,
    onShowInk: disposer,
    onAudienceNav: disposer,
  }

  return {
    slidesApi,
    /** for tests and the e2e driver */
    state,
    host,
    isDirty,
    revokeMedia,
  }
}

export type WebSlides = ReturnType<typeof createWebSlidesApi>
export { WebSaveError }
