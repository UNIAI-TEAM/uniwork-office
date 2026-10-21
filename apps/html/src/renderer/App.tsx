import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Dropdown,
  FindPanel,
  stepFindMatch,
  type FindFocusRequest,
  type AiScopeQuoteData,
  useAutoSavePref,
  type FindPanelStrings,
  type FindTarget,
  aiPanelInitiallyOpen,
  rememberAiPanelOpen,
  UniAiMark,
  useAiSidebarEnabled,
} from '@genoffice/ui'
import {
  pollUntilReady,
  runHeadlessRendererExport,
} from '@genoffice/electron-utils/headless-export'
import { useI18n } from './i18n/locale'
import { cap, platform } from './capabilities'
import {
  createHtmlFrameKeyReplay,
  hostHasUserActivation,
  htmlAria,
  htmlFrameKeyClaims,
  htmlWindowCommand,
  type HtmlShortcutCommand,
} from './shortcuts'
import { LinkPopover } from './components/LinkPopover'
import { uniworkBoundForAi } from '@genoffice/ui/capabilities'
import { keyHintAfterName } from '@genoffice/shortcuts'
import { useNarrowFrame } from './narrow-frame'
import { parseDocText, serializeDocText, type Envelope } from './document/envelope'
import { textWithPendingStyles } from './document/pending-draft'
import {
  SourceEditor,
  type CursorInfo,
  type SourceRange,
  type SourceEditorHandle,
} from './source/SourceEditor'
import { PreviewFrame, type PreviewFrameHandle } from './preview/PreviewFrame'
import { PreviewLimitNote } from './preview/PreviewLimitNote'
import { usesBlockedPreviewFeatures } from './preview/preview-limits'
import { instrumentForPreview } from './preview/instrument'
import type { ComputedSnapshot, ElementRect, FromInspector } from './preview/inspector-protocol'
import inspectorSource from './preview/inspector.js?raw'
import { AiPanel, type AiPreset, type HtmlAiDeps } from './ai/AiPanel'
import { AiAskPopover, type AnchorRect, type AskMode } from './components/AiAskPopover'
import {
  EDIT_QUEUE_MAX,
  buildSelectionInstruction,
  resolveQueueItem,
  type EditQueueItem,
} from './ai/edit-queue'
import { buildProjection } from './ai/redact'
import { Breadcrumb, type NodeState } from './components/Breadcrumb'
import {
  Ribbon,
  type PresentKind,
  VIEW_MODES,
  type CanvasMode,
  type ViewMode,
} from './components/Ribbon'
import { CropDialog, CutoutDialog, type ImageDialogLabels } from '@genoffice/ui'
import { FloatToolbar } from './components/FloatToolbar'
import { RedactDialog } from './components/RedactDialog'
import { redactClearPlan, redactMarkPlan, type RedactPlan } from './document/redact-edit'
import {
  insertOp,
  insertPresetHtml,
  type InsertOptions,
  TEXT_INSERT_KINDS,
  type InsertKind,
} from './document/insert-presets'
import { isDocEmpty } from './document/blank'
import { documentSkeleton } from './document/skeleton'
import { moveTarget } from './document/move-target'
import { StylePanel } from './components/StylePanel'
import { PANEL_RESERVE, floatPosition, parseDeclarations } from './document/float-position'
import {
  buildParseMap,
  childrenOf,
  elementCovering,
  sourceText,
  type ParseMap,
} from './document/parse-map'
import { compileOps, type HtmlOp, type OpError } from './document/ops'
import { injectBrief, parseBrief, type Brief } from './document/brief'
import { applyPatches } from './document/patch'
import { adoptImageRewrites } from './document/image-rewrites'
import { deriveDocumentName } from './document/auto-name'
import { runGuardedPrint } from './print-guard'
import type { ExportFormat, SaveMode, UniworkViewState } from '../shared/ipc'

type LoadStatus = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'
interface HtmlUniworkLockSeam {
  onUniworkStateChanged?(cb: (path: string) => void): () => void
  uniworkReadOnlySave?(path?: string): Promise<void>
}

interface TextSel {
  sid: number
  textNodeIndex: number
  start: number
  end: number
}

const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
const inTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('.cm-editor, input, textarea, [contenteditable=""], [contenteditable="true"]')
const PREVIEW_DEBOUNCE_MS = 150
/** the inline element each formatting command wraps a preview text selection in */
const WRAP_TAG = { bold: 'strong', italic: 'em', underline: 'u' } as const satisfies Partial<
  Record<HtmlShortcutCommand, string>
>

/** the shortcuts a frame in view mode may still relay on a read-only copy */
const READ_ONLY_FRAME_KEYS = new Set(['print', 'zoomIn', 'zoomOut', 'zoomReset', 'escape'])
const DEFAULT_ENVELOPE: Envelope = { bom: false, eol: '\n', trailingNewline: true }
/** live style pokes are written to the source as one set_style op this long after the last change */
const STYLE_COMMIT_MS = 600
type Device = 'desktop' | 'tablet' | 'mobile'
const DEVICES: Device[] = ['desktop', 'tablet', 'mobile']
/** document scaffolding: selectable in the source, never a target for element ops */
const STRUCTURAL = new Set(['html', 'head', 'body'])
const IS_MAC = /Mac/i.test(navigator.platform)

function readViewMode(): ViewMode {
  const stored = localStorage.getItem('htmlapp.viewMode')
  return VIEW_MODES.includes(stored as ViewMode) ? (stored as ViewMode) : 'preview'
}

