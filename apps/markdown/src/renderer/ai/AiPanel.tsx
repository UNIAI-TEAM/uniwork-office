import {
  aiUniworkText,
  composerNoteFor,
  isUniworkQuestionRefusal,
  aiPanelWidthAtPointer,
  AiPanelSideButton,
  AiSaveDraftCard,
  AiModelPicker,
  useCloudSignedIn,
  useAiModelNeedHint,
  type AiModelPickerBridge,
  UniAiMark,
} from '@genoffice/ui'
import { useEffect, useRef, useState } from 'react'
import '@genoffice/ui/ai-uniwork-composer.css'
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import {
  AgentLoop,
  droppedCallsOfNotes,
  endsQuietly,
  getEntryResultChipView,
  isTurnEnded,
  noticePatch,
  panelLiveAnnouncement as computePanelLiveAnnouncement,
  singleShortcutHint,
  type MindMapTreeNode,
  type PanelNote,
  composeSkills,
  runHistoryEvents,
  streamText,
  type RunHistoryGroup,
} from '@genoffice/agent-core'
import {
  aiNoticeBody,
  aiNoticeKind,
  imageGenerationAvailable,
  type AiSettings,
} from '@genoffice/ai-provider/browser'
import type {
  UniworkCloudStatusBridge,
  UniworkCloudStatusSnapshot,
} from '@genoffice/electron-utils/uniwork-ai-flag'
import {
  AiComposer,
  AiErrorAction,
  AiQueueStrip,
  AI_QUEUE_LABELS,
  AiScopeQuote,
  AiTypingIndicator,
  AiUsageChip,
  addTokenUsage,
  Markdown,
  uniworkErrorForChip,
  uniworkErrorKeyOfText,
  useChatRunQueue,
  useUniworkDisclosureAck,
  useUniworkSendGate,
  type AiScopeQuoteData,
  type AiTokenUsageView,
} from '@genoffice/ui'
import type { Editor } from '@tiptap/core'
import { aiLangDirective, t as tGlobal, useI18n } from '../i18n/locale'
import { cap, platform } from '../capabilities'
import sendEnterOn from '../assets/send-enter-on.png'
import sendEnterOff from '../assets/send-enter-off.png'
import sendStop from '../assets/send-stop.png'
import { clearAiHighlights } from '../editor/aiHighlight'
import { onRunHistoryChange, runHistoryOf } from '../editor/aiRunHistory'
import { setInactiveSelectionShown } from '../editor/inactiveSelection'
import { queueAnchorRange } from '../editor/aiQueueAnchors'
import {
  clearEditFence,
  canRetryEntry,
  restoredEntryState,
  retryFence,
  setEditFence,
  turnFence,
  type EntryFence,
  type FenceRange,
} from './edit-fence'
import { createMarkdownSkill, MARKDOWN_RULES } from './markdown-skill'
import { MindMapCard } from './MindMapCard'
import {
  buildDocWriterRequest,
  countMarkdownBlocks,
  DOC_MAX_CHARS,
  extractMarkdown,
  type DocWriteResult,
  type DocWriteSpec,
} from './doc-writer'
import { createSearchSkill } from './search-skill'
import { createElectronTransport } from './transport'
import { EditQueueCard } from './EditQueueCard'
import { ClarifyCard } from '../components/ClarifyCard'
import { withReceipt, withoutReceipts, type ClarifyQa } from './clarify-receipts'
import type { AskClarification, ClarifyQuestion } from './tools'
import {
  buildQueueInstruction,
  buildQueueSummary,
  liveItems,
  resolveQueue,
  type EditQueueItem,
} from './edit-queue'
import { DOC_NAV_SCHEME, navigateToBlock, parseDocNavHref } from './doc-nav'

function readUniworkCloudStatus(): UniworkCloudStatusBridge | undefined {
  return (window as Window & { uniworkCloudStatus?: UniworkCloudStatusBridge }).uniworkCloudStatus
}

// Word-parity count (docs word-count.ts): Asian chars one by one + non-Asian words
const ASIAN_RE =
  /[ᄀ-ᇿ⺀-⿟、-\u303f぀-ヿ㄀-ㄯ㄰-㆏㇀-ㇿ㐀-䶿一-鿿가-힯豈-﫿！-｠￠-￦]|[\uD840-\uD87F][\uDC00-\uDFFF]/g