function isDarkTheme(): boolean {
  const explicit = document.documentElement.getAttribute('data-theme')
  if (explicit === 'dark') return true
  if (explicit === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** picture bytes as a data URL: inline data, a remote URL through the main-process fetcher, or a file next to the document */
async function loadImageDataUrl(src: string): Promise<string | null> {
  if (/^data:image\//i.test(src)) return src
  if (/^https?:/i.test(src)) {
    const r = await window.htmlApi.fetchImage(src)
    return r ? `data:${r.mime};base64,${r.base64}` : null
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null
  const r = await window.htmlApi.readImage(src)
  return r ? `data:${r.mime};base64,${r.base64}` : null
}

export default function App() {
  const { lang, t } = useI18n()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [path, setPath] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [view, setView] = useState<ViewMode>(readViewMode)
  const [canvasMode, setCanvasModeState] = useState<CanvasMode>('edit')
  /** Present → Fullscreen: the presenting view also takes the whole screen */
  const [presentFull, setPresentFull] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [autoSave, setAutoSave] = useAutoSavePref('htmlapp.autoSave', window.htmlApi)
  // a UniWork copy never autosaves; a view-only one refuses every edit
  const [uniwork, setUniwork] = useState<UniworkViewState>({ bound: false, readOnly: false })
  // the path whose UniWork answer has arrived. The preview frame waits for it, so a source view
  // never loads (and runs) the page in a scripts-on sandbox first. Derived from the path, not a
  // flag reset in an effect: a flag would still read "known" in the very commit that sets the
  // path, so the frame would load the real document, drop back to about:blank and load it again.
  const [uniworkAnsweredPath, setUniworkAnsweredPath] = useState<string | null>(null)
  const uniworkRef = useRef(uniwork)
  uniworkRef.current = uniwork
  const [findTarget, setFindTarget] = useState<FindTarget | null>(null)
  const [findFocus, setFindFocus] = useState<FindFocusRequest>({ field: 'find', nonce: 0 })
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, col: 1, pos: 0 })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [draftHtml, setDraftHtml] = useState<string | null>(null)
  const [historyState, setHistoryState] = useState({ undo: false, redo: false })
  const [aiOpen, setAiOpen] = useState(() => aiPanelInitiallyOpen('htmlapp.showAi'))
  // the sidebar switch is a soft hide; it closes the panel when it turns off
  const aiSidebarEnabled = useAiSidebarEnabled(setAiOpen)
  const [aiPreset, setAiPreset] = useState<AiPreset | null>(null)
  const [editQueue, setEditQueue] = useState<EditQueueItem[]>([])
  const [askMode, setAskMode] = useState<AskMode | null>(null)
  const [selectedSid, setSelectedSid] = useState<number | null>(null)
  const [selectedState, setSelectedState] = useState<NodeState>('static')
  const [textSel, setTextSel] = useState<TextSel | null>(null)
  const wrapSelectionRef = useRef<(tag: string) => void>(() => {})
  const openLinkRef = useRef<() => void>(() => {})
  const [linkSel, setLinkSel] = useState<TextSel | null>(null)
  const moveSelectedRef = useRef<(dir: -1 | 1) => void>(() => {})
  // selected element as the preview sees it: drives the floating toolbar and the style panel
  const [selRect, setSelRect] = useState<ElementRect | null>(null)
  const [selComputed, setSelComputed] = useState<ComputedSnapshot | null>(null)
  const [selText, setSelText] = useState<{
    run: string | null
    index: number
    /** the element edits inline (single run or rich phrasing content) */
    editable: boolean
  }>({
    run: null,
    index: -1,
    editable: false,
  })
  const [pendingCount, setPendingCount] = useState(0)
  const [barSize, setBarSize] = useState({ w: 440, h: 32 })
  const [stageTick, setStageTick] = useState(0)
  const [device, setDevice] = useState<Device>(() => {
    const stored = localStorage.getItem('htmlapp.device')
    return DEVICES.includes(stored as Device) ? (stored as Device) : 'desktop'
  })
  /** a phone-width frame: the style panel is a bottom sheet and the floating toolbar steps aside */
  const narrow = useNarrowFrame()
  // open by default, except in a narrow frame (a sheet over the preview the moment something is
  // selected hides the selection); an explicit choice made at any width is kept
  const [panelOpen, setPanelOpen] = useState(() => {
    const stored = localStorage.getItem('htmlapp.stylePanel')
    return stored === null ? !narrow : stored !== '0'
  })
  const [panelDismissedSid, setPanelDismissedSid] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** a resize / reorder drag is in progress inside the frame: the floating chrome would only get in the way */
  const [dragging, setDragging] = useState(false)
  /** freshly inserted text element: opens for typing once the reloaded frame reports ready */
  const editAfterLoadRef = useRef<number | null>(null)
  const insertedSidRef = useRef<number | null>(null)
  const previewStyleRef = useRef<(styles: Record<string, string | null>) => void>(() => {})
  // a release over the host chrome (or a window switch) never reaches the frame's listeners
  useEffect(() => {
    if (!dragging) return
    const end = () => previewRef.current?.post({ type: 'gx:endDrag' })
    window.addEventListener('mouseup', end, true)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('mouseup', end, true)
      window.removeEventListener('blur', end)
    }
  }, [dragging])
  const [pictureDialog, setPictureDialog] = useState<{
    kind: 'crop' | 'cutout'
    sid: number
    /** authored src at open time: the result only lands on an <img> that still carries it */
    src: string
    image: string
  } | null>(null)
  /** the range awaiting a label, with the selection text it was opened on */
  const [redactDialog, setRedactDialog] = useState<(SourceRange & { seed: string }) | null>(null)

  const editorRef = useRef<SourceEditorHandle>(null)
  const previewRef = useRef<PreviewFrameHandle>(null)
  const envelopeRef = useRef<Envelope>(DEFAULT_ENVELOPE)
  const textRef = useRef('')
  const savedTextRef = useRef('')
  const savingRef = useRef(false)
  const statusRef = useRef<LoadStatus>('loading')
  const pushedTextRef = useRef<string | null>(null)
  const previewTimerRef = useRef<number | null>(null)
  /** parse-map version of the copy currently served to the preview; messages from older copies are ignored */
  const pushedVersionRef = useRef(-1)
  /** versions whose sids the running frame still describes: the loaded copy plus every in-place commit since
   * (style / text edits the frame already showed; they leave the element structure, and so the sids, alone) */
  const frameVersionsRef = useRef<Set<number>>(new Set())
  /** window scroll of the running frame, restored after an edit reloads it */
  const frameScrollRef = useRef<number | null>(null)
  /** bumped on every text change; AI staleness checks compare against lastManualVersionRef */
  const versionRef = useRef(0)
  const lastManualVersionRef = useRef(0)
  const mapRef = useRef<ParseMap | null>(null)
  const mapSourceRef = useRef('')
  const pathRef = useRef<string | null>(null)
  const selectedSidRef = useRef<number | null>(null)
  const editQueueRef = useRef<EditQueueItem[]>([])
  const canvasModeRef = useRef<CanvasMode>('edit')
  const queueSeqRef = useRef(0)
  /** brief confirmed on the AI card; pinned into the head of the next generated document */
  const briefRef = useRef<Brief | null>(null)
  /** name of an untitled document taken from its own page title or first heading after an AI run: tab title now, file name at the first save */
  const provisionalNameRef = useRef<string | null>(null)
  const pendingStylesRef = useRef<Record<string, string | null>>({})
  const styleTimerRef = useRef<number | null>(null)
  const flushingStylesRef = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  pathRef.current = path
  textRef.current = text
  editQueueRef.current = editQueue
  canvasModeRef.current = canvasMode
  savedTextRef.current = savedText
  statusRef.current = status
  selectedSidRef.current = selectedSid
  const dirty = text !== savedText
  // web frame (capabilities.ts): AI, autosave and visual edit off, view only without `save`
  const aiEnabled = cap('ai')
  const canEdit = cap('save')
  // both previews (the web bundle's preview.html and the desktop html-preview:// document) block
  // fetch/XHR and nested frames, so a page using them gets one note
  const previewLimited = useMemo(() => usesBlockedPreviewFeatures(text), [text])
  // a view-only UniWork copy has no element editing: no selection chrome, toolbar or style panel
  const visualEdit = cap('htmlVisualEdit') && !uniwork.readOnly
  // a view-only copy (shared view-only or a source view) never runs the page's own scripts
  const previewScriptsOff = uniwork.readOnly
  // an untitled document has no UniWork binding to wait for
  const uniworkKnown = path === null || uniworkAnsweredPath === path

  const getMap = useCallback((): ParseMap => {
    const cached = mapRef.current
    // the initial load swaps the text without bumping the version, so the source itself is part of the key
    if (cached && cached.version === versionRef.current && mapSourceRef.current === textRef.current)
      return cached
    const next = buildParseMap(textRef.current, versionRef.current, cached)
    mapRef.current = next
    mapSourceRef.current = textRef.current
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [pending, info] = await Promise.all([
          window.htmlApi.consumePending(),
          window.htmlApi.getPreviewInfo(),
        ])
        const raw = pending ? await window.htmlApi.readFile(pending) : ''
        if (cancelled) return
        const doc = parseDocText(raw)
        envelopeRef.current = doc.envelope
        textRef.current = doc.text
        // the frame must never race the first push: serve the buffer before the URL is known to React
        const map0 = getMap()
        window.htmlApi.updatePreview(instrumentForPreview(doc.text, map0, inspectorSource))
        pushedTextRef.current = doc.text
        pushedVersionRef.current = map0.version
        frameVersionsRef.current = new Set([map0.version])
        frameScrollRef.current = null
        setPath(pending)
        setText(doc.text)
        // web: a restored draft opens dirty; its saved twin is the server text it replaced
        const recoveredBase = pending ? (window.htmlApi.consumeRecovered?.() ?? null) : null
        setSavedText(recoveredBase === null ? doc.text : parseDocText(recoveredBase).text)
        setPreviewUrl(info.url)
        setStatus('ready')
        // LAG-F1 (web frame): the document is mounted; the lag detector's settle stamp starts now
        if (pending) window.htmlApi.noteDocumentMounted?.()
      } catch (err) {
        console.error('[html] open failed:', err)
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [getMap])

  // web bridge: the text a save would write now, read by the draft writer without saving.
  // Live style edits not yet committed (inspector / style panel) are applied to the copy only:
  // committing them here would mutate the editor under the user's hands (see pending-draft.ts)
  const draftTextRef = useRef<() => string | null>(() => null)
  draftTextRef.current = () => {
    if (statusRef.current !== 'ready') return null
    // an open panel field lands in the pending styles first, exactly like leaving the field
    flushDraftsRef.current?.()
    const text = textWithPendingStyles(
      textRef.current,
      getMap(),
      selectedSidRef.current,
      pendingStylesRef.current,
    )
    return serializeDocText({ text, envelope: envelopeRef.current })
  }
  useEffect(() => window.htmlApi.provideText?.(() => draftTextRef.current()), [])

  // mirror dirtiness to the main process (close prompt) — untitled blank docs never count. `text`
  // is a dependency on purpose: every edit re-reports, because a web host that last saw a failed
  // save needs the next edit to move its header from "could not be confirmed" back to unsaved
  // (the frame client dedupes an unchanged flag, text-webapi sends the first one after a failure)
  useEffect(() => {
    if (status !== 'ready') return
    window.htmlApi.setDirty(canEdit && (dirty || pendingCount > 0))
  }, [dirty, pendingCount, status, canEdit, text])

  /**
   * Serve the current source to html-preview://. `reload` = false for a commit the frame already
   * displays (a style poke or an inline text edit it made itself): the buffer is refreshed so the
   * next real reload and exports see it, but the running frame stays, without the flash and the
   * scroll jump of a reload, and keeps talking under its own (older) version.
   */
  const pushPreview = useCallback(
    (nextText: string, reload = true) => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
      if (pushedTextRef.current === nextText) return
      const map = getMap()
      window.htmlApi.updatePreview(instrumentForPreview(nextText, map, inspectorSource))
      pushedTextRef.current = nextText
      pushedVersionRef.current = map.version
      if (reload) {
        frameVersionsRef.current = new Set([map.version])
        setPreviewNonce((n) => n + 1)
      } else frameVersionsRef.current.add(map.version)
    },
    [getMap],
  )
  // push the instrumented buffer to html-preview:// and reload the frame, debounced per keystroke
  useEffect(() => {
    if (status !== 'ready' || pushedTextRef.current === text) return
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      pushPreview(text)
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [text, status, pushPreview])

  useEffect(() => {
    localStorage.setItem('htmlapp.viewMode', view)
  }, [view])
  const frameMode = (mode: CanvasMode) =>
    mode !== 'edit' ? 'browse' : uniworkRef.current.readOnly ? 'view' : 'inspect'
  const prevCanvasModeRef = useRef(canvasMode)
  useEffect(() => {
    // a presentation lets links navigate the frame; coming back reloads the instrumented document
    if (prevCanvasModeRef.current === 'present' && canvasMode !== 'present')
      setPreviewNonce((n) => n + 1)
    prevCanvasModeRef.current = canvasMode
    // the lock ping flips readOnly while the frame stays loaded, so it re-posts the mode too
    previewRef.current?.post({ type: 'gx:setMode', mode: frameMode(canvasMode) })
  }, [canvasMode, uniwork.readOnly])

  useEffect(() => {
    rememberAiPanelOpen('htmlapp.showAi', aiOpen)
  }, [aiOpen])

  useEffect(() => {
    localStorage.setItem('htmlapp.device', device)
  }, [device])

  // the sheet at phone width is not a choice about the desktop layout: only a wide frame remembers it
  useEffect(() => {
    if (!narrow) localStorage.setItem('htmlapp.stylePanel', panelOpen ? '1' : '0')
  }, [panelOpen, narrow])

  // the device host is centred in the stage: any stage resize (split view, AI dock, device) moves it
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || status !== 'ready') return
    const ro = new ResizeObserver(() => setStageTick((n) => n + 1))
    ro.observe(stage)
    return () => ro.disconnect()
  }, [status])

  // The bar wraps to the room beside the style panel, so its box changes whenever the stage or the
  // panel does (split view, AI dock, panel open/close) - not only when the selection moves. Measure
  // on those too, or a height taken at an intermediate width keeps placing the bar over the page.
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width && (r.width !== barSize.w || r.height !== barSize.h))
      setBarSize({ w: r.width, h: r.height })
  }, [selRect, selText.run, barSize.w, barSize.h, stageTick, panelOpen, panelDismissedSid])

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(id)
  }, [notice])

  const refreshHistory = useCallback(() => {
    const editor = editorRef.current
    if (editor) setHistoryState({ undo: editor.canUndo(), redo: editor.canRedo() })
  }, [])

  /** every text change goes through here so the version counter and the map cache stay coherent */
  const commitText = useCallback(
    (next: string, manual: boolean, preservePending = false) => {
      if (uniworkRef.current.readOnly && next !== textRef.current) {
        // a view-only UniWork copy: put the source and the preview back as they were
        editorRef.current?.setDoc(textRef.current)
        if (styleTimerRef.current !== null) window.clearTimeout(styleTimerRef.current)
        styleTimerRef.current = null
        pendingStylesRef.current = {}
        setPendingCount(0)
        setPreviewNonce((n) => n + 1)
        return
      }
      textRef.current = next
      versionRef.current += 1
      if (manual) lastManualVersionRef.current = versionRef.current
      // text-range coordinates never survive a document change
      setTextSel(null)
      // any other document change reloads the preview and drops the live pokes; forget them too rather than
      // committing them later against sids the rebuilt parse map may have reassigned
      if (!flushingStylesRef.current && !preservePending) {
        if (styleTimerRef.current !== null) window.clearTimeout(styleTimerRef.current)
        styleTimerRef.current = null
        pendingStylesRef.current = {}
        setPendingCount(0)
      }
      setText(next)
      refreshHistory()
    },
    [refreshHistory],
  )

  const onEditorChange = useCallback(
    (next: string) => {
      editorRef.current?.clearHighlights()
      commitText(next, true)
    },
    [commitText],
  )

  /** compile + apply one batch; manual batches are not highlighted and count as user edits for AI staleness */
  const applyOps = useCallback(
    (
      ops: HtmlOp[],
      manual: boolean,
    ): { ok: true; ranges: Array<[number, number]> } | { ok: false; errors: OpError[] } => {
      const base = textRef.current
      const compiled = compileOps(base, getMap(), ops)
      if (compiled.errors.length > 0) return { ok: false, errors: compiled.errors }
      const editor = editorRef.current
      const ranges = editor
        ? editor.applyPatches(compiled.patches, !manual)
        : compiled.patches.map((p) => [p.from, p.from + p.text.length] as [number, number])
      commitText(applyPatches(base, compiled.patches), manual)
      return { ok: true, ranges }
    },
    [commitText, getMap],
  )

  const flushStylesRef = useRef<(() => void) | null>(null)
  const flushDraftsRef = useRef<(() => void) | null>(null)
  /** land live style pokes and open panel drafts in the source before anything reads, saves or edits it */
  const flushPending = useCallback(() => {
    flushDraftsRef.current?.()
    flushStylesRef.current?.()
  }, [])

  const replaceAll = useCallback(
    (html: string, highlight: boolean) => {
      flushPending()
      // a generated document carries the confirmed brief so later turns (and re-opens) stay anchored to it
      const pinned =
        highlight && briefRef.current && !parseBrief(html)
          ? injectBrief(html, briefRef.current)
          : html
      editorRef.current?.replaceDoc(pinned, highlight)
      // a new page, not an edit of the one on screen: it opens at the top
      frameScrollRef.current = null
      commitText(pinned, false)
    },
    [commitText, flushPending],
  )

  /** apply a toolbar/inspector batch; the selection follows the edited element (or clears when it is gone) */
  const runManual = useCallback(
    (
      ops: HtmlOp[],
      follow: 'reselect' | 'clear' | 'keep' | 'inserted' = 'reselect',
      opts: {
        /** the frame already shows exactly this result (its own inline edit / live style): no reload */
        inPlace?: boolean
      } = {},
    ) => {
      // live style pokes and open panel drafts are written first, while their sid still names the element they were made on
      flushPending()
      const before = selectedSidRef.current
      const r = applyOps(ops, true)
      if (!r.ok) {
        setNotice(r.errors[0]?.message ?? 'edit rejected')
        return false
      }
      if (opts.inPlace) pushPreview(textRef.current, false)
      if (follow === 'clear') {
        selectSidRef.current?.(null, {})
        return true
      }
      if (follow === 'inserted' || (follow === 'reselect' && before !== null)) {
        const map = getMap()
        // sids are matched by path, so after a move / rename / replace the old sid may now name the
        // sibling that took the old position; re-derive the target from the largest applied range
        const relocates = ops.some(
          (o) => o.op === 'move' || o.op === 'set_tag' || o.op === 'replace_element',
        )
        const widest = r.ranges.reduce<[number, number] | null>(
          (best, cur) => (!best || cur[1] - cur[0] > best[1] - best[0] ? cur : best),
          null,
        )
        // moved chunks carry their line's indentation and newline; trim so the covering
        // element is the moved element itself, not its parent
        const trimmed = (() => {
          if (!widest) return null
          const src = textRef.current
          let [a, b] = widest
          while (a < b && /\s/.test(src[a]!)) a++
          while (b > a && /\s/.test(src[b - 1]!)) b--
          return [a, b] as [number, number]
        })()
        const covering = trimmed ? elementCovering(map, trimmed[0], trimmed[1]) : null
        if (follow === 'inserted') {
          const target = covering && !STRUCTURAL.has(covering.tag) ? covering.sid : null
          insertedSidRef.current = target
          selectSidRef.current?.(target, { reveal: true })
          return true
        }
        if (relocates && trimmed) {
          selectSidRef.current?.(covering && !STRUCTURAL.has(covering.tag) ? covering.sid : null, {
            reveal: true,
          })
        } else if (before !== null && !map.bySid.has(before)) {
          selectSidRef.current?.(covering && !STRUCTURAL.has(covering.tag) ? covering.sid : null, {
            reveal: true,
          })
        }
      }
      return true
    },
    [applyOps, getMap, flushPending, pushPreview],
  )

  /**
   * Land a redaction plan. The marks the op vocabulary can express go through
   * `runManual`, so they are validated, journaled and undoable like any toolbar
   * edit; the one insertion that no op can address (the comment in front of a
   * `<script>` literal) is spliced through the same patch primitive and the same
   * commit path, one step earlier in the pipeline.
   */
  const applyRedaction = useCallback(
    (plan: RedactPlan | null): boolean => {
      if (!plan) return false
      if (plan.ops.length > 0) return runManual(plan.ops, 'keep')
      if (plan.patches.length === 0) return false
      // pending style pokes land first: they move the offsets the plan was built on
      flushPending()
      const base = textRef.current
      editorRef.current?.applyPatches(plan.patches, false)
      commitText(applyPatches(base, plan.patches), true)
      return true
    },
    [commitText, flushPending, runManual],
  )

  /**
   * The source pane's "hide this from the model" command.
   *
   * An already-marked region is taken off rather than labelled again, which is
   * what makes coming back to a mark undo it. The seed is collapsed to one line
   * because a selection can cross lines and the label goes into a single-line
   * field — and because a label is meant to name the span, not quote it. The raw
   * selection is kept alongside it: a mark may only be written over the exact text
   * the reader was looking at when they opened the dialog.
   */
  const onRedactSelection = useCallback(
    (range: SourceRange) => {
      flushPending()
      const base = textRef.current
      const clear = redactClearPlan(base, getMap(), range.from, range.to)
      if (clear) {
        applyRedaction(clear)
        return
      }
      setRedactDialog({ ...range, seed: range.text.replace(/\s+/g, ' ').trim() })
    },
    [applyRedaction, flushPending, getMap],
  )

  /** the label is in: write the mark, unless the range moved out from under the dialog */
  const confirmRedaction = useCallback(
    (label: string) => {
      const range = redactDialog
      setRedactDialog(null)
      if (!range) return
      flushPending()
      const base = textRef.current
      if (base.slice(range.from, range.to) !== range.text) return
      applyRedaction(redactMarkPlan(base, getMap(), range.from, range.to, label))
      editorRef.current?.focus()
    },
    [applyRedaction, flushPending, getMap, redactDialog],
  )

  const cancelRedaction = useCallback(() => {
    setRedactDialog(null)
    editorRef.current?.focus()
  }, [])

  // ── selection model: one current element shared by the preview, the source pane, the toolbar and the AI ──

  const selectSidRef = useRef<
    | ((
        sid: number | null,
        opts: { reveal?: boolean; toPreview?: boolean; state?: NodeState },
      ) => void)
    | null
  >(null)

  const selectSid = useCallback(
    (
      sid: number | null,
      opts: { reveal?: boolean; toPreview?: boolean; state?: NodeState } = {},
    ) => {
      if (sid !== selectedSidRef.current) flushPending()
      setSelectedSid(sid)
      setSelectedState(opts.state ?? 'static')
      setTextSel(null)
      // geometry, styles and text run all belong to the previous element; the frame re-reports them via gx:rect
      setSelRect(null)
      setSelComputed(null)
      setSelText({ run: null, index: -1, editable: false })
      if (opts.toPreview !== false) previewRef.current?.post({ type: 'gx:select', sid })
      if (sid !== null && opts.reveal) {
        const e = getMap().bySid.get(sid)
        if (e) editorRef.current?.revealRange(e.range[0], e.range[1], false)
      }
    },
    [getMap, flushPending],
  )
  selectSidRef.current = selectSid

  /** numbered pins for queued edits; stale items (element gone) get no pin */
  const postMarks = useCallback(() => {
    const items = canvasModeRef.current === 'present' ? [] : editQueueRef.current
    // no getMap() before the document is loaded: it would cache an empty map under version 0
    const map = items.length ? getMap() : null
    const src = textRef.current
    // one pin per element; several queued edits on the same element share it and list their ordinals
    const bySid = new Map<number, string[]>()
    items.forEach((item, i) => {
      const target = map && resolveQueueItem(buildProjection(src, map), map, item).target
      if (target) bySid.set(target.sid, [...(bySid.get(target.sid) ?? []), String(i + 1)])
    })
    const marks = [...bySid].map(([sid, ordinals]) => ({ sid, label: ordinals.join('·') }))
    previewRef.current?.post({ type: 'gx:mark', marks })
  }, [getMap])
  useEffect(postMarks, [editQueue, canvasMode, postMarks])

  // runPrint is declared further down; the inspector's relayed mod+P reaches it through this ref
  const runPrintRef = useRef<() => Promise<boolean>>(async () => false)
  const frameKeyReplayRef = useRef(createHtmlFrameKeyReplay())
  const onInspectorMessage = useCallback(
    (msg: FromInspector) => {
      // a click that lands while the frame is reloading carries sids from the previous copy
      if (!frameVersionsRef.current.has(msg.version)) return
      // a view-only copy: the frame is in view mode, and a page script can forge anything, so only
      // readiness, scroll, zoom, blocked links and the few shortcuts the host owns get through
      if (
        uniworkRef.current.readOnly &&
        !(
          msg.type === 'gx:ready' ||
          msg.type === 'gx:scroll' ||
          msg.type === 'gx:zoom' ||
          msg.type === 'gx:navigateBlocked' ||
          msg.type === 'gx:keyEvent' ||
          (msg.type === 'gx:keyCommand' && READ_ONLY_FRAME_KEYS.has(msg.command))
        )
      )
        return
      switch (msg.type) {
        case 'gx:ready': {
          previewRef.current?.post({ type: 'gx:theme', dark: isDarkTheme() })
          previewRef.current?.post({ type: 'gx:setMode', mode: frameMode(canvasModeRef.current) })
          // web (UNI-1919): a mod+P inside the preview never reaches the frame's print
          // accelerator, so the inspector relays it; desktop keeps the shell menu's accelerator
          previewRef.current?.post({
            type: 'gx:printKey',
            claim: !!window.htmlApi.connectPreview && cap('print'),
          })
          previewRef.current?.post({ type: 'gx:keyClaims', claims: htmlFrameKeyClaims() })
          // an edit reloaded the page under the reader: put it back where it was before selecting
          if (frameScrollRef.current !== null)
            previewRef.current?.post({ type: 'gx:scrollTo', y: frameScrollRef.current })
          const sid = selectedSidRef.current
          if (sid !== null) previewRef.current?.post({ type: 'gx:select', sid })
          if (editAfterLoadRef.current !== null && editAfterLoadRef.current === sid)
            previewRef.current?.post({ type: 'gx:beginTextEdit', sid })
          editAfterLoadRef.current = null
          postMarks()
          return
        }
        case 'gx:markClick': {
          const map = getMap()
          // a shared pin opens the most recent edit on that element; the others stay reachable from the queue card
          const item = editQueueRef.current
            .filter(
              (q) =>
                resolveQueueItem(buildProjection(textRef.current, map), map, q).target?.sid ===
                msg.sid,
            )
            .at(-1)
          if (!item) return
          selectSid(item.sid, { reveal: true })
          setAskMode({ kind: 'edit', qid: item.qid })
          return
        }
        case 'gx:select': {
          if (!msg.element || msg.dynamic || msg.element.sid === null) {
            if (msg.element) {
              flushPending()
              setSelectedSid(null)
              setSelectedState('dynamic')
              setNotice(t('nodeDynamic'))
            } else selectSid(null, { toPreview: false })
            return
          }
          const map = getMap()
          const e = map.bySid.get(msg.element.sid)
          if (!e) {
            selectSid(null, { toPreview: false })
            return
          }
          const src = textRef.current
          const tag = src.slice(e.startTag[0], e.startTag[1])
          const cls = (/\sclass\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .sort()
            .join(' ')
          const liveCls = msg.element.className.trim().split(/\s+/).filter(Boolean).sort().join(' ')
          const srcText = sourceText(src, e)
          const liveText = msg.element.text
          const textMatches =
            srcText.length > 400 ? srcText.startsWith(liveText.slice(0, 380)) : srcText === liveText
          const dirty =
            cls !== liveCls ||
            childrenOf(map, e.sid).length !== msg.element.childElementCount ||
            !textMatches
          selectSid(e.sid, { reveal: true, toPreview: false, state: dirty ? 'dirty' : 'static' })
          setSelRect(msg.element.rect)
          setSelComputed(msg.element.computed)
          setSelText({
            run: msg.element.textRun,
            index: msg.element.textRunIndex,
            editable: msg.element.inlineEditable,
          })
          return
        }
        case 'gx:hover':
          return
        case 'gx:rect':
          if (msg.sid !== selectedSidRef.current) return
          setSelRect(msg.rect)
          setSelComputed(msg.computed)
          setSelText({ run: msg.textRun, index: msg.textRunIndex, editable: msg.inlineEditable })
          return
        case 'gx:textSelect':
          setTextSel({
            sid: msg.sid,
            textNodeIndex: msg.textNodeIndex,
            start: msg.start,
            end: msg.end,
          })
          return
        case 'gx:textEditCommit':
          runManual(
            [{ op: 'set_text_node', sid: msg.sid, index: msg.textNodeIndex, text: msg.newText }],
            'reselect',
            { inPlace: true },
          )
          return
        case 'gx:scroll':
          frameScrollRef.current = msg.y
          return
        case 'gx:htmlEditCommit':
          runManual([{ op: 'set_inner_html', sid: msg.sid, html: msg.html }])
          return
        case 'gx:textEditCancel':
          return
        case 'gx:zoom':
          if (canvasModeRef.current !== 'present') setZoom((z) => clampZoom(z - msg.delta * 0.6))
          return
        case 'gx:keyEvent': {
          // focus is inside the frame: replay the table's app-level keys on the window; a page can
          // forge this message, so it needs the frame to hold focus, a real key's user activation on the
          // host, and Save / Save As are rate-limited (shortcuts.ts)
          const replay = frameKeyReplayRef.current(msg, {
            frameFocused: !!previewRef.current?.hasFocus(),
            userActive: hostHasUserActivation(),
            saving: savingRef.current,
          })
          if (replay) window.dispatchEvent(replay)
          return
        }
        case 'gx:keyCommand': {
          if (msg.command === 'print') {
            void runPrintRef.current()
            return
          }
          if (canvasModeRef.current === 'present') {
            if (msg.command === 'escape') setCanvasModeState('edit')
            return
          }
          if (msg.command === 'undo' || msg.command === 'redo') {
            editorRef.current?.[msg.command]()
            return
          }
          if (msg.command === 'zoomIn' || msg.command === 'zoomOut') {
            const dir = msg.command === 'zoomIn' ? 1 : -1
            setZoom((z) => clampZoom(Math.round(z) + dir * ZOOM_STEP))
            return
          }
          if (msg.command === 'zoomReset') {
            setZoom(100)
            return
          }
          const sid = selectedSidRef.current
          if (sid === null) {
            if (msg.command === 'escape') {
              window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
              )
            }
            return
          }
          const map = getMap()
          const e = map.bySid.get(sid)
          if (!e) return
          if (msg.command === 'moveUp' || msg.command === 'moveDown')
            moveSelectedRef.current(msg.command === 'moveUp' ? -1 : 1)
          else if (msg.command === 'delete') runManual([{ op: 'remove', sid }], 'clear')
          else if (msg.command === 'escape') selectSid(null)
          else if (msg.command === 'bold') wrapSelectionRef.current('strong')
          else if (msg.command === 'italic') wrapSelectionRef.current('em')
          else if (msg.command === 'underline') wrapSelectionRef.current('u')
          else if (msg.command === 'link') openLinkRef.current()
          else if (msg.command === 'parent' && e.parentSid !== null) {
            const parent = map.bySid.get(e.parentSid)
            if (parent && parent.tag !== 'body' && parent.tag !== 'html')
              selectSid(parent.sid, { reveal: true })
          } else if (msg.command === 'child') {
            const first = childrenOf(map, sid)[0]
            if (first) selectSid(first.sid, { reveal: true })
          } else if (msg.command === 'next' || msg.command === 'prev') {
            const siblings = e.parentSid !== null ? childrenOf(map, e.parentSid) : []
            const i = siblings.findIndex((s) => s.sid === sid)
            const target = siblings[msg.command === 'next' ? i + 1 : i - 1]
            if (target) selectSid(target.sid, { reveal: true })
          }
          return
        }
        case 'gx:navigateBlocked':
          window.open(msg.href)
          setNotice(t('openExternal'))
          return
        case 'gx:resize':
          if (msg.sid === selectedSidRef.current) previewStyleRef.current(msg.styles)
          return
        case 'gx:moveTo':
          if (msg.sid === selectedSidRef.current)
            runManual([{ op: 'move', sid: msg.sid, position: msg.position, ref_sid: msg.ref_sid }])
          return
        case 'gx:drag':
          setDragging(msg.active)
          return
        default:
          return
      }
    },
    [getMap, postMarks, runManual, selectSid, t, flushPending],
  )

  // the source cursor picks the covering element (no reveal: the user is already there)
  const onCursor = useCallback(
    (c: CursorInfo) => {
      setCursor(c)
      // [pos, pos+1): a cursor sitting on a boundary belongs to the element that starts there
      const e = elementCovering(getMap(), c.pos, Math.min(c.pos + 1, textRef.current.length))
      const sid = e && !STRUCTURAL.has(e.tag) ? e.sid : null
      if (sid !== selectedSidRef.current) selectSid(sid, { toPreview: true })
    },
    [getMap, selectSid],
  )

  const selectedEntry = selectedSid !== null ? getMap().bySid.get(selectedSid) : undefined

  const duplicateSelected = () => {
    if (!selectedEntry) return
    const html = textRef.current.slice(selectedEntry.range[0], selectedEntry.range[1])
    runManual([{ op: 'insert_html', sid: selectedEntry.sid, position: 'after', html: `\n${html}` }])
  }
  const moveSelected = (dir: -1 | 1) => {
    if (!selectedEntry) return
    const target = moveTarget(getMap(), selectedEntry.sid, dir)
    if (target) runManual([{ op: 'move', sid: selectedEntry.sid, ...target }])
  }
  moveSelectedRef.current = moveSelected
  const wrapSelection = (tag: string, attrs?: Record<string, string>) => {
    if (!textSel) return
    if (runManual([{ op: 'wrap_text', ...textSel, index: textSel.textNodeIndex, tag, attrs }]))
      setTextSel(null)
  }
  wrapSelectionRef.current = wrapSelection
  /** Ctrl/Cmd+K: ask for an address, then wrap the preview's text selection in a link */
  openLinkRef.current = () => {
    if (statusRef.current !== 'ready' || canvasModeRef.current === 'present') return
    if (uniwork.readOnly) return
    if (textSel) setLinkSel(textSel)
    else setNotice(t('linkNeedsSelection'))
  }
  const applyLink = (href: string) => {
    const sel = linkSel
    setLinkSel(null)
    if (!sel) return
    if (
      runManual([{ op: 'wrap_text', ...sel, index: sel.textNodeIndex, tag: 'a', attrs: { href } }])
    )
      setTextSel(null)
  }
  const askAi = () => {
    if (selectedEntry) setAskMode({ kind: 'new' })
  }
  const setAttr = (name: string, value: string | null) => {
    // may run from the panel's unmount after the element was deleted
    if (selectedEntry && getMap().bySid.has(selectedEntry.sid))
      runManual([{ op: 'set_attr', sid: selectedEntry.sid, name, value }])
  }
  /** picks a file, copies it into the document's assets/ and points src at it; needs a saved document */
  const replaceImage = async () => {
    if (!selectedEntry) return
    if (!pathRef.current) {
      setNotice(t('imageNeedsSave'))
      return
    }
    const sid = selectedEntry.sid
    const rel = await window.htmlApi.pickImage()
    if (rel && selectedSidRef.current === sid)
      runManual([{ op: 'set_attr', sid, name: 'src', value: rel }])
  }
  /** ribbon Insert > Insert skeleton: a standards-mode page in the UI language, for a still-blank document */
  const insertSkeleton = useCallback(() => {
    // the menu is disabled once the page has content, and re-checked here so
    // the action cannot fire from a stale render (a keyboard path, a queued click)
    if (!isDocEmpty(textRef.current)) return
    replaceAll(documentSkeleton(lang), false)
  }, [lang, replaceAll])

  /** ribbon Insert menu: a starter element after the selection (or at the end of the body), then straight into editing */
  const insertElement = async (kind: InsertKind, opts: InsertOptions = {}) => {
    let imageSrc: string | undefined
    if (kind === 'image' && opts.url) {
      imageSrc = opts.url
    } else if (kind === 'image') {
      if (!pathRef.current) {
        setNotice(t('imageNeedsSave'))
        return
      }
      const rel = await window.htmlApi.pickImage()
      if (!rel) return
      imageSrc = rel
    }
    flushPending()
    const map = getMap()
    const selected =
      selectedSidRef.current !== null ? map.bySid.get(selectedSidRef.current) : undefined
    const html = insertPresetHtml(
      kind,
      {
        heading: t('insertPlaceholderHeading'),
        paragraph: t('insertPlaceholderParagraph'),
        listItem: t('insertPlaceholderListItem'),
        button: t('insertPlaceholderButton'),
        sectionTitle: t('insertPlaceholderHeading'),
        sectionBody: t('insertPlaceholderParagraph'),
        imageAlt: '',
        tableHeaders: Array.from({ length: Math.max(1, opts.cols ?? 3) }, (_, i) =>
          t('insertPlaceholderTableHeader', { n: i + 1 }),
        ),
        tableCell: t('insertPlaceholderTableCell'),
      },
      { imageSrc, tableBodyRows: Math.max(1, (opts.rows ?? 3) - 1) },
    )
    const op = insertOp(map, selected, html)
    if (!op) {
      setNotice(t('insertNoBody'))
      return
    }
    insertedSidRef.current = null
    if (runManual([op], 'inserted') && TEXT_INSERT_KINDS.has(kind))
      editAfterLoadRef.current = insertedSidRef.current
  }
  /** crop / remove background edit the pixels: read the picture, open the dialog, write a new asset */
  const openPictureDialog = async (kind: 'crop' | 'cutout') => {
    const src = selComputed?.image?.src
    if (!selectedEntry || !src) return
    if (!pathRef.current) {
      setNotice(t('imageNeedsSave'))
      return
    }
    const sid = selectedEntry.sid
    const image = await loadImageDataUrl(src).catch(() => null)
    if (selectedSidRef.current !== sid) return
    if (!image) {
      setNotice(t('imageLoadFail'))
      return
    }
    setPictureDialog({ kind, sid, src, image })
  }
  const applyPictureBytes = async (sid: number, src: string, png: string) => {
    setPictureDialog(null)
    const rel = await window.htmlApi.saveImage({ base64: png, ext: 'png' })
    // sids are matched by path, so after an edit during the write the sid may name another
    // element: the target must still be the <img> with the src the dialog was opened on
    const entry = rel ? getMap().bySid.get(sid) : undefined
    // compare through the same attribute decoding the frame used (entities such as &amp; in the query)
    const authoredSrc =
      entry?.tag === 'img'
        ? new DOMParser()
            .parseFromString(
              textRef.current.slice(entry.startTag[0], entry.startTag[1]),
              'text/html',
            )
            .querySelector('img')
            ?.getAttribute('src')
        : null
    const stillThere = authoredSrc === src
    if (!rel || !stillThere) {
      // an unreferenced pending asset is discarded by the save-time reconciliation
      setNotice(t('imageProcessFail'))
      return
    }
    runManual([{ op: 'set_attr', sid, name: 'src', value: rel }])
  }
  const imageDialogLabels: ImageDialogLabels = {
    cancel: t('cancel'),
    apply: t('imageApply'),
    applying: t('imageProcessing'),
    loading: t('imageLoading'),
    loadFailed: t('imageLoadFail'),
    processFailed: t('imageProcessFail'),
    cutoutTitle: t('imageRemoveBg'),
    tolerance: t('imageCutoutTolerance'),
    cutoutHint: (pct) => t('imageCutoutHint', { pct }),
    cropTitle: t('imageCrop'),
    cropHint: t('imageCropHint'),
  }

  // ── element-scoped AI edits: queue them on the selected element or run one right away ──
  const askTarget = useMemo(() => {
    if (!selectedEntry || STRUCTURAL.has(selectedEntry.tag)) return null
    return {
      sid: selectedEntry.sid,
      tag: selectedEntry.tag,
      // user-facing popover: the raw source text, unlike the queue's model-facing excerpt
      excerpt: sourceText(text, selectedEntry).trim() || `<${selectedEntry.tag}>`,
      start: selectedEntry.range[0],
    }
  }, [selectedEntry, text])
  const queueAdd = (instruction: string) => {
    setAskMode(null)
    if (!askTarget || editQueue.length >= EDIT_QUEUE_MAX) return
    const qid = `q${++queueSeqRef.current}`
    setEditQueue((prev) => [
      ...prev,
      { qid, sid: askTarget.sid, tag: askTarget.tag, capturedText: askTarget.excerpt, instruction },
    ])
    setAiOpen(true)
  }
  const queueUpdate = (qid: string, instruction: string) => {
    setAskMode(null)
    setEditQueue((prev) => prev.map((q) => (q.qid === qid ? { ...q, instruction } : q)))
  }
  const queueRemove = (qid: string) => {
    setAskMode(null)
    setEditQueue((prev) => prev.filter((q) => q.qid !== qid))
  }
  const queueConsume = (qids: string[]) =>
    setEditQueue((prev) => prev.filter((q) => !qids.includes(q.qid)))
  const queueFocus = (qid: string) => {
    const item = editQueue.find((q) => q.qid === qid)
    const target = item && resolveQueueItem(buildProjection(text, getMap()), getMap(), item).target
    if (target) selectSid(target.sid, { reveal: true })
  }
  const askSendNow = (instruction: string) => {
    setAskMode(null)
    if (!askTarget) return
    flushPending()
    setAiOpen(true)
    const scope: AiScopeQuoteData = {
      label: t('aiScopeElement', { tag: askTarget.tag }),
      ...(askTarget.excerpt.trim() ? { text: askTarget.excerpt.trim() } : {}),
    }
    setAiPreset({
      text: buildSelectionInstruction(askTarget, instruction),
      displayText: instruction,
      nonce: Date.now(),
      scope,
      fenceSids: [askTarget.sid],
    })
  }
  /** viewport rect of the selected element, clipped to the stage; identity changes whenever the geometry does */
  const getAskAnchorRect = useCallback((): AnchorRect | null => {
    // stageTick: the stage moved or resized (AI dock, split view, device recentre) without the frame-local rect changing
    void stageTick
    const stage = stageRef.current?.getBoundingClientRect()
    const host = stageRef.current?.querySelector('.preview-host')?.getBoundingClientRect()
    if (!selRect || !stage || !host) return null
    const z = zoom / 100
    const left = Math.max(stage.left, host.left + selRect.x * z)
    const top = Math.max(stage.top, host.top + selRect.y * z)
    const right = Math.min(stage.right, host.left + (selRect.x + selRect.width) * z)
    const bottom = Math.min(stage.bottom, host.top + (selRect.y + selRect.height) * z)
    if (right <= left || bottom <= top) return null
    return { left, top, right, bottom, viewTop: stage.top, viewBottom: stage.bottom }
  }, [selRect, zoom, stageTick])

  // ── live style editing: poke the preview DOM now, write one set_style op to the source shortly after ──
  const flushStyles = useCallback(() => {
    if (styleTimerRef.current !== null) window.clearTimeout(styleTimerRef.current)
    styleTimerRef.current = null
    const styles = pendingStylesRef.current
    pendingStylesRef.current = {}
    setPendingCount(0)
    const sid = selectedSidRef.current
    if (sid === null || Object.keys(styles).length === 0) return
    flushingStylesRef.current = true
    try {
      // every poke went to the frame as gx:previewStyle: it already shows the committed state
      runManual([{ op: 'set_style', sid, styles }], 'reselect', { inPlace: true })
    } finally {
      flushingStylesRef.current = false
    }
  }, [runManual])
  flushStylesRef.current = flushStyles

  const previewStyle = (styles: Record<string, string | null>) => {
    const sid = selectedSidRef.current
    if (sid === null) return
    previewRef.current?.post({ type: 'gx:previewStyle', sid, styles })
    pendingStylesRef.current = { ...pendingStylesRef.current, ...styles }
    setPendingCount(Object.keys(pendingStylesRef.current).length)
    if (styleTimerRef.current !== null) window.clearTimeout(styleTimerRef.current)
    styleTimerRef.current = window.setTimeout(flushStyles, STYLE_COMMIT_MS)
  }

  previewStyleRef.current = previewStyle

  /** drop uncommitted previews: reload the frame from the last pushed source */
  const revertStyles = () => {
    if (styleTimerRef.current !== null) window.clearTimeout(styleTimerRef.current)
    styleTimerRef.current = null
    pendingStylesRef.current = {}
    setPendingCount(0)
    setPreviewNonce((n) => n + 1)
  }

  const setCanvasMode = useCallback(
    (mode: CanvasMode) => {
      setCanvasModeState((prev) => {
        if (prev === mode) return prev
        if (mode === 'present') selectSid(null)
        return mode
      })
      flushPending()
      setAskMode(null)
    },
    [flushPending, selectSid],
  )
  useEffect(() => {
    if (canvasMode !== 'present') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setCanvasMode('edit')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [canvasMode, setCanvasMode])

  const startPresent = useCallback(
    (kind: PresentKind) => {
      if (kind === 'newTab') {
        // the new tab reads html-preview:// as it stands: land pending pokes and the debounced push first
        flushPending()
        pushPreview(textRef.current)
        void window.htmlApi.presentInNewTab(path?.split(/[\\/]/).pop() ?? '')
        return
      }
      setPresentFull(kind === 'fullscreen')
      setCanvasMode('present')
      // HTML fullscreen needs the click's user activation; macOS snaps via simpleFullScreen instead
      if (kind === 'fullscreen' && !IS_MAC)
        void document.documentElement.requestFullscreen?.().catch(() => {})
    },
    [path, setCanvasMode, flushPending, pushPreview],
  )

  // a link navigation inside the presented frame keeps focus in a document without our
  // inspector; hand it back to the app so Esc still ends the presentation
  const onPreviewLoad = useCallback(() => {
    if (canvasModeRef.current !== 'present') return
    const active = document.activeElement
    if (active instanceof HTMLIFrameElement) active.blur()
  }, [])

  // Same shape as the slides show: the main process snaps the window (tab-strip bleed,
  // macOS simpleFullScreen without the Space animation), HTML fullscreen only elsewhere.
  // Entry is read from fullscreenchange, not the request promise, and only a loss that
  // sticks (not a strict-mode remount blip) ends the presentation.
  useEffect(() => {
    if (canvasMode !== 'present' || !presentFull) return
    let entered = !!document.fullscreenElement
    let exitTimer = 0
    void window.htmlApi.setPresentFullScreen(true).catch(() => {})
    const onFsChange = () => {
      if (document.fullscreenElement) {
        entered = true
        window.clearTimeout(exitTimer)
        return
      }
      if (!entered) return
      window.clearTimeout(exitTimer)
      exitTimer = window.setTimeout(() => {
        if (!document.fullscreenElement) setCanvasMode('edit')
      }, 150)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      window.clearTimeout(exitTimer)
      document.removeEventListener('fullscreenchange', onFsChange)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      void window.htmlApi.setPresentFullScreen(false).catch(() => {})
    }
  }, [canvasMode, presentFull, setCanvasMode])

  const setRunText = (text: string) => {
    if (!selectedEntry || selText.index < 0 || !getMap().bySid.has(selectedEntry.sid)) return
    runManual([{ op: 'set_text_node', sid: selectedEntry.sid, index: selText.index, text }])
  }

  const doSave = useCallback(
    async (mode: SaveMode, suggestedName?: string, origin?: 'auto'): Promise<boolean> => {
      const allowed = mode === 'saveAs' ? cap('saveAs') : cap('save')
      if (statusRef.current !== 'ready' || !allowed) return false
      // EL-1(b) VEL-1: an explicit Save on a read-only bound copy asks main to
      // explain the lock instead of writing (Save As and unbound files keep
      // today's path)
      if (mode === 'save' && !origin && uniworkRef.current.bound && uniworkRef.current.readOnly) {
        void (window.htmlApi as HtmlUniworkLockSeam).uniworkReadOnlySave?.()?.catch(() => {})
        return false
      }
      // uncommitted live style pokes belong to the document being saved
      flushPending()
      // a menu save or ⌘S during an autosave queues behind it instead of being dropped;
      // the main-process waiter is resolved by the save() call that follows
      while (savingRef.current) await new Promise((r) => setTimeout(r, 50))
      savingRef.current = true
      setSaveState('saving')
      try {
        const textAtSave = textRef.current
        const serialized = serializeDocText({ text: textAtSave, envelope: envelopeRef.current })
        const result = await window.htmlApi.save({
          text: serialized,
          imageSources: [],
          mode,
          suggestedName,
          defaultName: (!pathRef.current && deriveDocumentName(textAtSave)) || undefined,
          ...(origin ? { origin } : {}),
        })
        if (result.ok && 'path' in result) {
          const adopted = adoptImageRewrites(textAtSave, textRef.current, result.imageRewrites)
          if (adopted.liveText !== textRef.current) {
            editorRef.current?.setDoc(adopted.liveText)
            commitText(adopted.liveText, false, true)
          }
          setPath((previous) => {
            if (previous !== result.path) setPreviewNonce((n) => n + 1)
            return result.path
          })
          savedTextRef.current = adopted.savedText
          setSavedText(adopted.savedText)
          const saved = adopted.liveText === adopted.savedText
          setSaveState(saved ? 'saved' : 'idle')
          if (!saved) window.htmlApi.setDirty(true)
          pushPreview(adopted.liveText)
          return true
        }
        setSaveState(result.ok ? 'idle' : 'failed')
        return false
      } catch (err) {
        console.error('[html] save failed:', err)
        setSaveState('failed')
        return false
      } finally {
        savingRef.current = false
      }
    },
    [commitText, flushPending, pushPreview],
  )

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(Math.round(z) + ZOOM_STEP)), [])
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(Math.round(z) - ZOOM_STEP)), [])
  const cycleView = useCallback(
    () => setView((v) => VIEW_MODES[(VIEW_MODES.indexOf(v) + 1) % VIEW_MODES.length]!),
    [],
  )

  const openFind = useCallback((replace: boolean) => {
    if (statusRef.current !== 'ready' || canvasModeRef.current === 'present') return
    const target = editorRef.current?.findTarget()
    if (!target) return
    setFindTarget(target)
    setFindFocus((f) => ({ field: replace ? 'replace' : 'find', nonce: f.nonce + 1 }))
    // hits live in the source pane, so it must be on screen
    setView((v) => (v === 'preview' ? 'split' : v))
  }, [])
  const closeFind = useCallback(() => setFindTarget(null), [])
  useEffect(() => {
    if (canvasMode === 'present') closeFind()
  }, [canvasMode, closeFind])

  const exportingRef = useRef(false)
  /** `outPath` (headless export only) skips the save dialog; resolves true when a file was written. */
  const runExport = useCallback(async (format: ExportFormat, outPath?: string) => {
    const allowed =
      format === 'pdf'
        ? // host Print renders its PDF through this same export; the bridge still refuses a
          // plain Export PDF without the `exportPdf` grant
          cap('exportPdf') || cap('print')
        : format === 'html'
          ? cap('exportHtml')
          : cap('exportDocx') && cap('saveAs')
    if (statusRef.current !== 'ready' || exportingRef.current || !allowed) return false
    exportingRef.current = true
    try {
      flushPending()
      const html = textRef.current
      const suggestedName =
        pathRef.current?.replace(/^.*[/\\]/, '').replace(/\.html?$/i, '') ||
        deriveDocumentName(html) ||
        ''
      const request = { html, suggestedName, ...(outPath ? { outPath } : {}) }
      const result =
        format === 'pdf'
          ? await window.htmlApi.exportPdf(request)
          : format === 'html'
            ? await window.htmlApi.exportHtml(request)
            : await window.htmlApi.exportDocx(request)
      if (!result.ok) {
        console.error('[html] export failed:', result.error)
        setNotice(t('exportFailed'))
        return false
      }
      if ('skipped' in result && result.skipped?.length) {
        setNotice(
          t('exportHtmlSkipped', { count: result.skipped.length, first: result.skipped[0]! }),
        )
      }
      return !('canceled' in result)
    } finally {
      exportingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is not referentially stable
  }, [])

  const printingRef = useRef(false)
  const runPrint = useCallback(async () => {
    if (statusRef.current !== 'ready' || !cap('print')) return false
    return runGuardedPrint(
      printingRef,
      async () => {
        // serialize inside the gate so a throw still releases the flag
        flushPending()
        return window.htmlApi.printHtml({
          html: serializeDocText({ text: textRef.current, envelope: envelopeRef.current }),
        })
      },
      (error) => {
        console.error('[html] print failed:', error)
        setNotice(t('printFailed', { error }))
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is not referentially stable
  }, [])
  runPrintRef.current = runPrint

  // Headless export mode (--headless-export): this renderer lives in a hidden
  // window whose only job is to run the File menu's PDF or Word export against
  // a path the CLI chose, then report back so the main process can quit.
  const headlessExportStartedRef = useRef(false)
  useEffect(() => {
    if (headlessExportStartedRef.current) return
    headlessExportStartedRef.current = true
    void (async () => {
      const target = await window.htmlApi.consumeHeadlessExport()
      if (!target) return
      const report = await runHeadlessRendererExport(
        target.outPath,
        () =>
          pollUntilReady(() => {
            if (statusRef.current === 'error') throw new Error('the input document did not open')
            return statusRef.current === 'ready'
          }, 'no document opened'),
        (outPath) => runExport(target.format === 'docx' ? 'docx' : 'pdf', outPath),
      )
      window.htmlApi.headlessExportDone(report)
    })()
  }, [runExport])

  useEffect(() => {
    const offSave = window.htmlApi.onSaveRequest((mode) => {
      if (statusRef.current !== 'ready') {
        window.htmlApi.sendSaveRequestAck(false)
        return
      }
      if (mode === 'save' && uniworkRef.current.bound && uniworkRef.current.readOnly) {
        void doSave(mode)
        window.htmlApi.sendSaveRequestAck(false)
        return
      }
      void doSave(mode)
    })
    // MCP read of this open document: hand back the same serialization a save
    // would write, so uncommitted edits are included. Staying silent while the
    // editor is still loading keeps the main process retrying its request
    // instead of failing on a document that is merely not ready yet.
    const offReadText = window.htmlApi.onReadTextRequest(() => {
      if (statusRef.current !== 'ready') return
      try {
        flushPending()
        const serialized = serializeDocText({
          text: textRef.current,
          envelope: envelopeRef.current,
        })
        window.htmlApi.sendReadTextResult({ text: serialized })
      } catch (err) {
        window.htmlApi.sendReadTextResult({
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
    const offClose = window.htmlApi.onCloseSaveRequest(() => {
      void (async () => {
        while (savingRef.current) await new Promise((r) => setTimeout(r, 50))
        flushPending()
        if (textRef.current === savedTextRef.current) {
          window.htmlApi.sendCloseSaveResult(true)
          return
        }
        window.htmlApi.sendCloseSaveResult(await doSave('save'))
      })()
    })
    const offRenamed = window.htmlApi.onFileRenamed((next) => setPath(next))
    const offExport = window.htmlApi.onExportRequest((format) => void runExport(format))
    // Shell menu Print / ⌘P. The menu owns the accelerator, so this subscription
    // is the only route the keystroke takes; without it ⌘P did nothing at all.
    const offPrint = window.htmlApi.onPrintRequest(() => void runPrint())
    const offTheme = window.htmlApi.onThemeChanged(() => {
      // let main.tsx flip data-theme first
      window.setTimeout(
        () => previewRef.current?.post({ type: 'gx:theme', dark: isDarkTheme() }),
        0,
      )
    })
    const onKeyDown = (event: KeyboardEvent) => {
      const command = htmlWindowCommand(event, inTextField(event.target))
      if (!command) return
      event.preventDefault()
      switch (command) {
        case 'save':
        case 'saveAs':
          void doSave(command)
          return
        case 'cycleView':
          cycleView()
          return
        case 'find':
        case 'replace':
          openFind(command === 'replace')
          return
        case 'findNext':
          // an open panel steps to the next hit; a closed one opens (Word's "repeat Find")
          if (!stepFindMatch('next')) openFind(false)
          return
        case 'zoomIn':
          zoomIn()
          return
        case 'zoomOut':
          zoomOut()
          return
        case 'zoomReset':
          setZoom(100)
          return
        case 'bold':
        case 'italic':
        case 'underline':
          wrapSelectionRef.current(WRAP_TAG[command])
          return
        case 'link':
          openLinkRef.current()
          return
        case 'undo':
        case 'redo':
          editorRef.current?.[command]()
          return
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      offSave()
      offReadText()
      offClose()
      offRenamed()
      offExport()
      offPrint()
      offTheme()
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [doSave, runExport, runPrint, cycleView, zoomIn, zoomOut, flushPending, openFind])

  // pinch / ctrl+wheel over the stage chrome around the frame; wheel inside the frame arrives as gx:zoom
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (canvasModeRef.current === 'present') return
      if (!(event.target as HTMLElement | null)?.closest?.('.preview-stage')) return
      event.preventDefault()
      setZoom((z) => clampZoom(z - event.deltaY * 0.6))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  // a UniWork copy: ask main again whenever the document lands on a new path (open, Save As, rename)
  useEffect(() => {
    let live = true
    if (!path) {
      setUniwork({ bound: false, readOnly: false })
      return
    }
    // the browser harness may not expose the method: a missing or failed answer is a plain local file
    const query = () => {
      void Promise.resolve(window.htmlApi.uniworkState?.())
        .then((state) => {
          if (!live) return
          setUniwork({
            bound: state?.bound === true,
            readOnly: state?.readOnly === true,
            locked: state?.locked === true,
          })
          setUniworkAnsweredPath(path)
        })
        .catch((err) => {
          console.warn('[html] UniWork state query failed:', err)
          if (!live) return
          setUniwork({ bound: false, readOnly: false })
          setUniworkAnsweredPath(path)
        })
    }
    query()
    // EL-1(b) VEL-2: the edit lock makes readOnly change while the document stays open
    const unsubscribe = (window.htmlApi as HtmlUniworkLockSeam).onUniworkStateChanged?.((p) => {
      if (p === path) query()
    })
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [path])

  // autosave: every 30s and on window blur; untitled documents wait for an explicit first save
  useEffect(() => {
    if (!autoSave || !path || !cap('autoSave') || uniwork.bound) return
    const tick = () => {
      // a native Save As dialog blurs the window: autosave must not queue a write behind
      // a user-driven save, only explicit saves do
      if (savingRef.current) return
      flushPending()
      if (textRef.current === savedTextRef.current) return
      void doSave('save', undefined, 'auto')
    }
    const id = window.setInterval(tick, 30_000)
    window.addEventListener('blur', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('blur', tick)
    }
  }, [autoSave, path, uniwork.bound, doSave, flushPending])

  const aiDeps: HtmlAiDeps = {
    access: {
      getText: () => textRef.current,
      getVersion: () => versionRef.current,
      getMap,
      getLastManualVersion: () => lastManualVersionRef.current,
      getFilePath: () => pathRef.current,
      getSelectedSid: () => selectedSidRef.current,
      applyOps: (ops) => {
        flushPending()
        return applyOps(ops, false)
      },
      replaceAll: (html) => replaceAll(html, true),
      // the adapter bound feeds the AI through the shared rule: a web frame reads as bound
      uniworkBound: () => uniworkBoundForAi(uniworkRef.current.bound, platform()),
    },
    getSnapshot: () => ({ text: textRef.current }),
    restoreSnapshot: (snapshot) => replaceAll(snapshot.text, false),
    onRunDone: (mutated) => {
      // AI wrote into a never-saved document: the panel asks before anything is saved, offering
      // the page's own title or first heading ('' = none, the dialog starts with its usual
      // untitled name). The name never comes from the user's request.
      if (!mutated || pathRef.current) return null
      const name = deriveDocumentName(textRef.current)
      if (name && name !== provisionalNameRef.current) {
        provisionalNameRef.current = name
        window.htmlApi.setProvisionalTitle(name)
      }
      return name
    },
    // the Save click on that offer: the normal first-save dialog, pre-filled with the name
    onSaveOffer: (name) => void doSave('save', name || undefined),
    clearHighlights: () => editorRef.current?.clearHighlights(),
    runHistory: {
      get activeRunId() {
        return editorRef.current?.runHistory.activeRunId ?? null
      },
      begin: (runId) => editorRef.current?.runHistory.begin(runId),
      end: (runId, mutated) => editorRef.current?.runHistory.end(runId, mutated),
    },
    onBriefConfirmed: (brief) => {
      briefRef.current = brief
    },
    previewDraft: setDraftHtml,
    navigateTo: (sid) => {
      const e = getMap().bySid.get(sid)
      if (!e) return
      selectSid(sid, { reveal: true })
    },
  }

  const statusText = useMemo(() => {
    if (saveState === 'saving') return t('saving')
    if (saveState === 'failed') return t('saveFailedStatus')
    if (dirty) return t('unsaved')
    if (saveState === 'saved') return t('savedOk')
    return ''
  }, [saveState, dirty, t])

  if (status === 'error') return <div className="center-note">{t('loadFailed')}</div>
  if (status === 'loading') return <div className="center-note">{t('loading')}</div>

  const hasElement = !!selectedEntry && !STRUCTURAL.has(selectedEntry.tag)
  const panelShown = panelOpen && selectedEntry?.sid !== panelDismissedSid

  /** stage width the open style panel covers on the right (0 when it is closed) */
  const panelReserve = (stage: DOMRect | undefined): number => {
    if (!panelShown || !hasElement) return 0
    const panel = stageRef.current?.querySelector('.hx-panel')?.getBoundingClientRect()
    return stage && panel && panel.width > 0
      ? Math.max(0, stage.right - panel.left) + 6
      : PANEL_RESERVE
  }

  /** stage geometry for the floating toolbar: frame coordinates scale with the CSS zoom and shift by the centred device host */
  const floatLayout = () => {
    void stageTick
    const stage = stageRef.current?.getBoundingClientRect()
    const host = stageRef.current?.querySelector('.preview-host')?.getBoundingClientRect()
    return {
      zoom,
      offsetX: stage && host ? host.left - stage.left : 0,
      offsetY: stage && host ? host.top - stage.top : 0,
      // the style panel floats over the right edge of the stage: reserve its measured box (the
      // fallback is the CSS box, used on the render that mounts it)
      stageWidth: Math.max(0, (stage?.width ?? 0) - panelReserve(stage)),
      barWidth: barSize.w,
      barHeight: barSize.h,
    }
  }

  const findStrings: FindPanelStrings = {
    findPlaceholder: t('findPlaceholder'),
    replacePlaceholder: t('replacePlaceholder'),
    matchCase: t('matchCase'),
    wholeWord: t('wholeWord'),
    noResults: t('noResults'),
    prevMatch: t('prevMatch'),
    nextMatch: t('nextMatch'),
    closeEsc: t('closeEsc'),
    prevName: t('prevName'),
    nextName: t('nextName'),
    closeName: t('closeName'),
    replace: t('replace'),
    replaceAll: t('replaceAll'),
  }

  return (
    <div
      className={`app${canvasMode === 'present' ? ` present${presentFull ? ' present-full' : ''}` : ''}`}
      data-esc-local={canvasMode === 'present' ? '' : undefined}
    >
      <Ribbon
        disabled={status !== 'ready'}
        dirty={dirty}
        onSave={() => void doSave('save')}
        onSaveAs={() => void doSave('saveAs')}
        onExport={
          platform() === 'web' && cap('exportHtml') ? () => void runExport('html') : undefined
        }
        exportDisabled={status !== 'ready'}
        onFind={() => openFind(false)}
        canUndo={historyState.undo}
        canRedo={historyState.redo}
        onUndo={() => {
          editorRef.current?.undo()
          editorRef.current?.focus()
        }}
        onRedo={() => {
          editorRef.current?.redo()
          editorRef.current?.focus()
        }}
        autoSave={autoSave}
        onToggleAutoSave={setAutoSave}
        showAutoSave={cap('autoSave')}
        showAi={aiEnabled}
        aiOffHint={aiEnabled ? undefined : t('aiNotEnabled')}
        presentNewTab={cap('presentNewTab')}
        uniworkBound={uniwork.bound}
        readOnly={uniwork.readOnly || !canEdit}
        view={view}
        onView={setView}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((v) => !v)}
        canInsert={canvasMode === 'edit'}
        onInsert={(kind, opts) => void insertElement(kind, opts)}
        onInsertSkeleton={insertSkeleton}
        canInsertSkeleton={canvasMode === 'edit' && isDocEmpty(textRef.current)}
        onAiPreset={(text) => {
          flushPending()
          setAiOpen(true)
          setAiPreset({ text, nonce: Date.now() })
        }}
        canvasMode={canvasMode}
        onPresent={startPresent}
      />

      <div className="app-main">
        {aiEnabled && (
          <div
            className={`ai-dock${aiOpen ? '' : ' collapsed'}${
              !aiSidebarEnabled && !aiOpen ? ' ai-dock-off' : ''
            }`}
          >
            {!aiOpen && aiSidebarEnabled && (
              <button
                className="ai-rail"
                data-tip={t('aiOpenAssistant')}
                aria-label={t('aiOpenAssistant')}
                onClick={() => setAiOpen(true)}
              >
                <UniAiMark size={18} />
              </button>
            )}
            {/* stays mounted while collapsed: an in-flight run, its snapshots and the loop context survive */}
            <AiPanel
              deps={aiDeps}
              filePath={path}
              preset={aiPreset}
              editQueue={editQueue}
              onQueueEditInstruction={queueUpdate}
              onQueueRemove={queueRemove}
              onQueueClear={() => setEditQueue([])}
              onQueueFocus={queueFocus}
              onQueueConsume={queueConsume}
              readOnly={uniwork.readOnly}
              onCollapse={() => setAiOpen(false)}
              open={aiOpen}
              dockHidden={canvasMode === 'present'}
              onExpand={() => setAiOpen(true)}
            />
          </div>
        )}
        <div className="app-content">
          {findTarget && (
            <FindPanel
              target={findTarget}
              strings={findStrings}
              onClose={closeFind}
              focusRequest={findFocus}
            />
          )}
          {view !== 'preview' && (
            <Breadcrumb
              text={text}
              map={getMap()}
              sid={selectedSid}
              state={selectedState}
              onSelect={(sid) => selectSid(sid, { reveal: true })}
              showHint={visualEdit}
            />
          )}
          <div className={`workspace view-${canvasMode === 'present' ? 'preview' : view}`}>
            <div className="pane pane-preview">
              <div
                className="preview-stage"
                ref={stageRef}
                data-device={device}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) selectSid(null)
                }}
              >
                {previewLimited && canvasMode === 'edit' && <PreviewLimitNote />}
                <PreviewFrame
                  ref={previewRef}
                  url={uniworkKnown ? previewUrl : null}
                  scriptsOff={previewScriptsOff}
                  nonce={previewNonce}
                  zoom={zoom}
                  onMessage={onInspectorMessage}
                  onLoad={onPreviewLoad}
                  draft={draftHtml}
                />
                {canvasMode === 'present' && (
                  <button
                    type="button"
                    className="present-exit"
                    aria-keyshortcuts="Escape"
                    onClick={() => setCanvasMode('edit')}
                  >
                    {t('presentExitName')}{' '}
                    <span aria-hidden="true">
                      {keyHintAfterName(t('presentExit'), t('presentExitName'))}
                    </span>
                  </button>
                )}
                {visualEdit &&
                  canvasMode === 'edit' &&
                  !dragging &&
                  !(narrow && panelShown) &&
                  hasElement &&
                  selectedEntry &&
                  selRect &&
                  selComputed && (
                    <FloatToolbar
                      barRef={barRef}
                      {...floatPosition(selRect, floatLayout())}
                      computed={selComputed}
                      pending={pendingStylesRef.current}
                      canEditText={selText.editable}
                      onStyle={previewStyle}
                      onEditText={() =>
                        previewRef.current?.post({
                          type: 'gx:beginTextEdit',
                          sid: selectedEntry.sid,
                        })
                      }
                      onReplaceImage={replaceImage}
                      onCropImage={() => void openPictureDialog('crop')}
                      onCutoutImage={() => void openPictureDialog('cutout')}
                      canAskAi={askTarget !== null && !uniwork.readOnly}
                      onAskAi={askAi}
                      tag={selectedEntry.tag}
                      onMove={moveSelected}
                      onDuplicate={duplicateSelected}
                      onDelete={() =>
                        runManual([{ op: 'remove', sid: selectedEntry.sid }], 'clear')
                      }
                      panelOpen={panelShown}
                      onTogglePanel={() => {
                        if (panelShown) setPanelOpen(false)
                        else {
                          setPanelDismissedSid(null)
                          setPanelOpen(true)
                        }
                      }}
                    />
                  )}
                {visualEdit &&
                  canvasMode === 'edit' &&
                  hasElement &&
                  selectedEntry &&
                  selComputed &&
                  panelShown && (
                    <StylePanel
                      key={selectedEntry.sid}
                      sheet={narrow}
                      tag={selectedEntry.tag}
                      computed={selComputed}
                      textRun={selText.run}
                      onStyle={previewStyle}
                      onText={setRunText}
                      onAttr={setAttr}
                      draftRef={flushDraftsRef}
                      onCustomCss={(css) => {
                        const decls = parseDeclarations(css)
                        if (Object.keys(decls).length) previewStyle(decls)
                      }}
                      pending={pendingCount > 0}
                      onRevert={revertStyles}
                      onClose={() => setPanelDismissedSid(selectedEntry.sid)}
                    />
                  )}
              </div>
            </div>
            <div className="pane pane-source">
              <SourceEditor
                ref={editorRef}
                className="source-editor"
                initialText={text}
                readOnly={!canEdit || uniwork.readOnly}
                onChange={onEditorChange}
                onCursor={onCursor}
                onBeforeReplace={flushPending}
                // withholding means "the model does not read this", and the model lives behind
                // `ai`: with the key off (web frame) the source pane keeps Chromium's own menu
                onRedact={aiEnabled && canEdit && !uniwork.readOnly ? onRedactSelection : undefined}
              />
            </div>
          </div>

          <footer className="status-bar">
            <div className="status-left">
              {notice ? (
                <span className="status-item status-notice">{notice}</span>
              ) : (
                !path && <span className="status-item status-hint">{t('previewNeedsSave')}</span>
              )}
              {/* on the web the host announces view-only (banner + live region): cap viewOnlyChip is off there */}
              {!canEdit && cap('viewOnlyChip') && status === 'ready' && (
                <span className="status-item status-view-only">{t('viewOnly')}</span>
              )}
            </div>
            <div className="status-right">
              {statusText && cap('saveStatus') && (
                <span className={`status-save status-${saveState}`}>{statusText}</span>
              )}
              {view !== 'preview' && (
                <span className="status-item status-cursor">
                  {t('cursorPos', { line: cursor.line, col: cursor.col })}
                </span>
              )}
              <span className="status-item">{t('charCount', { n: text.length })}</span>
              <Dropdown
                className="device-dd"
                value={device}
                ariaLabel={t('device')}
                tip={t('device')}
                options={DEVICES.map((d) => ({
                  value: d,
                  label: t(
                    d === 'desktop' ? 'devDesktop' : d === 'tablet' ? 'devTablet' : 'devPhone',
                  ),
                }))}
                onPick={setDevice}
              />
              <button
                type="button"
                className="zoom-btn"
                aria-label={t('zoomOut')}
                aria-keyshortcuts={htmlAria('zoomOut') || undefined}
                onClick={zoomOut}
                disabled={zoom <= MIN_ZOOM}
              >
                −
              </button>
              <input
                className="zoom-slider"
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={ZOOM_STEP}
                value={Math.round(zoom)}
                aria-label={t('zoom')}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <button
                type="button"
                className="zoom-btn"
                aria-label={t('zoomIn')}
                aria-keyshortcuts={htmlAria('zoomIn') || undefined}
                onClick={zoomIn}
                disabled={zoom >= MAX_ZOOM}
              >
                +
              </button>
              <span className="zoom-value">{Math.round(zoom)}%</span>
            </div>
          </footer>
        </div>
      </div>
      {linkSel && canvasMode !== 'present' && (
        <LinkPopover onApply={applyLink} onCancel={() => setLinkSel(null)} />
      )}
      {aiEnabled && askTarget && askMode && canvasMode !== 'present' && !uniwork.readOnly && (
        <AiAskPopover
          key={askMode.kind === 'edit' ? askMode.qid : 'new'}
          target={askTarget}
          mode={askMode}
          initialText={
            askMode.kind === 'edit'
              ? editQueue.find((q) => q.qid === askMode.qid)?.instruction
              : undefined
          }
          getAnchorRect={getAskAnchorRect}
          onSubmit={(instruction) =>
            askMode.kind === 'edit' ? queueUpdate(askMode.qid, instruction) : queueAdd(instruction)
          }
          onCancel={() => setAskMode(null)}
          onSendNow={askSendNow}
          onRemove={() => askMode.kind === 'edit' && queueRemove(askMode.qid)}
          queueFull={editQueue.length >= EDIT_QUEUE_MAX}
        />
      )}
      {redactDialog && (
        <RedactDialog
          seed={redactDialog.seed}
          onSubmit={confirmRedaction}
          onCancel={cancelRedaction}
        />
      )}
      {pictureDialog?.kind === 'cutout' && (
        <CutoutDialog
          labels={imageDialogLabels}
          image={pictureDialog.image}
          onApply={(png) => void applyPictureBytes(pictureDialog.sid, pictureDialog.src, png)}
          onCancel={() => setPictureDialog(null)}
        />
      )}
      {pictureDialog?.kind === 'crop' && (
        <CropDialog
          labels={imageDialogLabels}
          lang={lang}
          image={pictureDialog.image}
          onApply={(png) => void applyPictureBytes(pictureDialog.sid, pictureDialog.src, png)}
          onCancel={() => setPictureDialog(null)}
        />
      )}
    </div>
  )
}