const NON_ASIAN_WORD_RE = /[A-Za-z0-9À-ɏ]+(?:['-][A-Za-z0-9À-ɏ]+)*/g

function countWords(text: string): number {
  return (text.match(ASIAN_RE) ?? []).length + (text.match(NON_ASIAN_WORD_RE) ?? []).length
}

const PANEL_WIDTH_KEY = 'markdown-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 360
const PANEL_WIDTH_MIN = 280
const MAX_SNAPSHOTS = 20

/** `assets/pic%201.png` → `pic 1.png`: the owned-asset name the main process tracks */
function assetFileName(rel: string): string {
  const last = rel.slice(rel.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}
const TOOL_OUTPUT_MAX_CHARS = 2000
/** progress chip refresh while a write streams */
const CHIP_UPDATE_MS = 400

function clampPanelWidth(w: number): number {
  // The viewport can be transiently tiny (a WebContentsView is 0×0 until the
  // shell lays it out), so never let the ceiling drop below the minimum
  const max = Math.max(PANEL_WIDTH_MIN, Math.min(720, Math.round(window.innerWidth * 0.6)))
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), max)
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  // static bounds only — clamping against the window here would bake a
  // transiently small viewport into the restored preference
  return Number.isFinite(saved) && saved > 0
    ? Math.min(Math.max(saved, PANEL_WIDTH_MIN), 720)
    : PANEL_WIDTH_DEFAULT
}

interface ToolActivity {
  name: string
  summary: string
  /** still executing: rendered as a spinner chip, replaced in place when the tool finishes */
  running?: boolean
  isError?: boolean
  output?: string
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  isError?: boolean
  /** the user stopped the turn before it finished */
  stopped?: boolean | undefined
  /** the turn streamed real text before it ended (a stop filler is not text) */
  streamedText?: boolean | undefined
  /** at least one tool mutated the document in this turn */
  mutated?: boolean | undefined
  /** UniWork AI: the transport is waiting out a Retry-After; the run goes on, Stop is the only action */
  waitLine?: string | undefined
  /** UniWork AI: restarted conversation / provider boundary / dropped call, shown above the answer */
  notes?: PanelNote[] | undefined
  /** the run failed and this user message was rolled back out of the model context */
  undelivered?: boolean
  tools?: ToolActivity[]
  /** interactive mind map from generate_mindmap's side-channel display (session-only;
   * the persisted transcript keeps the tool call, so a reopened file can regenerate) */
  mindmap?: MindMapTreeNode
  /** the selection this user message targeted, frozen at send */
  scope?: AiScopeQuoteData
  /** the edit fence of this user turn (selection scope or queue submission): a retry reuses it, never runs the turn unfenced */
  fence?: EntryFence
  /** restored from a stored transcript: no retry, its fence ranges are unknown */
  restored?: true
  /** answered ask_clarification cards of this message's run (view-only receipts) */
  clarifyReceipts?: ClarifyQa[][]
  /** tokens the provider billed for this reply, summed across its turns (absent when unreported) */
  usage?: AiTokenUsageView
}

/** longest selection excerpt echoed on a user bubble */
const SCOPE_TEXT_MAX = 200

/** structured, not the serialized file text: a body starting with `---` must
 *  never be re-parsed as a frontmatter block on rollback */
export interface DocSnapshot {
  /** document body as markdown */
  body: string
  /** raw frontmatter block (fences included), kept byte-for-byte */
  frontmatter: string
}

interface Snapshot {
  label: string
  time: string
  doc: DocSnapshot
  /** file names of the pictures the run saved beside the document (live: later tools of the same run append) */
  assets: string[]
  /** the loop run that took it, so an undo of that run can retire its Roll back entry */
  runId: string | null
}

/** Ribbon preset instruction; a new nonce triggers one auto-send */
export interface AiPreset {
  text: string
  nonce: number
}

export interface MarkdownAiDeps {
  getEditor(): Editor | null
  /** inner YAML of the properties block, read synchronously (write-then-read within one run) */
  getFrontmatter(): string
  /** replace the properties block; empty string removes it */
  setFrontmatter(inner: string): void
  /** document body + frontmatter, for pre-mutation snapshots */
  getSnapshot(): DocSnapshot
  /** rollback: replace the document (body and frontmatter) with a snapshot */
  restoreSnapshot(snapshot: DocSnapshot): void
  /**
   * fired when a run finishes. Returns the file name to offer saving under when the run changed a
   * never-saved document (the panel then asks, nothing is written), or null when no offer applies.
   */
  onRunDone(mutated: boolean): string | null
  /** the user chose Save on the offer card: run the first-save flow with this name */
  onSaveOffer(name: string): void
}

const MODEL_BRIDGE: AiModelPickerBridge = {
  getSettings: () => window.markdownApi?.getAiSettings?.() ?? Promise.resolve({} as AiSettings),
  setSettings: (settings, options) =>
    window.markdownApi?.setAiSettings?.(settings, options) ?? Promise.resolve({} as AiSettings),
  onSettingsChanged: (handler) => window.markdownApi?.onAiSettingsChanged?.(handler) ?? (() => {}),
  gskLoggedIn: () =>
    (window.markdownApi?.aiGskStatus?.() ?? Promise.resolve(null)).then((s) => !!s?.loggedIn),
  openModelSettings: () =>
    (window.markdownApi?.openAiModelSettings?.() ?? Promise.resolve()).catch(() => {}),
  // web frames: no key or no model keeps send off with a hint (see AiModelPicker)
  get requireModel() {
    return platform() === 'web'
  },
}

export function AiPanel({
  deps,
  filePath,
  preset,
  onCollapse,
  editQueue = [],
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  readOnly = false,
  open,
  onExpand,
}: {
  deps: MarkdownAiDeps
  filePath: string | null
  preset?: AiPreset | null
  onCollapse: () => void
  /** queued selection-scoped edits (owned by App, which also owns the anchors) */
  editQueue?: EditQueueItem[]
  onQueueEditInstruction?: (qid: string, instruction: string) => void
  onQueueRemove?: (qid: string) => void
  onQueueClear?: () => void
  onQueueFocus?: (qid: string) => void
  onQueueConsume?: (qids: string[]) => void
  /** a view-only UniWork document: the assistant reads and answers, it never edits */
  readOnly?: boolean
  /** false while the dock is collapsed (the panel stays mounted); reopening re-reads the cloud plan */
  open?: boolean
  /** expand the dock: a send refused while collapsed opens it so the reason can be shown */
  onExpand?: () => void
}): ReactElement {
  const { lang, t } = useI18n()
  // a picked UniWork AI that is not offered (or any provider still missing a model) keeps every
  // send entry closed - presets, retry, continue and queue runs included - the hint says why
  const needModelHint = useAiModelNeedHint()
  // the UniWork disclosure gate of every send entry: the composer feeds it, the queue pump asks it
  // silently, and presets, retry and continue refuse through the send entry (announce + focus)
  const uniworkGate = useUniworkSendGate()
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const [chat, setChat] = useState<ChatEntry[]>([])
  /** a streamed write stopped early: the draft stays in the document until the user keeps or discards it */
  const [activePartial, setActivePartial] = useState<{ blocks: number } | null>(null)
  const partialResolverRef = useRef<((keep: boolean) => void) | null>(null)
  /** ask_clarification card docked in the composer slot while the run waits for the user */
  const [activeClarify, setActiveClarify] = useState<ClarifyQuestion[] | null>(null)
  const clarifyResolverRef = useRef<((r: { answers: string; cancelled?: boolean }) => void) | null>(
    null,
  )
  /** settle an open card as skipped so the waiting tool call never dangles */
  const dismissClarify = (): void => {
    clarifyResolverRef.current?.({ answers: '', cancelled: true })
    clarifyResolverRef.current = null
    setActiveClarify(null)
  }
  const askClarification: AskClarification = (questions) =>
    new Promise((resolve) => {
      // a second card replaces a stale one; the stale call reads as skipped
      clarifyResolverRef.current?.({ answers: '', cancelled: true })
      clarifyResolverRef.current = resolve
      setActiveClarify(questions)
    })
  /** bumped by New chat / unmount: a writer resuming after its abort must not open the keep card */
  const writerEpochRef = useRef(0)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  /** messages queued while a reply runs; the pump re-runs them through send on settle */
  const msgQueue = useChatRunQueue<void>({
    busy,
    submit: (text) => {
      const loop = loopRef.current
      if (needModelHint !== null || !loop || loop.busy) return false
      // held until the user acknowledges the UniWork disclosure, as Send is
      if (uniworkGate.isBlocked()) return false
      // undefined retryOf = a new turn: the queue batch's own display text means
      // no selection quote is captured (the fork's edit-fence send signature)
      return send(text, text)
    },
  })
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  // bumped on selection/doc changes so the scope chip & queue rows stay fresh
  const [, setScopeTick] = useState(0)
  /** the scope chip's expandable preview of the selected text */
  const [scopePreviewOpen, setScopePreviewOpen] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = useRef(true)
  // preferred = the user's chosen width (the only value persisted); panelWidth =
  // what fits the current window. Deriving the display width from the preference
  // means a transiently small window never permanently shrinks the panel.
  const preferredWidthRef = useRef(loadPanelWidth())
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(preferredWidthRef.current))
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    const dock = asideRef.current?.closest('.ai-dock') as HTMLElement | null
    dock?.style.setProperty('--ai-panel-width', `${panelWidth}px`)
  }, [panelWidth])

  const settingsRef = useRef<AiSettings | null>(null)
  /** UniWork cloud sign-in state (signed in + entitled, from the shell main status) for the media tool gates */
  const { loggedInRef: gskLoggedInRef } = useCloudSignedIn(
    () => window.markdownApi.aiGskStatus?.(),
    open,
  )
  const langRef = useRef(lang)
  langRef.current = lang
  const depsRef = useRef(deps)
  depsRef.current = deps
  const filePathRef = useRef(filePath)
  /** instruction of the in-flight run, labels its rollback snapshot */
  const runInstructionRef = useRef('')
  /** what the user saw for that instruction (queue submissions show a summary) */
  const runDisplayRef = useRef('')
  /**
   * the run ended (done, error or stop): the fence ends with it. Its mapped ranges go on the
   * turn's user entry, so any retry of that entry (header or bubble) runs with the same fence.
   */
  const endRunFence = (editor: Editor): void => {
    const ranges = clearEditFence(editor)
    if (!ranges) return
    setChat((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const entry = prev[i]!
        if (entry.role !== 'user') continue
        const next = [...prev]
        next[i] = { ...entry, fence: { fenced: true, ranges } }
        return next
      }
      return prev
    })
  }
  const runMutatedRef = useRef(false)
  /** the ask-before-saving card of the last run; at most one, gone on the next send / New chat */
  const [saveOffer, setSaveOffer] = useState<{ name: string } | null>(null)
  /** pictures the in-flight run saved; the run's snapshot keeps this same array so Roll back can name them */
  const runAssetsRef = useRef<string[]>([])
  /** id of the in-flight loop run (the editor's undo step of that run carries it) */
  const runIdRef = useRef<string | null>(null)
  /** pictures each run saved, by run id: an undo of the run drops them like Roll back */
  const runAssetsByIdRef = useRef(new Map<string, string[]>())
  /** runs whose pictures an undo discarded: their redo would bring back dead image links */
  const discardedRunsRef = useRef(new Set<string>())
  const undoWatchRef = useRef<{ editor: Editor; stop: () => void } | null>(null)
  /** tool activity of the whole run, for transcript persistence */
  const runToolsRef = useRef<ToolActivity[]>([])
  /** tokens billed so far in the in-flight run (summed across turns) */
  const runUsageRef = useRef<AiTokenUsageView | undefined>(undefined)
  /** tokens billed across the panel's session (the composer chip) */
  const [sessionUsage, setSessionUsage] = useState<AiTokenUsageView | undefined>(undefined)
  const chatIdsRef = useRef<{ projectId: string; chatId: string } | null>(null)
  /** messages sent before resolveChat returned, flushed once the chat id is known */
  const pendingPersistRef = useRef<
    Array<{
      role: 'user' | 'assistant'
      text: string
      tools?: ToolActivity[]
      scope?: AiScopeQuoteData
    }>
  >([])

  const patchLast = (patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>)) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }
      return next
    })
  }

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ToolActivity[],
    scope?: AiScopeQuoteData,
  ) => {
    const ids = chatIdsRef.current
    if (!window.projectApi) return
    if (!ids) {
      pendingPersistRef.current.push({ role, text, tools, scope })
      return
    }
    void window.projectApi
      .appendChat({
        projectId: ids.projectId,
        chatId: ids.chatId,
        role,
        text,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(scope ? { scope } : {}),
      })
      .catch(() => {
        /* persistence failures are silent */
      })
  }

  const transportRef = useRef<ReturnType<typeof createElectronTransport> | null>(null)
  if (!transportRef.current)
    transportRef.current = createElectronTransport(() => settingsRef.current!)

  /**
   * Long-form writing: one tool-less request whose reply is the markdown, streamed
   * into the document as a draft by the tool. A stream that stops early leaves the
   * user a keep-or-discard choice; a stream that produced nothing is retried once.
   */
  const runDocWriter = async (
    spec: DocWriteSpec,
    onProgress: (markdown: string) => void,
    signal?: AbortSignal,
  ): Promise<DocWriteResult> => {
    const { system, user } = buildDocWriterRequest(
      spec,
      MARKDOWN_RULES,
      aiLangDirective(langRef.current),
    )
    const epoch = writerEpochRef.current
    let closed = false
    let chipTimer: ReturnType<typeof setTimeout> | null = null
    let latest = ''
    const updateChip = () => {
      chipTimer = null
      if (closed) return
      const blocks = countMarkdownBlocks(latest)
      patchLast((last) => ({
        tools: last.tools?.map((tl) =>
          tl.running ? { ...tl, summary: tGlobal('aiWritingDocument', { blocks }) } : tl,
        ),
      }))
    }
    const attempt = () =>
      streamText({
        transport: transportRef.current!,
        system,
        user,
        signal,
        maxChars: DOC_MAX_CHARS,
        extract: (raw) => ({ text: extractMarkdown(raw) }),
        onProgress: (markdown) => {
          if (closed) return
          latest = markdown
          onProgress(markdown)
          if (chipTimer === null) chipTimer = setTimeout(updateChip, CHIP_UPDATE_MS)
        },
      })
    let outcome = await attempt()
    if (outcome.status === 'empty' && !signal?.aborted) outcome = await attempt()
    closed = true
    if (chipTimer !== null) clearTimeout(chipTimer)
    if (outcome.status === 'complete') return { ok: true, markdown: outcome.text }
    if (outcome.status === 'empty') return { ok: false, error: outcome.error }
    if (epoch !== writerEpochRef.current) return { ok: false, error: 'the chat was reset' }
    // the draft stays in the document while the user decides
    const keep = await new Promise<boolean>((resolve) => {
      partialResolverRef.current = resolve
      setActivePartial({ blocks: countMarkdownBlocks(outcome.text) })
    })
    return keep
      ? { ok: true, markdown: outcome.text, truncated: true }
      : {
          ok: false,
          error: `${outcome.reason}${outcome.error ? `: ${outcome.error}` : ''}; the user discarded the partial content`,
        }
  }
  const runDocWriterRef = useRef(runDocWriter)
  runDocWriterRef.current = runDocWriter

  const decidePartial = (keep: boolean): void => {
    partialResolverRef.current?.(keep)
    partialResolverRef.current = null
    setActivePartial(null)
  }
  /** New chat / unmount: discard an open keep card and keep a still-settling writer from opening one */
  const abandonWriter = (): void => {
    writerEpochRef.current++
    decidePartial(false)
  }
  useEffect(
    () => () => {
      writerEpochRef.current++
    },
    [],
  )

  /** discard the pending pictures a Roll back or an undo of a run drops (desktop; main keeps what is saved) */
  const discardPictures = (names: Iterable<string>): void => {
    const list = [...new Set(names)]
    if (list.length > 0) void window.markdownApi?.discardPendingAssets?.(list)?.catch(() => {})
  }
  /** the editor-side undo group of a loop run, resolved at call time (the loop is built once) */
  const runGroup: RunHistoryGroup = {
    get activeRunId() {
      const ed = depsRef.current.getEditor()
      return ed ? runHistoryOf(ed).activeRunId : null
    },
    begin: (runId) => {
      runIdRef.current = runId
      runAssetsByIdRef.current.set(runId, runAssetsRef.current)
      const ed = depsRef.current.getEditor()
      if (!ed) return
      watchUndo(ed)
      runHistoryOf(ed).begin(runId)
    },
    end: (runId, mutated) => {
      const ed = depsRef.current.getEditor()
      if (ed) runHistoryOf(ed).end(runId, mutated)
    },
  }
  /**
   * Ctrl/Cmd+Z of a run's step (anywhere in the app) drops the pictures that run saved, exactly
   * like Roll back; its Roll back entry goes with it. A redo of such a run is refused: the files
   * are gone, and the markup would point at nothing.
   */
  function watchUndo(editor: Editor): void {
    if (undoWatchRef.current?.editor === editor) return
    undoWatchRef.current?.stop()
    const stopListening = onRunHistoryChange(editor, ({ runId, direction }) => {
      if (direction !== 'undo') return
      const names = runAssetsByIdRef.current.get(runId) ?? []
      if (names.length > 0) discardedRunsRef.current.add(runId)
      discardPictures(names)
      setSnapshots((prev) => prev.filter((s) => s.runId !== runId))
    })
    runHistoryOf(editor).refuseRedo((runId) => discardedRunsRef.current.has(runId))
    undoWatchRef.current = {
      editor,
      stop: () => {
        stopListening()
        if (!editor.isDestroyed) runHistoryOf(editor).refuseRedo(null)
      },
    }
  }

  // The loop is built once; every mutable value goes through a ref getter
  const loopRef = useRef<AgentLoop<DocSnapshot> | null>(null)
  if (!loopRef.current) {
    loopRef.current = new AgentLoop<DocSnapshot>({
      transport: transportRef.current,
      skill: composeSkills('markdown+search', '', [
        createMarkdownSkill(
          () => depsRef.current.getEditor(),
          {
            read: () => depsRef.current.getFrontmatter(),
            write: (inner) => depsRef.current.setFrontmatter(inner),
          },
          () =>
            cap('imageGeneration') &&
            imageGenerationAvailable(settingsRef.current, gskLoggedInRef.current),
          () => ({
            write: (spec, onProgress, signal) => runDocWriterRef.current(spec, onProgress, signal),
          }),
          () => readOnlyRef.current,
          () => askClarification,
          (rel) => runAssetsRef.current.push(assetFileName(rel)),
        ),
        createSearchSkill(),
      ]),
      captureSnapshot: () => depsRef.current.getSnapshot(),
      systemSuffix: () => aiLangDirective(langRef.current),
      events: {
        // every edit of a run is ONE undo step of the editor (the group closes at run end)
        ...runHistoryEvents(runGroup),
        onText: (text) => patchLast({ text, waitLine: undefined }),
        // transport notices (UniWork AI); langRef: the loop is created once, `lang` would go stale
        onNotice: (notice) => {
          // the question was not sent: it goes back into the composer for the user to send again
          if (notice.kind === 'conversation-restarted')
            setPrompt((current) => current || runDisplayRef.current)
          patchLast(
            (last) =>
              noticePatch(
                last,
                notice,
                (key, params) => aiUniworkText(langRef.current, key, params),
                'Markdown',
              ) ?? {},
          )
        },
        onToolStart: (call) => {
          // Live "running" chip: replaced in place by onToolExecuted
          patchLast((last) => ({
            tools: [
              ...(last.tools ?? []),
              { name: call.name, summary: call.name.replace(/[_-]+/g, ' '), running: true },
            ],
          }))
        },
        onToolExecuted: ({ call, execution, snapshotBefore }) => {
          if (execution.mutated) runMutatedRef.current = true
          if (snapshotBefore !== undefined) {
            const label = runInstructionRef.current.slice(0, 40)
            const time = new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
            setSnapshots((prev) =>
              [
                ...prev,
                {
                  label,
                  time,
                  doc: snapshotBefore,
                  assets: runAssetsRef.current,
                  runId: runIdRef.current,
                },
              ].slice(-MAX_SNAPSHOTS),
            )
          }
          // mind maps ride the UI-only display side channel onto the message
          const display = execution.display
          const mindmap = display?.kind === 'mindmap' ? display.tree : undefined
          const activity: ToolActivity = {
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            output: execution.output?.slice(0, TOOL_OUTPUT_MAX_CHARS),
          }
          runToolsRef.current.push(activity)
          patchLast((last) => {
            // Swap out the running placeholder pushed by onToolStart (parse-fail calls have none)
            const tools = [...(last.tools ?? [])]
            if (tools.at(-1)?.running) tools.pop()
            return { tools: [...tools, activity], ...(mindmap ? { mindmap } : {}) }
          })
        },
        onTurnEnd: () => {
          patchLast({ streaming: false, waitLine: undefined })
          setChat((prev) => [...prev, { role: 'assistant', text: '', streaming: true }])
        },
        onUsage: (usage) => {
          runUsageRef.current = addTokenUsage(runUsageRef.current, usage)
          setSessionUsage((prev) => addTokenUsage(prev, usage))
          patchLast({ usage: runUsageRef.current })
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          const base = turnLimit
            ? [text, tGlobal('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tGlobal('aiStopped') : '')
          // A reasoning model can spend the entire output budget on thinking and close the
          // turn with finish_reason=length and no prose at all — the bare "(no reply)" read
          // as the assistant ignoring the user. Name the truncation, as docs already does.
          const final = truncated
            ? [base, tGlobal('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : base
          patchLast((last) => ({
            streaming: false,
            stopped: cancelled,
            streamedText: Boolean(text?.trim()),
            mutated: runMutatedRef.current,
            waitLine: undefined,
            // a restarted conversation or UniWork AI being off ends the turn on purpose: the note is the whole reply
            text:
              final ||
              (last.tools?.length || endsQuietly(last.notes) ? last.text : tGlobal('aiNoReply')),
            // A stop mid-tool can leave a running placeholder behind — drop it
            tools: last.tools?.filter((tl) => !tl.running),
          }))
          persistMessage('assistant', final, runToolsRef.current)
          const editor = depsRef.current.getEditor()
          if (editor) {
            clearAiHighlights(editor)
            endRunFence(editor)
          }
          // an offer only for an unsaved document the run changed: one card, replacing any older one
          const offer = depsRef.current.onRunDone(runMutatedRef.current)
          setSaveOffer(typeof offer === 'string' ? { name: offer } : null)
          setBusy(false)
        },
        onError: (error) => {
          // a refused question (too long, rejected) is no send failure to retry as is: it goes back
          // into the composer to be shortened or fixed, as the message says
          const refused = isUniworkQuestionRefusal(error)
          if (refused) setPrompt((current) => current || runDisplayRef.current)
          const editor = depsRef.current.getEditor()
          if (editor) endRunFence(editor)
          setChat((prev) => {
            const next = [...prev]
            for (let i = next.length - 1; i >= 0; i--) {
              const entry = next[i]!
              if (entry.role === 'user') {
                // a setup state (no key / no model) is not a send failure: no "not sent" pill
                next[i] = aiNoticeKind(error) || refused ? entry : { ...entry, undelivered: true }
                break
              }
            }
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                waitLine: undefined,
                text: error,
                isError: true,
                tools: last.tools?.filter((tl) => !tl.running),
              }
            }
            return next
          })
          setBusy(false)
        },
      },
    })
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      partialResolverRef.current?.(false)
      clarifyResolverRef.current?.({ answers: '', cancelled: true })
      clarifyResolverRef.current = null
      loopRef.current?.cancel()
      undoWatchRef.current?.stop()
      undoWatchRef.current = null
      const editor = depsRef.current.getEditor()
      if (editor) {
        clearAiHighlights(editor)
        clearEditFence(editor)
      }
    }
  }, [])

  // ── chat-history persistence: bind to the file, restore prior transcript ──
  useEffect(() => {
    const api = window.projectApi
    if (!api) return
    const tempChatId = `unsaved-${Date.now()}`
    void api
      .resolveChat({ filePath: filePathRef.current ?? null, tempChatId })
      .then((ids) => {
        chatIdsRef.current = ids
        for (const msg of pendingPersistRef.current.splice(0)) {
          persistMessage(msg.role, msg.text, msg.tools, msg.scope)
        }
        return api.loadChat({ projectId: ids.projectId, chatId: ids.chatId, limit: 200 })
      })
      .then((msgs) => {
        if (msgs.length === 0) return
        // the user may have sent a message while history was loading — never
        // replace a live transcript (and don't clobber the loop context)
        let applied = false
        setChat((prev) => {
          if (prev.length > 0) return prev
          applied = true
          return msgs.map((m) => ({
            role: m.role,
            text: m.text,
            tools: m.tools?.map((tool) => ({
              name: tool.name,
              summary: tool.summary,
              isError: tool.isError,
              output: tool.output ? tool.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
            })),
            ...(m.scope ? { scope: m.scope } : {}),
            ...restoredEntryState(m.role),
          }))
        })
        if (applied) setChat((prev) => withoutReceipts(prev))
        if (applied && !loopRef.current?.busy) {
          loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
        }
      })
      .catch(() => {
        /* history load failures are silent */
      })
  }, [])

  /** after an untitled document's first save, bind the unsaved-* history to the real path */
  // answered receipts belong to the document they were given for: drop them when another
  // one opens (an untitled document getting its first path is the same document)
  useEffect(() => {
    const previous = filePathRef.current
    if (previous && previous !== filePath) setChat((prev) => withoutReceipts(prev))
  }, [filePath])

  useEffect(() => {
    filePathRef.current = filePath
    const ids = chatIdsRef.current
    if (!window.projectApi || !ids || !filePath || !ids.chatId.startsWith('unsaved-')) return
    void window.projectApi
      .rebindChat({ projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: filePath })
      .then((r) => {
        if (r?.chatId) chatIdsRef.current = r
      })
      .catch(() => {
        /* silent */
      })
  }, [filePath])

  useEffect(() => {
    if (stickToBottomRef.current) {
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
    }
  }, [chat, busy])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  /**
   * retryOf: the user entry being retried (its scope quote and fence); undefined = a new turn,
   * which captures the live selection. queueFence: the anchored ranges of a queue submission.
   */
  const send = (
    text: string,
    displayText?: string,
    retryOf?: Pick<ChatEntry, 'scope' | 'fence'>,
    queueFence?: FenceRange[],
  ): boolean => {
    const instruction = text.trim()
    const loop = loopRef.current
    if (needModelHint !== null || !instruction || !loop || loop.busy) return false
    // presets, retry and continue refuse like Send until the UniWork disclosure is acknowledged
    if (uniworkGate.refuse()) return false
    stickToBottomRef.current = true
    runInstructionRef.current = instruction
    runDisplayRef.current = displayText ?? instruction
    runMutatedRef.current = false
    setSaveOffer(null)
    runAssetsRef.current = []
    runToolsRef.current = []
    runUsageRef.current = undefined
    // a queue batch carries its own display text: no selection quote
    const scope = retryOf
      ? retryOf.scope
      : displayText === undefined
        ? selectionScopeQuote()
        : undefined
    // a scoped send (selection chip) or a queue submission may only edit its targets; tools
    // enforce it in code. A new turn is fenced to its own scope; a retry, header or bubble, to
    // the ranges its entry's run ended with, so a fenced turn is never retried unfenced.
    const ed = depsRef.current.getEditor()
    const fence = retryOf
      ? retryFence(retryOf.fence ?? { fenced: scope !== undefined })
      : ed
        ? turnFence(ed, { scoped: scope !== undefined, queueFence })
        : null
    if (ed) setEditFence(ed, fence)
    // the popover input / composer own the DOM selection now: keep the targeted range visible until the run ends
    if (scope) setInactiveSelectionShown(depsRef.current.getEditor(), true)
    setChat((prev) => [
      ...prev,
      {
        role: 'user',
        text: displayText ?? instruction,
        ...(scope ? { scope } : {}),
        ...(fence ? { fence: { fenced: true, ranges: fence } } : {}),
      },
      { role: 'assistant', text: '', streaming: true },
    ])
    setPrompt('')
    setBusy(true)
    // persist what the user saw — a restored transcript must not surface the
    // internal batch protocol text behind a queue submission
    persistMessage('user', displayText ?? instruction, undefined, scope)
    void (async () => {
      try {
        const s = await window.markdownApi?.getAiSettings?.()
        if (s) settingsRef.current = s
        setProvider(s?.provider ?? settingsRef.current?.provider)
        if (!mountedRef.current) return
        await loop.run(instruction)
      } catch (err) {
        if (!mountedRef.current) return
        const editor = depsRef.current.getEditor()
        if (editor) endRunFence(editor)
        patchLast({
          streaming: false,
          text: err instanceof Error ? err.message : String(err),
          isError: true,
        })
        setBusy(false)
      }
    })()
    return true
  }

  const stop = (): void => {
    dismissClarify()
    loopRef.current?.cancel()
    inputRef.current?.focus()
  }

  /** Enter while a reply runs: the draft joins the queue above the composer */
  const enqueueDraft = () => {
    const text = prompt.trim()
    if (!text) return
    msgQueue.enqueue(text, undefined)
    setPrompt('')
  }

  const retry = (): void => {
    send(
      runInstructionRef.current,
      runDisplayRef.current,
      chat.findLast((entry) => entry.role === 'user') ?? {},
    )
  }

  // keep the scope chip & queue rows in sync with the editor selection/content
  useEffect(() => {
    const editor = depsRef.current.getEditor()
    if (!editor) return
    const bump = () => {
      if (editor.state.selection.empty) setScopePreviewOpen(false)
      setScopeTick((tick) => tick + 1)
    }
    editor.on('selectionUpdate', bump)
    editor.on('update', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('update', bump)
    }
  }, [])

  // scope chip data, recomputed per render (the scope tick above keeps it fresh)
  const editor = depsRef.current.getEditor()
  const liveSelection = editor?.state.selection
  const selectionText =
    !editor || !liveSelection || liveSelection.empty
      ? ''
      : editor.state.doc.textBetween(liveSelection.from, liveSelection.to, '\n', ' ').trim()
  const hasScopeSelection = selectionText.length > 0

  /** the × on the scope chip: collapse the selection so the run targets the whole document */
  const clearScopeSelection = (): void => {
    if (editor) editor.commands.setTextSelection(editor.state.selection.to)
  }

  const selectionScopeQuote = (): AiScopeQuoteData | undefined => {
    const ed = depsRef.current.getEditor()
    if (!ed || ed.state.selection.empty) return undefined
    const { from, to } = ed.state.selection
    const text = ed.state.doc.textBetween(from, to, ' ', ' ').replace(/\s+/g, ' ').trim()
    if (!text) return undefined
    return {
      label: t('aiScopeSelection', { words: countWords(text) }),
      text: text.length > SCOPE_TEXT_MAX ? `${text.slice(0, SCOPE_TEXT_MAX)}…` : text,
    }
  }

  // the frozen-range highlight ends with the run, or as soon as the editor is focused again
  useEffect(() => {
    if (!busy) setInactiveSelectionShown(depsRef.current.getEditor(), false)
  }, [busy])
  useEffect(() => {
    const ed = depsRef.current.getEditor()
    if (!ed) return
    const off = () => setInactiveSelectionShown(ed, false)
    ed.on('focus', off)
    return () => {
      ed.off('focus', off)
    }
  }, [])

  /** [label](mdnav://block/N) links in replies select and scroll to that block */
  const docNav = {
    scheme: DOC_NAV_SCHEME,
    onNavigate: (href: string) => {
      const index = parseDocNavHref(href)
      const current = depsRef.current.getEditor()
      if (index !== null && current) navigateToBlock(current, index)
    },
  }

  /** submit every still-anchored queued edit as one batch run */
  const sendQueue = (): void => {
    const loop = loopRef.current
    const current = depsRef.current.getEditor()
    if (!loop || loop.busy || editQueue.length === 0 || !current) return
    const entries = liveItems(resolveQueue(current, editQueue))
    if (entries.length === 0) {
      onQueueClear?.()
      return
    }
    const instruction = buildQueueInstruction(entries)
    const display = buildQueueSummary(t('aiQueueSubmitted', { count: entries.length }), entries)
    const fence = entries
      .map((entry) => queueAnchorRange(current.state, entry.item.qid))
      .filter((range): range is FenceRange => range !== null)
    // consumed at send: the run rewrites the anchored passages, which would
    // orphan the anchors anyway; a failed run is retried via the retry action
    onQueueConsume?.(editQueue.map((item) => item.qid))
    send(instruction, display, undefined, fence)
  }

  // ribbon presets auto-send; while a run is active they land in the composer instead
  const presetNonceRef = useRef(0)
  useEffect(() => {
    if (!preset || preset.nonce === presetNonceRef.current) return
    presetNonceRef.current = preset.nonce
    if (loopRef.current?.busy) setPrompt(preset.text)
    else send(preset.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const copyMessage = (text: string, idx: number): void => {
    void navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200)
  }

  const rollback = (snapshot: Snapshot): void => {
    if (busy) return
    depsRef.current.restoreSnapshot(snapshot.doc)
    // the document is back to before this run (and every later one): their pictures are no longer
    // in it. Only files a run saved are named, so a picture the user added or one already saved
    // with the document is never touched; the main process drops what is still pending.
    const from = snapshots.indexOf(snapshot)
    discardPictures((from < 0 ? [snapshot] : snapshots.slice(from)).flatMap((s) => s.assets))
    setSnapshots((prev) => prev.filter((s) => s !== snapshot))
  }

  // Re-derive the display width on window resize (max is 60% of the window);
  // growing the window back restores the preferred width
  useEffect(() => {
    const onResize = (): void => setPanelWidth(clampPanelWidth(preferredWidthRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanupRef.current?.(), [])

  const [provider, setProvider] = useState<string | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const sync = () => {
      void window.markdownApi
        ?.getAiSettings?.()
        ?.then((s) => {
          if (!alive) return
          settingsRef.current = s
          setProvider(s?.provider)
        })
        .catch(() => {})
    }
    sync()
    const off = window.markdownApi?.onAiSettingsChanged?.(sync)
    window.addEventListener('focus', sync)
    return () => {
      alive = false
      off?.()
      window.removeEventListener('focus', sync)
    }
  }, [open])

  const isUniwork = provider === 'uniwork'

  const [cloudSnapshot, setCloudSnapshot] = useState<UniworkCloudStatusSnapshot | null>(null)
  const [composerAnnouncement, setComposerAnnouncement] = useState('')
  // the model picker's list note, written into the panel's own polite node (never a node of the
  // picker's); it stands while the announcement it was written over is the current one
  const [pickerNote, setPickerNote] = useState<{ text: string; over: string } | null>(null)
  useEffect(() => {
    const bridge = readUniworkCloudStatus()
    if (!bridge) return
    let cancelled = false
    void bridge
      .get()
      .then((snap) => {
        if (!cancelled) setCloudSnapshot(snap)
      })
      .catch(() => {})
    const off = bridge.onChange?.((snap) => {
      if (!cancelled) setCloudSnapshot(snap)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [open])

  const composerNoteState = composerNoteFor({
    provider: provider ?? settingsRef.current?.provider ?? undefined,
    cloudState: cloudSnapshot?.state ?? null,
    signedOut: cloudSnapshot ? !cloudSnapshot.signedIn : undefined,
  })
  // the disclosure gate must not depend on the composer being mounted (collapsed rail): the panel
  // reads the same ack key itself, so a ribbon action that fires while collapsed is refused too
  const { acked: uniworkDisclosureAcked } = useUniworkDisclosureAck(
    isUniwork
      ? {
          account: cloudSnapshot?.accountId ?? '',
          org: cloudSnapshot?.orgId ?? '',
          document: filePath ?? 'local',
        }
      : null,
  )
  uniworkGate.setPanelBlocked(isUniwork && !uniworkDisclosureAcked)
  // a refusal while collapsed expands the panel; once open it announces and focuses the disclosure
  const panelOpen = open !== false
  uniworkGate.setPanelOpen(panelOpen, onExpand)
  useEffect(() => {
    if (panelOpen) uniworkGate.flushPendingRefusal()
  }, [panelOpen, uniworkGate])

  const lastEntry = chat.at(-1)
  const panelLiveAnnouncement =
    chat.length > 0 || busy
      ? computePanelLiveAnnouncement({
          entries: chat,
          busy,
          translate: (key, vars) => aiUniworkText(lang, key, vars),
          lastEntryChipInput:
            lastEntry && lastEntry.role === 'assistant'
              ? {
                  provider: provider ?? settingsRef.current?.provider ?? null,
                  mutated: Boolean(lastEntry.mutated),
                  stopped: Boolean(lastEntry.stopped),
                  hasStreamedText: lastEntry.streamedText ?? Boolean(lastEntry.text?.trim()),
                  clarifyAsked: chat.some((c) => Boolean(c.clarifyReceipts?.length)),
                  notes: lastEntry.notes,
                  droppedToolCalls: droppedCallsOfNotes(lastEntry.notes),
                  toolExecutions: lastEntry.tools,
                  isError: Boolean(lastEntry.isError),
                  error: lastEntry.isError ? uniworkErrorForChip(lastEntry.text) : null,
                }
              : null,
        })
      : composerAnnouncement

  /** Drag the inner panel edge to resize from the selected window side. */
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const resizer = e.currentTarget
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent): void => {
      const w = clampPanelWidth(aiPanelWidthAtPointer(ev.clientX))
      preferredWidthRef.current = w
      setPanelWidth(w)
    }
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      resizeCleanupRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      resizer.removeEventListener('lostpointercapture', cleanup)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(preferredWidthRef.current)))
    }
    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    resizer.addEventListener('lostpointercapture', cleanup)
    resizer.setPointerCapture(e.pointerId)
  }

  const liveText =
    pickerNote && pickerNote.over === panelLiveAnnouncement
      ? pickerNote.text
      : panelLiveAnnouncement
  return (
    <aside
      ref={asideRef}
      className={`copilot${resizing ? ' ai-panel-resizing' : ''}`}
      style={{ width: '100%' }}
      dir={lang === 'ar' || lang === 'he' ? 'rtl' : undefined}
    >
      <div
        className="ai-panel-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="UniAI"
      />
      <header className="ai-panel-header">
        <span className="ai-panel-title">
          <UniAiMark size={22} />
          UniAI
        </span>
        <div className="ai-panel-header-actions">
          <AiPanelSideButton
            lang={lang}
            onMove={(side) => window.markdownApi.setAiPanelPrefs({ side })}
          />
          {chat.length > 0 && (
            <button
              className="ai-header-btn"
              onClick={() => {
                stop()
                abandonWriter()
                msgQueue.clear()
                loopRef.current?.reset()
                setBusy(false)
                setSaveOffer(null)
                setChat([])
              }}
              data-tip={t('aiNewChat')}
              aria-label={t('aiNewChat')}
            >
              <IconNewChat />
            </button>
          )}
          {cap('aiCredentials') && window.markdownApi.openAiSettings && (
            <button
              className="ai-header-btn"
              onClick={() => void window.markdownApi.openAiSettings?.()}
              data-tip={t('aiSettings')}
              aria-label={t('aiSettings')}
            >
              <IconGear />
            </button>
          )}
          <button
            className="ai-header-btn ai-panel-collapse"
            onClick={onCollapse}
            data-tip={t('aiCollapsePanel')}
            aria-label={t('aiCollapsePanel')}
          >
            <IconCollapse />
          </button>
        </div>
      </header>

      <div className="ai-sr-status" aria-live="polite" aria-atomic="true">
        {liveText}
      </div>
      <div
        className="ai-chat"
        ref={chatRef}
        aria-busy={busy ? 'true' : undefined}
        onScroll={onChatScroll}
      >
        {chat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-title">{t('aiEmptyTitle')}</div>
            <div className="ai-chat-empty-body">{t('aiEmptyBody')}</div>
            <div className="ai-starter-list">
              <button
                className="ai-starter"
                onClick={() => {
                  setPrompt(t('aiQuickDraftPrompt'))
                  inputRef.current?.focus()
                }}
              >
                {t('aiQuickDraft')}
              </button>
              <button
                className="ai-starter"
                onClick={() => {
                  setPrompt(t('aiQuickPolishPrompt'))
                  inputRef.current?.focus()
                }}
              >
                {t('aiQuickPolish')}
              </button>
              <button
                className="ai-starter"
                onClick={() => {
                  setPrompt(t('aiQuickMindMapPrompt'))
                  inputRef.current?.focus()
                }}
              >
                {t('aiQuickMindMap')}
              </button>
            </div>
          </div>
        )}
        {chat.map((entry, i) => {
          if (entry.role === 'user') {
            // a UniWork error turn carries its own labelled S9 action (Retry only where the table allows
            // it), so the "not sent" bubble adds no Retry of its own; failures of other providers keep it
            const next = chat[i + 1]
            const uniworkErrorFollows =
              next?.role === 'assistant' &&
              Boolean(next.isError) &&
              uniworkErrorKeyOfText(next.text) !== null
            return (
              <div key={i} className="ai-msg ai-msg-user">
                {entry.scope && <AiScopeQuote scope={entry.scope} />}
                <span dir="auto">{entry.text}</span>
                {entry.clarifyReceipts?.map((qa, k) => (
                  <div key={`ca${k}`} className="ai-clarify-answered">
                    {qa.map((pair, m) => (
                      <div key={m} className="ai-clarify-answered-row">
                        <div className="ai-clarify-answered-q">{pair.q}</div>
                        <div className="ai-clarify-answered-a">{pair.a}</div>
                      </div>
                    ))}
                  </div>
                ))}
                {entry.undelivered && (
                  <div className="ai-msg-undelivered">
                    {t('aiUndelivered')}
                    {canRetryEntry(entry, busy) && !uniworkErrorFollows && (
                      <button
                        className="ai-retry-btn"
                        onClick={() => send(entry.text, undefined, entry)}
                      >
                        {t('aiRetry')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          }
          const hasTools = (entry.tools?.length ?? 0) > 0
          if (
            !entry.text &&
            !entry.streaming &&
            !hasTools &&
            !entry.notes?.length &&
            !entry.stopped &&
            !entry.mutated
          )
            return null
          const isLast = i === chat.length - 1
          // Action row appears once per completed reply: on the turn's final segment only
          // (mid-turn segments have a following assistant entry; the live turn ends when !busy)
          const turnEnded = isTurnEnded(chat, i, busy)
          const showToolbar = !entry.streaming && turnEnded && !!entry.text && !entry.isError
          const chipView = getEntryResultChipView(
            chat,
            i,
            busy,
            (key, vars) => aiUniworkText(lang, key, vars),
            {
              provider: provider ?? settingsRef.current?.provider ?? null,
              mutated: Boolean(entry.mutated),
              stopped: Boolean(entry.stopped),
              hasStreamedText: entry.streamedText ?? Boolean(entry.text?.trim()),
              clarifyAsked: chat.some((c) => Boolean(c.clarifyReceipts?.length)),
              notes: entry.notes,
              droppedToolCalls: droppedCallsOfNotes(entry.notes),
              toolExecutions: entry.tools,
              isError: Boolean(entry.isError),
              error: entry.isError ? uniworkErrorForChip(entry.text) : null,
            },
          )
          const chip = chipView?.chip ?? null
          const chipLabel = chipView?.labelText ?? null
          const stoppedText = chipView?.stoppedText ?? null
          // a stop before the first token leaves only the stop filler as body: the stopped line replaces it
          const bodyText =
            stoppedText && entry.stopped && entry.streamedText === false ? '' : entry.text
          // the chip is the first word of the answer paragraph, in the same node as the text
          const chipLead =
            chip && chipLabel ? (
              <>
                <span className="ai-result-chip" data-chip={chip.chip} data-tone={chip.tone}>
                  {chipLabel}
                </span>
                {bodyText ? <span className="ai-result-chip-sep">: </span> : null}
              </>
            ) : undefined
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-assistant${entry.isError && !aiNoticeKind(entry.text) ? ' ai-msg-error' : ''}${entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              <div className="ai-msg-live">
                {entry.notes?.map((note, k) => (
                  <div key={`un${k}`} className="ai-msg-notice">
                    {note.text}
                  </div>
                ))}
                {entry.waitLine && <div className="ai-msg-notice">{entry.waitLine}</div>}
              </div>
              {!entry.text && entry.streaming ? (
                <span className="ai-typing-row">
                  <AiTypingIndicator label={hasTools ? t('aiWorking') : t('aiThinking')} />
                </span>
              ) : (
                (bodyText || chip) && (
                  <div className="ai-msg-answer" dir="auto">
                    {(bodyText || chipLead) && (
                      <Markdown
                        text={bodyText ? aiNoticeBody(bodyText) : ''}
                        nav={docNav}
                        lead={chipLead}
                      />
                    )}
                    {chip?.chip === 'edited' && (
                      <div className="ai-result-actions">
                        <button
                          type="button"
                          className="ai-result-view-changes"
                          onClick={() => {
                            const ed = depsRef.current.getEditor()
                            if (ed) navigateToBlock(ed, 0)
                          }}
                        >
                          {aiUniworkText(lang, 'aiResultViewChanges')}
                        </button>
                        <span className="ai-result-edited-hint">
                          {singleShortcutHint(aiUniworkText(lang, 'aiResultEditedHint'))}
                        </span>
                      </div>
                    )}
                  </div>
                )
              )}
              <AiErrorAction
                chip={chip}
                lang={lang}
                waiting={Boolean(entry.waitLine)}
                onRetry={isLast && !busy && runInstructionRef.current ? retry : undefined}
                onChooseProvider={() => void window.markdownApi?.openAiModelSettings?.()}
                onSignIn={() => void readUniworkCloudStatus()?.signIn?.()}
                onAskAgain={isLast && !busy ? () => inputRef.current?.focus() : undefined}
              />
              {stoppedText && (
                <div className="ai-run-stopped" dir="auto">
                  {stoppedText}
                </div>
              )}
              {hasTools && <ToolChipList tools={entry.tools!} />}
              {entry.usage && (
                <div className="ai-message-usage">
                  <AiUsageChip usage={entry.usage} lang={lang} />
                </div>
              )}
              {entry.mindmap && (
                <MindMapCard
                  tree={entry.mindmap}
                  onAsk={(label) => {
                    setPrompt(t('aiMindMapAskPrompt', { label }))
                    inputRef.current?.focus()
                  }}
                  onJumpBlock={(index) => {
                    const current = depsRef.current.getEditor()
                    if (current) navigateToBlock(current, index)
                  }}
                />
              )}
              {showToolbar && (
                <div className="ai-msg-toolbar">
                  <button
                    className="ai-msg-tool-btn"
                    onClick={() => copyMessage(entry.text, i)}
                    aria-label={t('aiCopyReplyTitle')}
                    data-tip={t('aiCopyReplyTitle')}
                  >
                    {copiedIdx === i ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path
                          d="M14.6113 5.34253C16.0608 5.3428 17.2363 6.518 17.2363 7.96753V15.5066C17.2361 16.956 16.0607 18.1313 14.6113 18.1316H7.07227C5.62267 18.1316 4.44751 16.9561 4.44727 15.5066V7.96753C4.44732 6.51783 5.62255 5.34253 7.07227 5.34253H14.6113ZM7.07227 6.59253C6.31291 6.59253 5.69732 7.20819 5.69727 7.96753V15.5066C5.69751 16.2658 6.31302 16.8816 7.07227 16.8816H14.6113C15.3703 16.8813 15.9861 16.2656 15.9863 15.5066V7.96753C15.9863 7.20835 15.3705 6.5928 14.6113 6.59253H7.07227ZM10.0176 2.8689C10.3626 2.86905 10.6426 3.14882 10.6426 3.4939C10.6425 3.83888 10.3626 4.11874 10.0176 4.1189H4.59961C3.84022 4.1189 3.22461 4.73451 3.22461 5.4939V11.324C3.22433 11.6689 2.94461 11.949 2.59961 11.949C2.25461 11.949 1.97489 11.6689 1.97461 11.324V5.4939C1.97461 4.04415 3.14987 2.8689 4.59961 2.8689H10.0176Z"
                          fill="currentColor"
                        />
                      </svg>
                    )}
                  </button>
                  {isLast && !busy && runInstructionRef.current && (
                    <button
                      className="ai-msg-tool-btn"
                      onClick={retry}
                      aria-label={t('aiRegenerateTitle')}
                      data-tip={t('aiRegenerateTitle')}
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M 12.68 6.65 a 4.86 4.86 0 0 0 -9 -1.08 M 3.32 9.35 a 4.86 4.86 0 0 0 9 1.08" />
                        <path d="M 12.95 3.05 v 2.7 h -2.7 M 3.05 12.95 v -2.7 h 2.7" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {saveOffer && !busy && (
          <AiSaveDraftCard
            lang={lang}
            name={saveOffer.name}
            onSave={() => {
              const { name } = saveOffer
              setSaveOffer(null)
              depsRef.current.onSaveOffer(name)
            }}
            onLater={() => setSaveOffer(null)}
          />
        )}
      </div>

      {snapshots.length > 0 && (
        <div className="ai-versions">
          <div className="ai-versions-title">
            <IconClock />
            {t('aiSnapshotsTitle')}
          </div>
          {snapshots.map((s, i) => (
            <div key={i} className="ai-version-row">
              <span className="ai-version-label" data-tip={s.label}>
                <span className="ai-version-time">{s.time}</span>
                {s.label}
              </span>
              <button className="ai-version-rollback" disabled={busy} onClick={() => rollback(s)}>
                {t('aiRollback')}
              </button>
            </div>
          ))}
        </div>
      )}

      {activeClarify && (
        <div className="ai-composer">
          <ClarifyCard
            questions={activeClarify}
            onSubmit={(answers, qa) => {
              setChat((prev) => withReceipt(prev, qa))
              clarifyResolverRef.current?.({ answers })
              clarifyResolverRef.current = null
              setActiveClarify(null)
            }}
            onSkip={dismissClarify}
          />
        </div>
      )}
      <div className="ai-composer" style={activeClarify ? { display: 'none' } : undefined}>
        {readOnly && !isUniwork && (
          <div className="ai-readonly-notice" role="note">
            {t('aiViewOnlyNotice')}
          </div>
        )}
        {activePartial && (
          <div className="ai-queue ai-partial-card" role="group" aria-label={t('aiPartialTitle')}>
            <div className="ai-queue-head">
              <span className="ai-queue-title">{t('aiPartialTitle')}</span>
            </div>
            <div className="ai-queue-hint">
              {t('aiPartialBody', { blocks: activePartial.blocks })}
            </div>
            <div className="ai-queue-foot">
              <button
                type="button"
                className="ai-queue-discard"
                onClick={() => decidePartial(false)}
              >
                {t('aiPartialDiscard')}
              </button>
              <button type="button" className="ai-queue-send" onClick={() => decidePartial(true)}>
                {t('aiPartialAdopt')}
              </button>
            </div>
          </div>
        )}
        {editor && !readOnly && editQueue.length > 0 && (
          <EditQueueCard
            items={editQueue}
            editor={editor}
            busy={busy}
            onEditInstruction={(qid, instruction) => onQueueEditInstruction?.(qid, instruction)}
            onRemove={(qid) => onQueueRemove?.(qid)}
            onDiscardAll={() => onQueueClear?.()}
            onSend={sendQueue}
            onFocus={(qid) => onQueueFocus?.(qid)}
          />
        )}
        <AiComposer
          queueStrip={
            <AiQueueStrip
              items={msgQueue.queued}
              labels={AI_QUEUE_LABELS[lang]}
              onUpdate={msgQueue.update}
              onRemove={msgQueue.remove}
              onClear={msgQueue.clear}
              paused={msgQueue.paused}
              onTogglePause={msgQueue.togglePaused}
              onMove={msgQueue.move}
            />
          }
          onQueue={enqueueDraft}
          queuePlaceholder={AI_QUEUE_LABELS[lang].queuePlaceholder}
          value={prompt}
          busy={busy}
          lang={lang}
          viewOnly={isUniwork && readOnly ? true : undefined}
          uniwork={
            isUniwork
              ? {
                  provider: provider ?? 'uniwork',
                  lang,
                  note: composerNoteState,
                  onSignIn: () => void readUniworkCloudStatus()?.signIn?.(),
                  onChooseProvider: () => void window.markdownApi?.openAiModelSettings?.(),
                  onAnnounce: setComposerAnnouncement,
                  onSendBlockedChange: uniworkGate.onSendBlockedChange,
                  registerBlockedHandler: uniworkGate.registerBlockedHandler,
                  disclosure: {
                    orgName: cloudSnapshot?.orgName ?? undefined,
                    ackKey: {
                      account: cloudSnapshot?.accountId ?? '',
                      org: cloudSnapshot?.orgId ?? '',
                      document: filePath ?? 'local',
                    },
                    variant: filePath ? 'document' : 'local',
                  },
                }
              : undefined
          }
          header={
            hasScopeSelection && (
              <div className="ai-scope-row">
                <span className="ai-scope-hint">
                  <button
                    className="ai-scope-label"
                    onClick={() => setScopePreviewOpen((v) => !v)}
                    aria-expanded={scopePreviewOpen}
                    data-tip={t('aiScopeSelectionTip')}
                  >
                    {t('aiScopeSelection', { words: countWords(selectionText) })}
                  </button>
                  <button
                    className="ai-scope-clear"
                    onClick={clearScopeSelection}
                    data-tip={t('aiScopeClearTitle')}
                    aria-label={t('aiScopeClearTitle')}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </span>
                {scopePreviewOpen && (
                  <div className="ai-scope-preview">
                    {selectionText.length > 400 ? `${selectionText.slice(0, 400)}…` : selectionText}
                  </div>
                )}
              </div>
            )
          }
          placeholder={t('aiComposerPlaceholder')}
          hintIdle={t('aiHintIdle')}
          hintBusy={t('aiHintBusy')}
          sendLabel={t('aiSend')}
          stopLabel={t('aiStop')}
          iconOnly
          footerStart={
            <>
              <AiModelPicker
                bridge={MODEL_BRIDGE}
                lang={lang}
                onAnnounce={(text) => setPickerNote({ text, over: panelLiveAnnouncement })}
              />
              {sessionUsage && <AiUsageChip usage={sessionUsage} session lang={lang} />}
            </>
          }
          sendIconEnabled={<img src={sendEnterOn} alt="" aria-hidden />}
          sendIconDisabled={<img src={sendEnterOff} alt="" aria-hidden />}
          stopIcon={<img src={sendStop} alt="" aria-hidden />}
          textareaRef={inputRef}
          onChange={setPrompt}
          onSend={() => send(prompt)}
          onStop={stop}
        />
      </div>
    </aside>
  )
}

/** Step-row status icons (timeline glyphs, unified with the other apps) */
function StepIcon({ status }: { status: 'running' | 'done' | 'error' }) {
  if (status === 'running') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6.5 3.5h11M6.5 20.5h11M8 3.5v3.2c0 2.6 4 4.2 4 5.3 0 1.1 4 2.7 4 5.3v3.2M16 3.5v3.2c0 2.6-4 4.2-4 5.3 0 1.1-4 2.7-4 5.3v3.2" />
      </svg>
    )
  }
  if (status === 'error') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.4 2.4 2.4 4.6-5" />
    </svg>
  )
}

/** Tool activity group (docs parity): auto-opens while tools run, auto-collapses into
 *  "Worked · N steps" when they finish; a manual toggle always wins */
function ToolChipList({ tools }: { tools: ToolActivity[] }) {
  const { t: tr } = useI18n()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  const toggle = (j: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(j)) next.delete(j)
      else next.add(j)
      return next
    })
  }

  const anyRunning = tools.some((tool) => tool.running)
  const open = userOpen ?? anyRunning
  const label = anyRunning ? tr('aiGroupWorking') : tr('aiWorkedSteps', { n: tools.length })

  return (
    <div className="ai-work-group">
      <button
        type="button"
        className={`ai-work-group-summary${anyRunning ? ' running' : ''}`}
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
      >
        {anyRunning && !open && <span className="ai-tool-chip-spinner" aria-hidden />}
        <span className="ai-work-group-label">{label}</span>
        <span className={`ai-tool-chip-caret${open ? ' open' : ''}`} aria-hidden>
          ›
        </span>
      </button>
      <div className={`ai-work-group-body${open ? ' open' : ''}`}>
        <div className="ai-work-group-body-inner">
          {tools.map((tool, j) => {
            const hasOutput = !tool.running && !!tool.output
            const isOpen = expanded.has(j)
            const stepStatus = tool.running ? 'running' : tool.isError ? 'error' : 'done'
            return (
              <div key={j} className="ai-step-row">
                <span className={`ai-step-icon ${stepStatus}`} aria-hidden>
                  <StepIcon status={stepStatus} />
                </span>
                <div className="ai-step-content">
                  {hasOutput ? (
                    <button
                      type="button"
                      className="ai-step-title clickable"
                      data-tip={tool.name}
                      aria-expanded={isOpen}
                      onClick={() => toggle(j)}
                    >
                      {tool.summary}
                    </button>
                  ) : (
                    <span className="ai-step-title" data-tip={tool.name}>
                      {tool.summary}
                    </span>
                  )}
                  {hasOutput && isOpen && (
                    <div className="ai-step-detail">
                      <div className="ai-tool-output">
                        <div className="ai-tool-output-pre">{tool.output}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Svg({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function IconNewChat(): ReactElement {
  return (
    <Svg>
      <path
        d="M13.5 7.2v-3A1.7 1.7 0 0 0 11.8 2.5H4.2a1.7 1.7 0 0 0-1.7 1.7v6.1a1.7 1.7 0 0 0 1.7 1.7h1.1v2l2.6-2h1.3"
        strokeLinejoin="round"
      />
      <path d="M12.2 9.4v4M10.2 11.4h4" />
    </Svg>
  )
}

function IconCollapse(): ReactElement {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M5.5 2.5v11" />
      <path d="M12.5 8H8.1M9.8 5.9 7.7 8l2.1 2.1" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function IconGear(): ReactElement {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="1.78" />
      <path d="M8 2.98v1.62M8 11.4v1.62M13.02 8H11.4M4.6 8H2.98M11.56 4.44l-1.13 1.13M5.57 10.43l-1.13 1.13M11.56 11.56l-1.13-1.13M5.57 5.57 4.44 4.44" />
    </svg>
  )
}

function IconClock(): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.6" />
    </svg>
  )
}
