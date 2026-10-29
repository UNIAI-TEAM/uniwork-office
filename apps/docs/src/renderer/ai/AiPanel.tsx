import {
  aiUniworkText,
  isUniworkRefusalErrorKey,
  aiPanelWidthAtPointer,
  AiPanelSideButton,
  AiModelPicker,
  useCloudSignedIn,
  type AiModelPickerBridge,
  UniAiMark,
  AiQueueStrip,
  AI_QUEUE_LABELS,
  AiUsageChip,
  ack as ackUniworkDisclosure,
  addTokenUsage,
  isAcked as isUniworkDisclosureAcked,
  type AiTokenUsageView,
  useChatRunQueue,
  useUniworkDisclosureAck,
  useUniworkSendGate,
  useOverlayDock,
} from '@genoffice/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import '@genoffice/ui/ai-uniwork-composer.css'
import type { Editor } from '@tiptap/core'
import type { Block } from '@genoffice/docx-engine'
import {
  AgentLoop,
  composeSkills,
  createImageUrlRegistry,
  droppedCallsOfNotes,
  endsQuietly,
  getEntryResultChipView,
  isTurnEnded,
  noticePatch,
  panelLiveAnnouncement as computePanelLiveAnnouncement,
  runHistoryEvents,
  singleShortcutHint,
  streamText,
  uniworkErrorLineText,
  type AgentImage,
  type PanelNote,
  type MindMapTreeNode,
} from '@genoffice/agent-core'
import { redactTextBetween, type RedactableNode } from './redact-view'
import {
  aiNoticeBody,
  aiNoticeKind,
  composerNoteFor,
  imageGenerationAvailable,
  mediaAnalysisAvailable,
} from '@genoffice/ai-provider/browser'
import type { AiSettings, AttachmentAddResult, AttachmentMeta } from '../../shared/ipc'
import { ATTACHMENT_IMAGE_EXTS } from '../../shared/ipc'
import {
  AI_SIDE_PARTS,
  captureRunSnapshot,
  restoreRunSnapshot,
  type AiRunSnapshot,
  type AiSidePart,
  type AiSideState,
} from './run-snapshot'
import { countWords, findNumId, type NumIds } from './protocol'
import { DOC_NAV_SCHEME, navigateToBlock, parseDocNavHref } from './doc-nav'
import {
  markDocSeen,
  type AiCommentsAccess,
  type AiDocExtras,
  type AiHeaderFooterAccess,
  type AskClarification,
  type ClarifyQuestion,
} from './tools'
import type { AiPageSetupAccess } from './page-setup'
import type { AiNotesAccess } from './note-ops'
import { createDocsSkill, type AiDocProtection } from './docs-skill'
import { aiTrackFor, aiTracksChanges } from './track-policy'
import { MindMapCard } from './MindMapCard'
import {
  buildDocWriterRequest,
  countFragmentBlocks,
  DOC_MAX_CHARS,
  extractFragment,
  type DocWriteResult,
  type DocWriteSpec,
} from './doc-writer'
import { EditQueueCard } from './EditQueueCard'
import { ClarifyCard } from '../components/ClarifyCard'
import { withReceipt, withoutReceipts, type ClarifyQa } from './clarify-receipts'
import {
  buildQueueInstruction,
  buildQueueSummary,
  liveItems,
  resolveQueue,
  type DocsEditQueueItem,
} from './edit-queue'
import { setInactiveSelectionShown } from '../editor/inactive-selection'
import { createDocsRunHistoryGroup, type DocsRunHistoryGroup } from '../editor/ai-run-history'
import { applyRevisionsBy } from '../editor/revisions'
import { DOCS_CONTINUE_INSTRUCTION } from './continuation'
import { waitForFullContent } from '../phased-content'
import { currentDocGeneration } from '../file-actions'
import { createFilesSkill } from './files-skill'
import { boundChatHistory } from './chat-retention'
import { createElectronTransport } from './transport'
import { workedStepsLabel } from './worked-steps'
import { docHasAiMarks } from '../editor/ai-marker'
import { useI18n, t as tModule, aiLangDirective, getLang, type StringKey } from '../i18n/locale'
import { AiErrorAction, Markdown, uniworkErrorForEntry, useAiModelNeedHint } from '@genoffice/ui'
import { AiComposer, AiScopeQuote, AiTypingIndicator, type AiScopeQuoteData } from '@genoffice/ui'
import { AiSaveDraftCard } from '@genoffice/ui'
import { aiPanelOnUniwork } from '@genoffice/ui'
import {
  AskUniModeBody,
  AskUniModeToggle,
  askUniChatPaneProps,
  askUniFileName,
  askUniLiveText,
  useAskUniMode,
} from '@genoffice/ui'
import {
  AI_RUN_DONE_EVENT,
  AI_SAVE_OFFER_EVENT,
  type AiRunDoneDetail,
  type AiSaveOfferDetail,
} from './save-offer'
import sendEnterOn from '../assets/send-enter-on.png'
import sendEnterOff from '../assets/send-enter-off.png'
import sendStop from '../assets/send-stop.png'
import attachIcon from '../assets/attach-icon.png'
import filePdfIcon from '../assets/file-pdf.png'
import fileWordIcon from '../assets/file-word.png'
import fileExcelIcon from '../assets/file-excel.png'
import filePptIcon from '../assets/file-ppt.png'
import fileImageIcon from '../assets/file-image.png'
import fileVideoIcon from '../assets/file-video.png'
import fileVoiceIcon from '../assets/file-voice.png'
import fileDocumentIcon from '../assets/file-document.png'
import fileGeneralIcon from '../assets/file-general.png'
import { IconGear, IconNewChat, IconSidebarCollapse } from '../components/icons'
import { cap } from '../capabilities'
import { docsUniworkBoundForAi } from '../uniwork-doc-state'

interface ToolActivity {
  name: string
  summary: string
  /** still executing: rendered as a spinner chip, replaced in place when the tool finishes */
  running?: boolean
  isError?: boolean
  /** Tool output (truncated on the UI side); when set, the row can be expanded for details */
  output?: string
}

/** Max characters of tool output in the UI expansion panel */
const TOOL_OUTPUT_MAX_CHARS = 2000

/** progress chip refresh while a write streams */
const CHIP_UPDATE_MS = 400

/** Cap on tool args/output persisted in the transcript (the store layer has another 16k truncation fallback) */
const PERSIST_TOOL_FIELD_MAX = 16_000

/** Tool args → JSON string (truncated; returns undefined on serialization failure, doesn't block persistence) */
function safeJsonInput(input: unknown): string | undefined {
  try {
    const s = JSON.stringify(input)
    return s && s !== '{}' ? s.slice(0, PERSIST_TOOL_FIELD_MAX) : undefined
  } catch {
    return undefined
  }
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  error?: string
  /** the S9 key the transport chose for `error` (UniWork AI); absent for any other failure */
  errorKey?: string
  streaming?: boolean
  turnLimit?: boolean
  stopped?: boolean
  /** the turn streamed real text before it ended (a stop filler is not text) */
  streamedText?: boolean | undefined
  /** tool executions performed during this assistant turn */
  tools?: ToolActivity[]
  /** interactive mind map from generate_mindmap's side-channel display (session-only;
   * the persisted transcript keeps the tool call, so a reopened file can regenerate) */
  mindmap?: MindMapTreeNode
  /** document state before this turn's first edit — rendered as an inline roll-back action */
  snapshot?: AiRunSnapshot
  /** a Roll back after a save could not put these parts back (the notice under the turn) */
  rollbackKept?: AiSidePart[]
  /** attachments consumed from the composer by this user message (read-only echo chips) */
  attachments?: AttachmentMeta[]
  /** the selection this user message targeted, frozen at send */
  scope?: AiScopeQuoteData
  /** answered ask_clarification cards of this message's run (view-only receipts) */
  clarifyReceipts?: ClarifyQa[][]
  /** UniWork AI: the transport is waiting out a Retry-After; the run goes on, Stop is the only action */
  waitLine?: string | undefined
  /** UniWork AI: restarted conversation / provider boundary / dropped call, shown above the answer */
  notes?: PanelNote[] | undefined
  /** tokens the provider billed for this reply, summed across its turns (absent when unreported) */
  usage?: AiTokenUsageView
}

interface UniworkCloudSnapshotLike {
  state:
    | 'signed-out'
    | 'not-entitled'
    | 'subscription-inactive'
    | 'credits-exhausted'
    | 'unavailable'
    | 'ready'
  signedIn: boolean
  enabled: boolean
  reason?: string | null
  cloudUnavailable?: boolean
  accountId?: string | null
  orgId?: string | null
  orgName?: string | null
}

interface UniworkCloudBridgeLike {
  get(): Promise<UniworkCloudSnapshotLike | null>
  onChange?(handler: (status: UniworkCloudSnapshotLike | null) => void): () => void
  openAccountSettings?(): Promise<void>
  signIn?(): Promise<void>
}

export function readUniworkCloudStatus(
  bridge: UniworkCloudBridgeLike | undefined = (
    window as unknown as { uniworkCloudStatus?: UniworkCloudBridgeLike }
  ).uniworkCloudStatus,
): UniworkCloudBridgeLike | undefined {
  return bridge
}

/** longest selection excerpt echoed on a user bubble */
const SCOPE_TEXT_MAX = 200

/** clickable starter prompts for the empty state (fill the input, do not send) —
 * blank documents get generation starters, documents with content get edit starters */
const DRAFT_STARTER_PROMPTS: StringKey[] = [
  'aiStarterWeeklyReport',
  'aiStarterLaunchPost',
  'aiStarterEventOutline',
]
const EDIT_STARTER_PROMPTS: StringKey[] = [
  'aiStarterSummarize',
  'aiStarterPolishAll',
  'aiStarterContinue',
  'aiStarterFillTemplate',
  'aiStarterMindMap',
]

/** a view-only document keeps only the starter that does not edit it */
const READ_ONLY_STARTER_PROMPTS: StringKey[] = ['aiStarterSummarize']

/** the name of each side-state part in the Roll back notice */
const SIDE_PART_KEYS: Record<AiSidePart, StringKey> = {
  comments: 'aiSidePartComments',
  headerFooter: 'aiSidePartHeaderFooter',
  styles: 'aiSidePartStyles',
  pageSetup: 'aiSidePartPageSetup',
  watermark: 'aiSidePartWatermark',
}

/** resizable panel width: persisted, clamped so neither pane collapses */
const PANEL_WIDTH_KEY = 'docs-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 360
const PANEL_WIDTH_MIN = 280

function maxPanelWidth(): number {
  // The viewport can be transiently tiny (a WebContentsView is 0×0 until the
  // shell lays it out), so never let the ceiling drop below the minimum
  return Math.max(PANEL_WIDTH_MIN, Math.min(720, Math.round(window.innerWidth * 0.6)))
}

function clampPanelWidth(w: number): number {
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), maxPanelWidth())
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  // static bounds only — clamping against the window here would bake a
  // transiently small viewport into the restored preference
  return Number.isFinite(saved) && saved > 0
    ? Math.min(Math.max(saved, PANEL_WIDTH_MIN), 720)
    : PANEL_WIDTH_DEFAULT
}

/** persisted UI preference: highlight AI edits in yellow and ask for confirmation */
const TRACK_CHANGES_KEY = 'ai-docs-track-changes'

/** Clipboard bitmap MIME → attachment extension (corresponds to ATTACHMENT_IMAGE_EXTS) */
const PASTE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** File-type icons for attachment cards (Genspark attachment icon set); exts the
 *  attachment allowlist doesn't accept yet are mapped ahead so they light up when added */
const ATTACHMENT_CARD_ICON_GROUPS: [icon: string, exts: string[]][] = [
  [fileWordIcon, ['doc', 'docx']],
  [fileExcelIcon, ['xls', 'xlsx', 'xlsm', 'csv', 'tsv']],
  [filePptIcon, ['ppt', 'pptx']],
  [filePdfIcon, ['pdf']],
  [fileImageIcon, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'heic']],
  [fileVideoIcon, ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']],
  [fileVoiceIcon, ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']],
  [
    fileDocumentIcon,
    [
      'txt',
      'md',
      'markdown',
      'rtf',
      'log',
      'json',
      'yaml',
      'yml',
      'xml',
      'html',
      'htm',
      'js',
      'ts',
      'tsx',
      'jsx',
      'py',
      'java',
      'c',
      'h',
      'cpp',
      'go',
      'rs',
      'rb',
      'sh',
      'sql',
      'css',
    ],
  ],
]

const ATTACHMENT_CARD_ICONS: Record<string, string> = Object.fromEntries(
  ATTACHMENT_CARD_ICON_GROUPS.flatMap(([icon, exts]) => exts.map((ext) => [ext, icon])),
)

function AttachmentCardIcon({ ext }: { ext: string }) {
  return <img src={ATTACHMENT_CARD_ICONS[ext] ?? fileGeneralIcon} alt="" aria-hidden />
}

/** Card name slot width: 190 card - 2 border - 8/14 padding - 40 icon - 10 gap */
const CARD_NAME_MAX_WIDTH = 116
let cardNameCtx: CanvasRenderingContext2D | null = null

/** Ellipsize like the design: cut at the limit, strip trailing -_./spaces so
 *  punctuation never sits against the …; CSS text-overflow stays as fallback */
function truncateCardName(name: string): string {
  cardNameCtx ??= document.createElement('canvas').getContext('2d')
  if (!cardNameCtx) return name
  // must match the stack the card name actually renders with (body font in styles.css)
  cardNameCtx.font =
    "500 13px 'Segoe UI', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  if (cardNameCtx.measureText(name).width <= CARD_NAME_MAX_WIDTH) return name
  let lo = 1
  let hi = name.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cardNameCtx.measureText(`${name.slice(0, mid)}…`).width <= CARD_NAME_MAX_WIDTH) lo = mid
    else hi = mid - 1
  }
  return `${name.slice(0, lo).replace(/[-_.\s]+$/, '')}…`
}

function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(2)} KB`
}

/** Read-only echo of the attachments a user message consumed from the composer
 *  (image previews when the file is still readable; otherwise the placeholder icon) */
function SentAttachments({
  atts,
  previews,
}: {
  atts: AttachmentMeta[]
  previews: Record<string, string>
}) {
  return (
    <div className="ai-msg-attachments">
      {atts.map((a) =>
        ATTACHMENT_IMAGE_EXTS.has(a.ext) ? (
          <span key={a.path} className="ai-attachment-thumb" title={a.name}>
            {previews[a.path] ? (
              <img src={previews[a.path]} alt={a.name} />
            ) : (
              <span className="ai-attachment-thumb-pending" aria-hidden>
                <img src={fileImageIcon} alt="" />
              </span>
            )}
          </span>
        ) : (
          <span key={a.path} className="ai-attachment-card" title={a.name}>
            <span className="ai-attachment-card-icon">
              <AttachmentCardIcon ext={a.ext} />
            </span>
            <span className="ai-attachment-card-meta">
              <span className="ai-attachment-card-name">{truncateCardName(a.name)}</span>
              <span className="ai-attachment-card-size">{formatAttachmentSize(a.sizeBytes)}</span>
            </span>
          </span>
        ),
      )}
    </div>
  )
}

/** author name on AI-generated tracked revisions (accept/reject via Review) */
export const AI_REVISION_AUTHOR = 'AI Assistant'

interface AiPanelProps {
  editor: Editor
  blocks: Block[]
  settings: AiSettings
  /** the document has no text yet — the empty-state copy offers drafting instead of editing */
  docEmpty?: boolean
  /** fallback numbering ids for documents created from the blank template */
  numIdFallback?: NumIds | null
  /**
   * preset instruction pushed from the ribbon, the start screen or the web host's job (`ai.start`);
   * autoRun sends it immediately. displayText is the bubble when it differs from the sent text
   */
  preset?: {
    text: string
    nonce: number
    autoRun?: boolean
    displayText?: string
    /** a web host's job: it runs only while the panel is on UniWork AI (read when it would run) */
    uniworkOnly?: boolean
  } | null
  /** the last preset nonce taken, kept by App so a remounted panel (a new document key) never runs it again */
  presetSeen?: { current: number | null }
  /** false shows only the collapsed rail; the component stays mounted so panel state survives */
  open?: boolean
  /** the dock is hidden by the frame (Read Mode): it is not an active dialog, whatever `open` says */
  dockHidden?: boolean
  /** true suppresses even the collapsed rail (the "show the AI sidebar" setting is off) */
  hideRail?: boolean
  /** expand from the collapsed rail */
  onExpand?: () => void
  /** collapse the panel to the sidebar rail */
  onCollapse?: () => void
  /** Absolute path of the currently open file (used for chat-history persistence) */
  filePath?: string | null
  /** queued selection-scoped edits (owned by App, which also owns the anchors) */
  editQueue?: DocsEditQueueItem[]
  onQueueEditInstruction?: (qid: string, instruction: string) => void
  onQueueRemove?: (qid: string) => void
  onQueueClear?: () => void
  /** scroll to and select the anchored passage */
  onQueueFocus?: (qid: string) => void
  /** submission consumed these items: drop them and their anchors */
  onQueueConsume?: (qids: string[]) => void
  /** comments store for the AI comment tools (read/reply/resolve) */
  commentsAccess?: AiCommentsAccess
  /** header/footer state for the set_header_footer tool and per-turn context */
  hfAccess?: AiHeaderFooterAccess
  /** section store for set_page_setup / insert_section_break and the page-setup context line */
  pageSetupAccess?: AiPageSetupAccess
  /** style catalog and watermark stores for define_style / applyStyle / set_watermark */
  docExtras?: AiDocExtras
  /** footnote / endnote lists for insert_footnote, insert_endnote, delete_note, read_notes */
  notesAccess?: AiNotesAccess
  /** view-only UniWork document: the agent only reads, nothing here may edit the document */
  readOnly?: boolean
  /** UniWork working copy: tools that write outside the document are hidden (C-BOUND) */
  bound?: boolean
  /** Word protection of the open document: the docs skill hides/refuses the tools it forbids (live) */
  protection?: AiDocProtection
  /** App state beside the PM doc that a run's Roll back restores with it */
  sideState?: AiSideState
}

const MODEL_BRIDGE: AiModelPickerBridge = {
  getSettings: () => window.desktop.getAiSettings(),
  setSettings: (settings, options) => window.desktop.setAiSettings(settings, options),
  onSettingsChanged: (handler) => window.desktop.onAiSettingsChanged(handler),
  gskLoggedIn: () => window.desktop.aiGskStatus().then((s) => !!s?.loggedIn),
  openModelSettings: () => window.desktop.openAiModelSettings().catch(() => {}),
  // web frames: no key or no model keeps send off with a hint (see AiModelPicker)
  get requireModel() {
    return window.desktop?.capabilities?.platform === 'web'
  },
}

export function AiPanel({
  editor,
  blocks,
  settings,
  docEmpty,
  numIdFallback,
  preset,
  presetSeen,
  open = true,
  dockHidden = false,
  hideRail = false,
  onExpand,
  onCollapse,
  filePath,
  editQueue = [],
  onQueueEditInstruction,
  onQueueRemove,
  onQueueClear,
  onQueueFocus,
  onQueueConsume,
  commentsAccess,
  hfAccess,
  pageSetupAccess,
  docExtras,
  notesAccess,
  readOnly = false,
  bound = false,
  protection = 'none',
  sideState,
}: AiPanelProps) {
  const { t, lang } = useI18n()
  const askUni = useAskUniMode(lang, filePath)
  // Panel chrome follows the UI language; message text follows its own content (dir=auto below)
  const isRtl = lang === 'ar' || lang === 'he'
  // a picked UniWork AI that is not offered (or any provider still missing a model) keeps every
  // send entry closed - presets, retry, continue and queue runs included - the hint says why
  const needModelHint = useAiModelNeedHint()
  // the UniWork disclosure gate of every send entry: the composer feeds it, the queue pump asks it
  // silently, and presets, retry and continue refuse through the send entry (announce + focus)
  const uniworkGate = useUniworkSendGate()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** the user clicked or typed into the page the open run holds: say why nothing happens */
  const [editsPaused, setEditsPaused] = useState(false)
  useEffect(() => {
    if (!busy) setEditsPaused(false)
  }, [busy])
  /** messages queued while a reply runs; the pump re-runs them through runWith on settle */
  const msgQueue = useChatRunQueue<{
    attachments: AttachmentMeta[]
    scope: AiScopeQuoteData | null
  }>({
    busy,
    submit: (text, meta) => {
      const loop = loopRef.current
      if (needModelHint !== null || !loop || loop.busy || pendingSendRef.current) return false
      // held until the user acknowledges the UniWork disclosure, as Send is
      if (uniworkGate.isBlocked()) return false
      return runWith(text, text, meta.attachments, meta.scope)
    },
  })
  /** Wall-clock start of the current run, drives the elapsed badge */
  const runStartedAtRef = useRef(0)
  /** a send waiting on a phased open's tail; Stop / New chat abort it before it runs */
  const pendingSendRef = useRef<{ aborted: boolean } | null>(null)
  const [chat, setChat] = useState<ChatEntry[]>([])
  /** the ask-before-saving card of the last run (a never-saved document it changed); one per run */
  const [saveOffer, setSaveOffer] = useState<{ name: string } | null>(null)
  /** latest chat for listeners registered once (the pre-save hook reads its rollback points) */
  const chatRef = useRef(chat)
  chatRef.current = chat
  /** a streamed write stopped early: the draft stays in the document until the user keeps or discards it */
  const [activePartial, setActivePartial] = useState<{ blocks: number } | null>(null)
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
  const partialResolverRef = useRef<((keep: boolean) => void) | null>(null)
  /** bumped by New chat / unmount: a writer resuming after its abort must not open the keep card */
  const writerEpochRef = useRef(0)
  /** Past conversation restored from JSONL (read-only transcript, not fed to the model) */
  const [historicChat, setHistoricChat] = useState<ChatEntry[]>([])
  const [trackChanges, setTrackChanges] = useState(
    () => localStorage.getItem(TRACK_CHANGES_KEY) === '1',
  )
  // the forced Track pill's reason tip opens on hover or keyboard focus of the pill
  const [trackTipHover, setTrackTipHover] = useState(false)
  const [trackTipFocus, setTrackTipFocus] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  /** data-URL previews for image attachments, keyed by path (Genspark composer thumbnails) */
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
  /** image paths with a read already issued — one readAttachmentImage per attach, even while pending */
  const previewRequestedRef = useRef(new Set<string>())
  /** Attachments consumed by earlier sends this session: sending clears the composer, but the
      files skill must keep reading them mid-run and in follow-up turns. Deduped by path
      against the live composer list. */
  const sentAttachmentsRef = useRef<AttachmentMeta[]>([])
  useEffect(() => {
    // previews cover the composer plus every image echoed on a sent/history message
    // (history chips re-read the file by its stored path; a deleted file keeps the placeholder)
    const wanted = [
      ...attachments,
      ...chat.flatMap((e) => e.attachments ?? []),
      ...historicChat.flatMap((e) => e.attachments ?? []),
    ]
    const alive = new Set(wanted.map((a) => a.path))
    // drop previews (and request markers) of removed attachments, so memory is reclaimed and a re-attach re-reads
    setAttachmentPreviews((prev) => {
      const stale = Object.keys(prev).filter((p) => !alive.has(p))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const p of stale) delete next[p]
      return next
    })
    for (const p of previewRequestedRef.current) {
      if (!alive.has(p)) previewRequestedRef.current.delete(p)
    }
    for (const a of wanted) {
      if (!ATTACHMENT_IMAGE_EXTS.has(a.ext) || previewRequestedRef.current.has(a.path)) continue
      previewRequestedRef.current.add(a.path)
      void window.desktop
        .readAttachmentImage(a.path)
        .then((r) => {
          if (!previewRequestedRef.current.has(a.path)) return // removed while the read was in flight
          if (r.ok && r.base64 && r.mime) {
            setAttachmentPreviews((prev) => ({
              ...prev,
              [a.path]: `data:${r.mime};base64,${r.base64}`,
            }))
          }
        })
        .catch(() => {
          // A rejected read (bridge error, teardown race) must not leave the
          // path marked requested forever — that would permanently skip the
          // thumbnail with no retry. Clear it so the next effect run retries.
          previewRequestedRef.current.delete(a.path)
        })
    }
  }, [attachments, chat, historicChat])
  /** paints the strip's scrollbar thumb while the user scrolls it (cleared 800ms after the last event) */
  const attachScrollFadeRef = useRef(0)
  const onAttachmentsScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    el.classList.add('is-scrolling')
    window.clearTimeout(attachScrollFadeRef.current)
    attachScrollFadeRef.current = window.setTimeout(() => el.classList.remove('is-scrolling'), 800)
  }
  const [dragOver, setDragOver] = useState(false)
  // preferred = the user's chosen width (the only value persisted); panelWidth =
  // what fits the current window. Deriving the display width from the preference
  // means a transiently small window never permanently shrinks the panel.
  const preferredWidthRef = useRef(loadPanelWidth())
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(preferredWidthRef.current))
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  // under 900 px the dock overlays the document: modal dialog, composer focus, Esc, focus return
  useOverlayDock({
    rootRef: asideRef,
    open: open && !dockHidden,
    onClose: () => onCollapse?.(),
    label: t('aiPanelTitle'),
  })

  // The .ai-dock wrapper owns the animated width (Excel-parity 180ms slide);
  // it tracks the resizable panel width through this variable
  // `open` dep: the aside ref only exists while expanded
  useEffect(() => {
    const dock = asideRef.current?.closest('.ai-dock') as HTMLElement | null
    dock?.style.setProperty('--ai-panel-width', `${panelWidth}px`)
  }, [panelWidth, open])

  // Re-derive the display width on window resize (max is 60% of the window);
  // growing the window back restores the preferred width
  useEffect(() => {
    const onResize = () => setPanelWidth(clampPanelWidth(preferredWidthRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // a pending keep/discard must not outlive the panel: settle it as discard
  useEffect(
    () => () => {
      writerEpochRef.current++
      partialResolverRef.current?.(false)
      partialResolverRef.current = null
      clarifyResolverRef.current?.({ answers: '', cancelled: true })
      clarifyResolverRef.current = null
    },
    [],
  )
  // bumped on selection/doc changes so the scope hint & quick actions stay fresh
  const [, setScopeTick] = useState(0)
  /** the scope chip's expandable preview of the selected text */
  const [scopePreviewOpen, setScopePreviewOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** false once the user scrolls up to read; re-arms near the bottom */
  const stickToBottomRef = useRef(true)
  /** projectId/chatId of the current chat */
  const chatRefIds = useRef<{ projectId: string; chatId: string } | null>(null)

  // latest props for the loop's closures (the loop instance outlives renders)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  /** UniWork cloud sign-in state (signed in + entitled, from the shell main status) for the media tool gates */
  const { loggedInRef: gskLoggedInRef } = useCloudSignedIn(
    () => window.desktop?.aiGskStatus?.(),
    open,
  )
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const numIdFallbackRef = useRef(numIdFallback)
  numIdFallbackRef.current = numIdFallback
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  /** attachments consumed by the most recent send — retry resends the same set */
  const lastAttachmentsRef = useRef<AttachmentMeta[]>([])
  /** the scope quote of the last send, so a retry reuses it instead of re-reading the live selection */
  const lastScopeRef = useRef<AiScopeQuoteData | undefined>(undefined)
  /** composer attachments plus everything already sent this session (deduped by path) */
  const availableAttachments = (): AttachmentMeta[] => {
    const seen = new Set<string>()
    return [...sentAttachmentsRef.current, ...attachmentsRef.current].filter((a) =>
      seen.has(a.path) ? false : (seen.add(a.path), true),
    )
  }
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const boundRef = useRef(bound)
  boundRef.current = bound
  const protectionRef = useRef(protection)
  protectionRef.current = protection
  const sideStateRef = useRef(sideState)
  sideStateRef.current = sideState
  const trackChangesRef = useRef(trackChanges)
  trackChangesRef.current = trackChanges
  const commentsAccessRef = useRef(commentsAccess)
  commentsAccessRef.current = commentsAccess
  const hfAccessRef = useRef(hfAccess)
  hfAccessRef.current = hfAccess
  const pageSetupAccessRef = useRef(pageSetupAccess)
  pageSetupAccessRef.current = pageSetupAccess
  const docExtrasRef = useRef(docExtras)
  docExtrasRef.current = docExtras
  const notesAccessRef = useRef(notesAccess)
  notesAccessRef.current = notesAccess

  /** drop every aiChanged flag (the marker is a screen affordance, not content: never an undo step) */
  const clearAiHighlights = () => {
    const view = editorRef.current.view
    let tr = view.state.tr
    let touched = false
    view.state.doc.descendants((node, pos) => {
      if (node.attrs.aiChanged) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, aiChanged: false })
        touched = true
      }
    })
    tr = tr.setMeta('addToHistory', false)
    if (touched) {
      view.dispatch(tr)
      // AI-pipeline housekeeping, not a user edit: keep the freshness baseline current
      markDocSeen(editorRef.current)
    }
  }
  /** instruction of the in-flight run */
  const instructionRef = useRef('')
  /** document state before the run's first edit — attached to the turn's final
      segment at run end (mid-turn segments never show the action toolbar) */
  const runSnapshotRef = useRef<AiRunSnapshot | null>(null)
  /**
   * Per rollback point: the side-state parts a save already wrote (Roll back can no longer put
   * them back) and the capture later changes are measured from (null until the next tool after
   * a save takes a fresh one). Side values are read through refs the App updates on render, so
   * they are compared at quiet moments: a save, the next tool start, the Roll back click.
   */
  const keptRef = useRef(
    new WeakMap<AiRunSnapshot, { base: unknown | null; parts: Set<AiSidePart> }>(),
  )
  const keptOf = (snap: AiRunSnapshot) => {
    let k = keptRef.current.get(snap)
    if (!k) {
      k = { base: snap.side ?? null, parts: new Set() }
      keptRef.current.set(snap, k)
    }
    return k
  }
  /** last sent instruction, for one-click retry */
  const lastInstructionRef = useRef('')
  /** Tool activity of the whole run (with args/output, accumulated across turns) — for full
      transcript persistence, and so persisting needn't do side effects inside a setState updater */
  const runToolsRef = useRef<
    Array<{ name: string; summary: string; isError?: boolean; input?: string; output?: string }>
  >([])
  /** tokens billed so far in the in-flight run (summed across turns; usage chips read it live) */
  const runUsageRef = useRef<AiTokenUsageView | undefined>(undefined)
  /** tokens billed across the panel's session (the composer chip) */
  const [sessionUsage, setSessionUsage] = useState<AiTokenUsageView | undefined>(undefined)

  // ── Chat-history persistence ────────────────────────────────────────────
  useEffect(() => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api) return
    const tempChatId = `unsaved-${Date.now()}`
    void api
      .resolveChat({ filePath: filePath ?? null, tempChatId })
      .then((ids) => {
        chatRefIds.current = ids
        return api.loadChat({ projectId: ids.projectId, chatId: ids.chatId, limit: 200 })
      })
      .then((msgs) => {
        if (msgs.length === 0) return
        // answered receipts belong to the live turn they were given in: drop them with a reload
        setChat((prev) => withoutReceipts(prev))
        setHistoricChat(
          msgs.map((m) => ({
            role: m.role,
            text: m.text,
            tools: m.tools?.map((t) => ({
              name: t.name,
              summary: t.summary,
              isError: t.isError,
              output: t.output ? t.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
            })),
            // stored metadata only: no thumbnail read for history, the chips render name/size
            attachments: m.attachments
              ?.filter((a) => a.path)
              .map((a) => ({
                name: a.name,
                path: a.path ?? '',
                ext: a.ext ?? '',
                sizeBytes: a.sizeBytes ?? 0,
              })),
            ...(m.scope ? { scope: m.scope } : {}),
          })),
        )
        // restore model context: follow-ups after reopening a file continue the previous conversation (only when the loop is idle with no history)
        loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
      })
      .catch(() => {
        /* history load failures are silent */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** After an unsaved document's first save yields a real path, bind the unsaved-* history to that file (recoverable by path on reopen) */
  useEffect(() => {
    const ids = chatRefIds.current
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api || !ids || !filePath || !ids.chatId.startsWith('unsaved-')) return
    void api
      .rebindChat({ projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: filePath })
      .then((r) => {
        if (r?.chatId) chatRefIds.current = r
      })
      .catch(() => {
        /* silent */
      })
  }, [filePath])

  // the document got a file (Ctrl+S, Save As): the ask card has nothing left to ask
  useEffect(() => {
    if (filePath) setSaveOffer(null)
  }, [filePath])

  // answered receipts belong to the document they were given for: drop them when another
  // one opens (an untitled document getting its first path is the same document)
  const receiptPathRef = useRef(filePath)
  useEffect(() => {
    const previous = receiptPathRef.current
    receiptPathRef.current = filePath
    if (previous && previous !== filePath) setChat((prev) => withoutReceipts(prev))
  }, [filePath])

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: Array<{
      name: string
      summary: string
      isError?: boolean
      input?: string
      output?: string
    }>,
    attachments?: AttachmentMeta[],
    scope?: AiScopeQuoteData,
  ) => {
    const ids = chatRefIds.current
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!ids || !api) return
    void api
      .appendChat({
        projectId: ids.projectId,
        chatId: ids.chatId,
        role,
        text,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(attachments && attachments.length > 0
          ? {
              attachments: attachments.map((a) => ({
                name: a.name,
                path: a.path,
                ext: a.ext,
                sizeBytes: a.sizeBytes,
              })),
            }
          : {}),
        ...(scope ? { scope } : {}),
      })
      .catch(() => {
        /* silent */
      })
  }

  const patchLastAssistant = (
    patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>),
  ) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }
      // bounded: this is where a finished run's full-document snapshot lands
      return boundChatHistory(next)
    })
  }

  const transportRef = useRef<ReturnType<typeof createElectronTransport> | null>(null)
  if (!transportRef.current)
    transportRef.current = createElectronTransport(() => settingsRef.current)

  /**
   * Long-form writing: one tool-less request whose reply is the fragment, streamed
   * into the document as a draft by the tool. A stream that stops early leaves the
   * user a keep-or-discard choice; a stream that produced nothing is retried once.
   */
  const runDocWriter = async (
    spec: DocWriteSpec,
    onProgress: (html: string) => void,
    signal?: AbortSignal,
  ): Promise<DocWriteResult> => {
    const { system, user, writer } = buildDocWriterRequest(spec, aiLangDirective())
    const epoch = writerEpochRef.current
    let closed = false
    let chipTimer: ReturnType<typeof setTimeout> | null = null
    let latest = ''
    const updateChip = () => {
      chipTimer = null
      if (closed) return
      const blocks = countFragmentBlocks(latest)
      patchLastAssistant((last) => ({
        tools: last.tools?.map((tl) =>
          tl.running ? { ...tl, summary: tModule('aiWritingDocument', { blocks }) } : tl,
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
        writer,
        extract: (raw) => ({ text: extractFragment(raw) }),
        onProgress: (html) => {
          if (closed) return
          latest = html
          onProgress(html)
          if (chipTimer === null) chipTimer = setTimeout(updateChip, CHIP_UPDATE_MS)
        },
      })
    let outcome = await attempt()
    if (outcome.status === 'empty' && !signal?.aborted) outcome = await attempt()
    closed = true
    if (chipTimer !== null) clearTimeout(chipTimer)
    if (outcome.status === 'complete') return { ok: true, html: outcome.text }
    if (outcome.status === 'empty') return { ok: false, error: outcome.error }
    if (epoch !== writerEpochRef.current) return { ok: false, error: 'the chat was reset' }
    // the draft stays in the document while the user decides
    const keep = await new Promise<boolean>((resolve) => {
      partialResolverRef.current = resolve
      setActivePartial({ blocks: countFragmentBlocks(outcome.text) })
    })
    return keep
      ? { ok: true, html: outcome.text, truncated: true }
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

  /** folds a run's document changes into one undo step (the loop's run hooks drive it) */
  const runHistoryRef = useRef<DocsRunHistoryGroup | null>(null)
  if (!runHistoryRef.current)
    runHistoryRef.current = createDocsRunHistoryGroup({
      onBlockedInput: () => setEditsPaused(true),
    })
  useEffect(() => {
    const group = runHistoryRef.current!
    group.attach(editor)
    return () => group.attach(null)
  }, [editor])

  const loopRef = useRef<AgentLoop<AiRunSnapshot> | null>(null)
  if (!loopRef.current) {
    const numIds = (): NumIds => ({
      bullet: findNumId(blocksRef.current, 'bullet') ?? numIdFallbackRef.current?.bullet ?? null,
      ordered: findNumId(blocksRef.current, 'ordered') ?? numIdFallbackRef.current?.ordered ?? null,
    })
    loopRef.current = new AgentLoop<AiRunSnapshot>({
      transport: transportRef.current,
      systemSuffix: aiLangDirective,
      skill: composeSkills('docs+files', '', [
        createDocsSkill(
          () => editorRef.current,
          numIds,
          () => aiTrackFor(trackChangesRef.current, protectionRef.current, AI_REVISION_AUTHOR),
          () => commentsAccessRef.current,
          () => hfAccessRef.current,
          () => imageGenerationAvailable(settingsRef.current, gskLoggedInRef.current),
          () => ({
            write: (spec, onProgress, signal) => runDocWriterRef.current(spec, onProgress, signal),
          }),
          () => pageSetupAccessRef.current,
          () => docExtrasRef.current,
          () => notesAccessRef.current,
          () => mediaAnalysisAvailable(settingsRef.current, gskLoggedInRef.current),
          () => readOnlyRef.current,
          // the adapter bound feeds the AI through the shared rule: a web frame reads as bound
          () => docsUniworkBoundForAi(boundRef.current ?? false),
          () => askClarification,
          () => protectionRef.current,
          // an image URL the AI inserts must come from this run's image_search / generate_image or
          // an image attached to its message (UniWork AI turns only; BYOK keeps today's rules)
          createImageUrlRegistry({
            enforce: () => settingsRef.current.provider === 'uniwork',
            attachments: () =>
              lastAttachmentsRef.current
                .filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
                .map((a) => a.path),
          }),
        ),
        createFilesSkill(availableAttachments),
      ]),
      captureSnapshot: () => captureRunSnapshot(editorRef.current, sideStateRef.current),
      events: {
        ...runHistoryEvents(runHistoryRef.current),
        onText: (text) => patchLastAssistant({ text, waitLine: undefined }),
        // module-level getLang: the loop is created once, the component's lang would go stale
        onNotice: (notice) => {
          // the question was not sent: it goes back into the composer for the user to send again
          if (notice.kind === 'conversation-restarted')
            setInput((current) => current || lastInstructionRef.current)
          patchLastAssistant(
            (last) =>
              noticePatch(
                last,
                notice,
                (key, params) => aiUniworkText(getLang(), key, params),
                'Docs',
              ) ?? {},
          )
        },
        onToolStart: (call) => {
          // after a save, side changes are measured from the reloaded state: for every rollback
          // point still offered, an older run's too (its Roll back rewinds past this run, so
          // what this run changes and a later save writes is kept for it as well)
          const side = sideStateRef.current
          if (side) {
            let now: unknown
            for (const snap of [
              runSnapshotRef.current,
              ...chatRef.current.map((e) => e.snapshot),
            ]) {
              if (snap?.side === undefined) continue
              const k = keptOf(snap)
              if (k.base === null) k.base = now ??= side.capture()
            }
          }
          // Live "running" chip: replaced in place by onToolExecuted
          patchLastAssistant((last) => ({
            tools: [
              ...(last.tools ?? []),
              { name: call.name, summary: call.name.replace(/[_-]+/g, ' '), running: true },
            ],
          }))
        },
        onToolExecuted: ({ call, execution, snapshotBefore }) => {
          // The run's first pre-edit state wins so one roll-back undoes the whole run
          if (snapshotBefore && !runSnapshotRef.current) runSnapshotRef.current = snapshotBefore
          // tracking off: the edited blocks keep the AI marker until the user Accepts or Saves;
          // tracking on: revisions stay pending, handled in the Review tab
          // mind maps ride the UI-only display side channel onto the message
          const display = execution.display
          const mindmap = display?.kind === 'mindmap' ? display.tree : undefined
          runToolsRef.current.push({
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            input: safeJsonInput(call.input),
            output: execution.output
              ? execution.output.slice(0, PERSIST_TOOL_FIELD_MAX)
              : undefined,
          })
          patchLastAssistant((last) => {
            // Swap out the running placeholder pushed by onToolStart (parse-fail calls have none)
            const tools = [...(last.tools ?? [])]
            if (tools.at(-1)?.running) tools.pop()
            return {
              tools: [
                ...tools,
                {
                  name: call.name,
                  summary: execution.summary,
                  isError: execution.isError,
                  output: execution.output
                    ? execution.output.slice(0, TOOL_OUTPUT_MAX_CHARS)
                    : undefined,
                },
              ],
              ...(mindmap ? { mindmap } : {}),
            }
          })
        },
        onTurnEnd: () => {
          patchLastAssistant({ streaming: false, waitLine: undefined })
          setChat((prev) =>
            boundChatHistory([...prev, { role: 'assistant', text: '', streaming: true }]),
          )
        },
        onUsage: (usage) => {
          runUsageRef.current = addTokenUsage(runUsageRef.current, usage)
          setSessionUsage((prev) => addTokenUsage(prev, usage))
          patchLastAssistant({ usage: runUsageRef.current })
        },
        onDone: ({ text, cancelled, turnLimit, truncated }) => {
          // module-level t: the loop instance is created only once; the component's t goes stale with the first-render closure
          const baseText = turnLimit
            ? [text, tModule('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tModule('aiStopped') : '')
          const finalText = truncated
            ? [baseText, tModule('aiTruncatedNote')].filter(Boolean).join('\n\n')
            : baseText
          patchLastAssistant((last) => ({
            streaming: false,
            waitLine: undefined,
            turnLimit,
            stopped: cancelled,
            streamedText: Boolean(text?.trim()),
            // a restarted conversation or UniWork AI being off ends the turn on purpose: the note is the whole reply
            text:
              finalText ||
              (last.tools?.length || endsQuietly(last.notes) ? last.text : tModule('aiNoReply')),
            // A stop mid-tool can leave a running placeholder behind — drop it
            tools: last.tools?.filter((tl) => !tl.running),
            snapshot: runSnapshotRef.current ?? undefined,
          }))
          setBusy(false)
          // App listens: a run that changed a never-saved document gets the ask card (offerSave);
          // nothing is written before the user's Save
          const detail: AiRunDoneDetail = {
            mutated: runSnapshotRef.current !== null,
            offerSave: (name) => setSaveOffer({ name }),
          }
          window.dispatchEvent(new CustomEvent(AI_RUN_DONE_EVENT, { detail }))
          // persist outside the updater (a double-invoked updater would write history twice); tools stores the whole run's full activity.
          // Edits-only runs (tools ran, no text) persist too, or the whole turn vanishes from the restored transcript
          if (!cancelled && (finalText || runToolsRef.current.length > 0)) {
            persistMessage('assistant', finalText, runToolsRef.current)
          }
        },
        onError: (error, errorKey) => {
          // a refused question (too long, rejected) was not answered: it goes back into the composer
          // to be shortened or fixed, as the message says
          if (isUniworkRefusalErrorKey(errorKey))
            setInput((current) => current || lastInstructionRef.current)
          setChat((prev) => {
            const next = [...prev]
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                errorKey,
                waitLine: undefined,
                error,
                tools: last.tools?.filter((tl) => !tl.running),
                snapshot: runSnapshotRef.current ?? undefined,
              }
            }
            return boundChatHistory(next)
          })
          setBusy(false)
        },
      },
    })
  }

  // one question per preset: StrictMode's second effect run and a remount find it taken
  const ownPresetSeen = useRef<number | null>(null)
  const presetNonceRef = presetSeen ?? ownPresetSeen
  useEffect(() => {
    if (!preset || presetNonceRef.current === preset.nonce) return
    presetNonceRef.current = preset.nonce
    // the run lands in the chat: leave Ask UNI so it is the one on screen
    askUni.leave()
    // a preset that does not run waits in the composer, word for word; the composer takes focus once
    // the chat pane shows, unless a refusal moved it to the UniWork AI disclosure (acknowledge first)
    const toComposer = (refused: boolean) => {
      setInput(preset.text)
      if (!(refused && uniworkGate.isBlocked())) askUni.leave(() => inputRef.current?.focus())
    }
    // the text goes out word for word (a host job is recognised by it, UNI-2264). One that cannot
    // run now (busy, no model yet, the UniWork AI disclosure not acknowledged) waits in the composer
    const take = () => {
      if (!preset.autoRun) toComposer(false)
      else if (!runWith(preset.text, preset.displayText ?? preset.text)) toComposer(true)
    }
    // a host job runs only on UniWork AI: the provider is the one of now, not of when it arrived
    if (!preset.uniworkOnly) take()
    else
      void aiPanelOnUniwork(() => window.desktop.getAiSettings()).then((on) =>
        on ? take() : toComposer(false),
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce])

  // keep the scope hint & quick actions in sync with the editor selection
  // (skip while collapsed — dock stays mounted but must not re-render per keystroke)
  useEffect(() => {
    if (!open) return
    let raf = 0
    const bump = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (editor.state.selection.empty) setScopePreviewOpen(false)
        setScopeTick((t) => t + 1)
      })
    }
    bump()
    editor.on('selectionUpdate', bump)
    editor.on('update', bump)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      editor.off('selectionUpdate', bump)
      editor.off('update', bump)
    }
  }, [editor, open])

  // scope chip data, recomputed per render (the scope tick above keeps it fresh)
  const liveSelection = editor.state.selection
  const selectionText = liveSelection.empty
    ? ''
    : redactTextBetween(
        editor.getJSON() as RedactableNode,
        liveSelection.from,
        liveSelection.to,
        '\n',
      )
        .replace(/\s+/g, ' ')
        .trim()
  const hasScopeSelection = selectionText.length > 0

  /** the × on the scope chip: collapse the selection so the run targets the whole document */
  const clearScopeSelection = () => {
    editor.commands.setTextSelection(editor.state.selection.to)
  }

  const selectionScopeQuote = (): AiScopeQuoteData | undefined => {
    const { from, to, empty } = editor.state.selection
    if (empty) return undefined
    const text = redactTextBetween(editor.getJSON() as RedactableNode, from, to, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) return undefined
    return {
      label: t('aiScopeSelection', { words: countWords(text) }),
      text: text.length > SCOPE_TEXT_MAX ? `${text.slice(0, SCOPE_TEXT_MAX)}…` : text,
    }
  }

  // the frozen-range highlight ends with the run, or as soon as the editor is focused again
  useEffect(() => {
    if (!busy) setInactiveSelectionShown(editor, false)
  }, [busy, editor])
  useEffect(() => {
    const off = () => setInactiveSelectionShown(editor, false)
    editor.on('focus', off)
    return () => {
      editor.off('focus', off)
    }
  }, [editor])

  /** [label](docnav://block/N) links in replies select and scroll to that block */
  const docNav = {
    scheme: DOC_NAV_SCHEME,
    onNavigate: (href: string) => {
      const index = parseDocNavHref(href)
      if (index !== null) navigateToBlock(editorRef.current, index)
    },
  }

  // follow the stream, but stop yanking once the user scrolls up to read;
  // `open` dep: re-expanding lands on messages streamed while collapsed
  useEffect(() => {
    if (stickToBottomRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
    }
  }, [chat, open])

  const onLogScroll = () => {
    const el = logRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const run = () => runWith(input.trim())

  /** Image attachments are read as base64 and go multimodal with this user message (≤5MB per image, max 20) */
  const MAX_IMAGES_PER_MESSAGE = 20
  const collectImageAttachments = async (atts: AttachmentMeta[]): Promise<AgentImage[]> => {
    const imageAtts = atts.filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
    const images: AgentImage[] = []
    const failures: string[] = []
    for (const att of imageAtts.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      const result = await window.desktop.readAttachmentImage(att.path)
      if (result.ok && result.base64 && result.mime) {
        images.push({ base64: result.base64, mime: result.mime })
      } else {
        failures.push(result.error ?? t('aiImageReadFail', { name: att.name }))
      }
    }
    if (imageAtts.length > MAX_IMAGES_PER_MESSAGE) {
      failures.push(t('aiTooManyImages', { max: MAX_IMAGES_PER_MESSAGE }))
    }
    if (failures.length > 0) {
      setAttachNotice(failures.join(';'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
    return images
  }

  const runWith = (
    instruction: string,
    displayInstruction = instruction,
    attachmentsOverride?: AttachmentMeta[],
    /** null = a retry that had no scope; undefined = capture the live selection */
    retryScope?: AiScopeQuoteData | null,
  ): boolean => {
    const loop = loopRef.current
    if (needModelHint !== null || !instruction || !loop || loop.busy || pendingSendRef.current)
      return false
    // presets, retry and continue refuse like Send until the UniWork disclosure is acknowledged
    if (uniworkGate.refuse()) return false
    setInput('')
    // The message consumes the composer attachments: they ride along (echoed on the
    // bubble, images multimodal, files via the files skill) and the composer clears.
    const sentAtts = attachmentsOverride ?? attachmentsRef.current
    if (!attachmentsOverride && sentAtts.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...sentAtts.filter((a) => !seen.has(a.path)),
      ]
      setAttachments([])
    }
    lastAttachmentsRef.current = sentAtts
    // the queue batch and the continue action carry their own display text: no selection quote
    const scope =
      retryScope !== undefined
        ? (retryScope ?? undefined)
        : displayInstruction === instruction
          ? selectionScopeQuote()
          : undefined
    lastScopeRef.current = scope
    // the popover input / composer own the DOM selection now: keep the targeted range visible until the run ends
    if (scope) setInactiveSelectionShown(editor, true)
    instructionRef.current = instruction
    lastInstructionRef.current = instruction
    runToolsRef.current = []
    runSnapshotRef.current = null
    runUsageRef.current = undefined
    // a new run replaces an unanswered ask card
    setSaveOffer(null)
    stickToBottomRef.current = true
    setChat((prev) =>
      boundChatHistory([
        ...prev,
        {
          role: 'user',
          text: displayInstruction,
          ...(sentAtts.length > 0 ? { attachments: sentAtts } : {}),
          ...(scope ? { scope } : {}),
        },
        { role: 'assistant', text: '', streaming: true },
      ]),
    )
    runStartedAtRef.current = Date.now()
    setBusy(true)
    // claimed before the async image read so Stop / New chat can flag this send at any point
    const generation = currentDocGeneration()
    const pending = { aborted: false }
    pendingSendRef.current = pending
    persistMessage('user', instruction, undefined, sentAtts, scope)
    // a rejected image read must not strand the run (busy would stay true forever): degrade to a no-image send
    void collectImageAttachments(sentAtts)
      .catch((): AgentImage[] => {
        setAttachNotice(t('aiImagesSendFailed'))
        window.setTimeout(() => setAttachNotice(null), 5000)
        return []
      })
      // a phased open still streaming its tail: the context must describe the whole document
      .then(async (images) => {
        await waitForFullContent()
        // a newer send (after New chat) owns the panel now: leave its state alone
        if (pendingSendRef.current !== pending) return
        pendingSendRef.current = null
        // the wait ended because another document replaced this one, or the
        // user stopped / reset the chat meanwhile: nothing to run
        if (pending.aborted || currentDocGeneration() !== generation) {
          setChat((prev) =>
            prev.filter(
              (m, i) => !(i === prev.length - 1 && m.role === 'assistant' && m.streaming),
            ),
          )
          setBusy(false)
          return
        }
        return loop.run(instruction, images)
      })
    return true
  }

  const cancel = () => {
    if (pendingSendRef.current) pendingSendRef.current.aborted = true
    dismissClarify()
    loopRef.current?.cancel()
    inputRef.current?.focus()
  }

  /** submit every still-anchored queued edit as one batch run */
  const sendQueue = () => {
    const loop = loopRef.current
    if (!loop || loop.busy || editQueue.length === 0) return
    const entries = liveItems(resolveQueue(editorRef.current, editQueue))
    if (entries.length === 0) {
      onQueueClear?.()
      return
    }
    const instruction = buildQueueInstruction(entries)
    const display = buildQueueSummary(t('aiQueueSubmitted', { count: entries.length }), entries)
    // consumed at send: the run rewrites the anchored passages, which would
    // orphan the anchors anyway; a failed run is retried via the retry action
    onQueueConsume?.(editQueue.map((item) => item.qid))
    runWith(instruction, display)
  }

  const retry = () =>
    runWith(
      lastInstructionRef.current,
      lastInstructionRef.current,
      lastAttachmentsRef.current,
      lastScopeRef.current ?? null,
    )

  const continueRun = () => runWith(DOCS_CONTINUE_INSTRUCTION, t('aiContinue'))

  /** Enter while a reply runs: the draft joins the queue above the composer */
  const enqueueDraft = () => {
    const text = input.trim()
    if (!text) return
    // snapshot + consume the composer attachments exactly like a send does: the
    // queued message owns them, and pump time hands them to runWith as an override
    const attachments = attachmentsRef.current
    if (attachments.length > 0) {
      const seen = new Set(sentAttachmentsRef.current.map((a) => a.path))
      sentAttachmentsRef.current = [
        ...sentAttachmentsRef.current,
        ...attachments.filter((a) => !seen.has(a.path)),
      ]
      setAttachments([])
    }
    msgQueue.enqueue(text, { attachments, scope: selectionScopeQuote() ?? null })
    setInput('')
  }

  const newChat = () => {
    msgQueue.clear()
    if (pendingSendRef.current) {
      pendingSendRef.current.aborted = true
      pendingSendRef.current = null
    }
    abandonWriter()
    dismissClarify()
    loopRef.current?.reset()
    setBusy(false)
    setChat([])
    setSaveOffer(null)
    // Restored history is painted above the live turn: without this the
    // previous conversation survives "New chat" on screen (#195).
    setHistoricChat([])
    // Unsent composer attachments would otherwise ride into the next chat's
    // file context (availableAttachments merges sent + live). The typed
    // draft itself is kept — only staged files are dropped.
    setAttachments([])
    setAttachNotice(null)
    sentAttachmentsRef.current = []
    inputRef.current?.focus()
  }

  const copyMessage = (text: string, idx: number) => {
    void navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200)
  }

  const mergeAttachments = (result: AttachmentAddResult | null) => {
    if (!result) return
    if (result.accepted.length > 0) {
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        return [...prev, ...result.accepted.filter((a) => !seen.has(a.path))]
      })
    }
    if (result.rejected.length > 0) {
      setAttachNotice(result.rejected.join(';'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
  }

  const pickAttachments = async () => mergeAttachments(await window.desktop.pickAttachments())

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.desktop.getPathForFile(f))
      .filter(Boolean)
    if (paths.length > 0) mergeAttachments(await window.desktop.addAttachmentPaths(paths))
  }

  /** Files pasted into the input: ones with a local path go through regular attachments; pure bitmaps like screenshots hit a temp file first */
  const onPasteFiles = async (files: File[]) => {
    const paths: string[] = []
    for (const f of files) {
      const p = window.desktop.getPathForFile(f)
      if (p) {
        paths.push(p)
        continue
      }
      const ext = PASTE_MIME_EXT[f.type] ?? f.name.split('.').pop()?.toLowerCase() ?? 'bin'
      mergeAttachments(await window.desktop.addPastedImage(await f.arrayBuffer(), ext))
    }
    if (paths.length > 0) mergeAttachments(await window.desktop.addAttachmentPaths(paths))
  }

  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path))

  const acceptChanges = () => {
    applyRevisionsBy(editorRef.current, AI_REVISION_AUTHOR, 'accept')
    clearAiHighlights()
  }

  // a Save accepts the marker: saveOnce fires this right before it snapshots the document, so
  // the cleared marker is part of what it compares against the reloaded file (history survives)
  useEffect(() => {
    const onSave = (e: Event) => {
      // what the run changed beside the text is written now: Roll back cannot take it back
      const side = sideStateRef.current
      if (side?.changedParts) {
        const now = side.capture()
        for (const snap of [runSnapshotRef.current, ...chatRef.current.map((e) => e.snapshot)]) {
          if (snap?.side === undefined) continue
          const k = keptOf(snap)
          if (k.base === null) continue
          for (const part of side.changedParts(k.base, now)) k.parts.add(part)
          k.base = null
        }
      }
      // only the user's own Save accepts the marker; an autosave leaves it on screen (the saved
      // bytes never carry it, and the post-save reload ignores it)
      if ((e as CustomEvent<{ auto?: boolean } | undefined>).detail?.auto !== true)
        clearAiHighlights()
    }
    window.addEventListener('ai-docs-commit-tables', onSave)
    return () => window.removeEventListener('ai-docs-commit-tables', onSave)
  }, [])

  // tracked-changes protection forces tracking on: the pill shows it on and cannot switch it off
  // (switching off accepts the AI's revisions, which would bypass the forced tracking)
  const trackForced = protection === 'trackedChanges'
  const trackShown = aiTracksChanges(trackChanges, protection)

  const toggleTrackChanges = () => {
    if (trackForced) return
    const next = !trackChanges
    setTrackChanges(next)
    localStorage.setItem(TRACK_CHANGES_KEY, next ? '1' : '0')
    // switching off keeps nothing pending: accept whatever is still highlighted
    if (!next) acceptChanges()
  }

  const rollback = (entryIdx: number, snapshot: AiRunSnapshot) => {
    const side = sideStateRef.current
    const k = keptRef.current.get(snapshot)
    // the PM tree plus the state saved beside it (comments, header/footer, styles, page setup, watermark)
    const { sideRestored } = restoreRunSnapshot(editor, snapshot, side)
    // a save since the run re-read the file: only the text came back, so say what stayed
    let kept: AiSidePart[] = []
    if (snapshot.side !== undefined && !sideRestored && side?.changedParts) {
      const parts = new Set(k?.parts)
      const base = k ? k.base : snapshot.side
      if (base !== null) for (const part of side.changedParts(base, side.capture())) parts.add(part)
      kept = AI_SIDE_PARTS.filter((part) => parts.has(part))
    }
    // The document rewound to before this turn, so this and every later
    // rollback point now describe discarded futures
    setChat((prev) =>
      prev.map((e, i) =>
        i === entryIdx
          ? { ...e, snapshot: undefined, rollbackKept: kept.length > 0 ? kept : undefined }
          : i > entryIdx && e.snapshot
            ? { ...e, snapshot: undefined }
            : e,
      ),
    )
  }

  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanupRef.current?.(), [])

  /** Drag the inner panel edge to resize from the selected window side. */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const resizer = e.currentTarget
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent) => {
      const w = clampPanelWidth(aiPanelWidthAtPointer(ev.clientX))
      preferredWidthRef.current = w
      setPanelWidth(w)
    }
    let done = false
    const cleanup = () => {
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
    // lostpointercapture also fires if the resizer is unmounted mid-drag (panel collapse)
    resizer.addEventListener('lostpointercapture', cleanup)
    resizer.setPointerCapture(e.pointerId)
  }

  const isUniwork = settings.provider === 'uniwork'
  const [cloudSnapshot, setCloudSnapshot] = useState<UniworkCloudSnapshotLike | null>(null)
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
  }, [])
  const composerNoteState = composerNoteFor({
    provider: settings.provider,
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
  // The ack key holds the document path, and an untitled document's first Save gives it one: the
  // same document must not be asked again, so the ack of the untitled key moves to the new path
  // (layout effect: the card never paints for the one render in between)
  const ackPathRef = useRef(filePath)
  useLayoutEffect(() => {
    const previous = ackPathRef.current
    ackPathRef.current = filePath
    if (!isUniwork || previous || !filePath) return
    const account = cloudSnapshot?.accountId ?? ''
    const org = cloudSnapshot?.orgId ?? ''
    if (isUniworkDisclosureAcked({ account, org, document: 'local' })) {
      ackUniworkDisclosure({ account, org, document: filePath })
    }
  }, [filePath, isUniwork, cloudSnapshot])
  uniworkGate.setPanelBlocked(isUniwork && !uniworkDisclosureAcked)
  // a refusal while collapsed expands the panel; once open it announces and focuses the disclosure
  uniworkGate.setPanelOpen(open, onExpand)
  useEffect(() => {
    if (open) uniworkGate.flushPendingRefusal()
  }, [open, uniworkGate])

  /** some block still carries the AI marker (read per render; the scope tick follows doc updates) */
  const hasAiMarks = (): boolean => docHasAiMarks(editor.state.doc)

  const focusFirstAiChange = () => {
    let targetPos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (targetPos !== null) return false
      if (node.attrs?.aiChanged) {
        targetPos = pos
        return false
      }
      return true
    })
    if (targetPos !== null) {
      editor.commands.focus(targetPos + 1)
    } else {
      editor.commands.focus()
    }
  }

  // collapsed: rail only — after all hooks, so the instance and its state survive
  if (!open) {
    // the sidebar setting is off: nothing to show until an explicit AI action opens the panel
    if (hideRail) return null
    return (
      <button
        className="ai-rail"
        data-tip={t('appExpandAiPanel')}
        aria-label={t('appExpandAiPanel')}
        onClick={onExpand}
      >
        <UniAiMark size={22} />
      </button>
    )
  }

  const lastEntry = chat[chat.length - 1]
  // Accept sits under the latest turn that edited the document, while a marker is left
  let lastEditIdx = -1
  for (let k = chat.length - 1; k >= 0; k--) {
    if (chat[k]!.snapshot) {
      lastEditIdx = k
      break
    }
  }
  const acceptAt = !busy && lastEditIdx >= 0 && hasAiMarks() ? lastEditIdx : -1
  const panelLiveAnnouncement =
    chat.length > 0 || busy
      ? computePanelLiveAnnouncement({
          entries: chat,
          busy,
          translate: (key, vars) => aiUniworkText(lang, key, vars),
          lastEntryChipInput:
            lastEntry && lastEntry.role === 'assistant'
              ? {
                  provider: settings.provider,
                  mutated: Boolean(lastEntry.snapshot),
                  stopped: Boolean(lastEntry.stopped),
                  hasStreamedText: lastEntry.streamedText ?? Boolean(lastEntry.text?.trim()),
                  clarifyAsked: Boolean(lastEntry.clarifyReceipts?.length),
                  droppedToolCalls: droppedCallsOfNotes(lastEntry.notes),
                  toolExecutions: lastEntry.tools,
                  error: uniworkErrorForEntry(lastEntry.errorKey, lastEntry.error),
                }
              : null,
        })
      : composerAnnouncement

  const liveText =
    pickerNote && pickerNote.over === panelLiveAnnouncement
      ? pickerNote.text
      : panelLiveAnnouncement
  return (
    <aside
      ref={asideRef}
      style={{ width: '100%' }}
      dir={isRtl ? 'rtl' : undefined}
      className={`ai-panel${dragOver ? ' ai-panel-dragover' : ''}${resizing ? ' ai-panel-resizing' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <div
        className="ai-panel-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('aiPanelTitle')}
      />
      <div className="ai-panel-header">
        <span className="ai-panel-title">
          <UniAiMark size={22} />
          {t('aiPanelTitle')}
        </span>
        <div className="ai-panel-header-actions">
          <AiPanelSideButton
            lang={lang}
            onMove={(side) => window.desktop.setAiPanelPrefs({ side })}
          />
          <AskUniModeToggle mode={askUni} lang={lang} />
          {(chat.length > 0 || historicChat.length > 0) && !askUni.active && (
            <button
              className="ai-header-btn"
              onClick={newChat}
              data-tip={t('aiNewChatTitle')}
              aria-label={t('aiNewChatTitle')}
            >
              <IconNewChat size={16} />
            </button>
          )}
          {cap('aiCredentials') && window.desktop?.openAiSettings && (
            <button
              className="ai-header-btn"
              onClick={() => void window.desktop?.openAiSettings?.()}
              data-tip={t('appAiSettings')}
              aria-label={t('appAiSettings')}
            >
              <IconGear size={15} />
            </button>
          )}
          {onCollapse && (
            <button
              className="ai-header-btn ai-panel-collapse"
              onClick={onCollapse}
              data-tip={t('aiCollapseTitle')}
              aria-label={t('aiCollapseTitle')}
            >
              <IconSidebarCollapse size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Single panel-level polite live region: announces transport notices while running and the finished answer once when it ends */}
      <div className="ai-sr-status" aria-live="polite" aria-atomic="true">
        {askUniLiveText(askUni, liveText)}
      </div>

      <AskUniModeBody mode={askUni} documentName={askUniFileName(filePath ?? null)} />

      <div {...askUniChatPaneProps(askUni)}>
        <div
          ref={logRef}
          className="ai-chat"
          aria-busy={busy ? 'true' : undefined}
          onScroll={onLogScroll}
        >
          {/* past conversation (read-only transcript, not fed to the model), shown continuously with the current turn */}
          {historicChat.length > 0 && (
            <>
              {historicChat.map((entry, i) => (
                <div key={`h${i}`} className={`ai-msg ai-msg-${entry.role} ai-msg-historic`}>
                  {entry.role === 'user' && entry.scope && <AiScopeQuote scope={entry.scope} />}
                  {entry.role === 'user' && entry.attachments && entry.attachments.length > 0 && (
                    <SentAttachments atts={entry.attachments} previews={attachmentPreviews} />
                  )}
                  {entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
                  {entry.text && (
                    <div dir="auto">
                      <Markdown text={entry.text} nav={docNav} />
                    </div>
                  )}
                </div>
              ))}
              <div className="ai-history-sep">{t('aiHistorySep')}</div>
            </>
          )}
          {chat.length === 0 && historicChat.length === 0 && (
            <div className="ai-chat-empty">
              <div className="ai-chat-empty-title">
                {t(docEmpty ? 'aiEmptyDraftTitle' : 'aiEmptyTitle')}
              </div>
              <div className="ai-chat-empty-body">
                {t(docEmpty ? 'aiEmptyDraftBody1' : 'aiEmptyBody1')}
                <br />
                {t(docEmpty ? 'aiEmptyDraftBody2' : 'aiEmptyBody2')}
              </div>
              <div className="ai-starter-list">
                {(readOnly
                  ? docEmpty
                    ? []
                    : READ_ONLY_STARTER_PROMPTS
                  : docEmpty
                    ? DRAFT_STARTER_PROMPTS
                    : EDIT_STARTER_PROMPTS
                ).map((p) => (
                  <button
                    key={p}
                    className="ai-starter"
                    onClick={() => {
                      setInput(t(p))
                      inputRef.current?.focus()
                    }}
                  >
                    {t(p)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chat.map((entry, i) => {
            if (
              entry.role === 'assistant' &&
              !entry.text &&
              !entry.streaming &&
              !entry.error &&
              !entry.notes?.length &&
              !entry.tools?.length &&
              !entry.stopped &&
              !entry.snapshot &&
              !entry.rollbackKept
            ) {
              return null
            }
            const isLast = i === chat.length - 1
            // Action row appears once per completed reply: on the turn's final segment only
            // (mid-turn segments have a following assistant entry; the live turn ends when !busy)
            const turnEnded = isTurnEnded(chat, i, busy)
            const showToolbar =
              entry.role === 'assistant' &&
              !entry.streaming &&
              turnEnded &&
              // edits-only turns have no text but still carry the rollback point
              !!(entry.text || entry.error || entry.snapshot)
            const chipView = getEntryResultChipView(
              chat,
              i,
              busy,
              (key, vars) => aiUniworkText(lang, key, vars),
              {
                provider: settings.provider,
                mutated: Boolean(entry.snapshot),
                stopped: Boolean(entry.stopped),
                hasStreamedText: entry.streamedText ?? Boolean(entry.text?.trim()),
                clarifyAsked: Boolean(entry.clarifyReceipts?.length),
                droppedToolCalls: droppedCallsOfNotes(entry.notes),
                toolExecutions: entry.tools,
                error: uniworkErrorForEntry(entry.errorKey, entry.error),
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
                className={`ai-msg ai-msg-${entry.role}${entry.role === 'assistant' && entry.streaming ? ' ai-msg-streaming' : ''}`}
              >
                {entry.role === 'user' && entry.scope && <AiScopeQuote scope={entry.scope} />}
                {entry.role === 'user' && entry.attachments && entry.attachments.length > 0 && (
                  <SentAttachments atts={entry.attachments} previews={attachmentPreviews} />
                )}
                {entry.role === 'assistant' && Boolean(entry.notes?.length || entry.waitLine) && (
                  <div className="ai-msg-live">
                    {entry.notes?.map((note, k) => (
                      <div key={`un${k}`} className="ai-msg-notice">
                        {note.text}
                      </div>
                    ))}
                    {entry.waitLine && <div className="ai-msg-notice">{entry.waitLine}</div>}
                  </div>
                )}
                {entry.role === 'assistant' && !entry.text && entry.streaming ? (
                  <span className="ai-typing-row">
                    <AiTypingIndicator
                      label={entry.tools?.length ? t('aiWorking') : t('aiThinking')}
                    />
                  </span>
                ) : entry.role === 'assistant' ? (
                  <div className="ai-msg-answer" dir="auto">
                    {(bodyText || chipLead) && (
                      <Markdown text={bodyText || ''} nav={docNav} lead={chipLead} />
                    )}
                  </div>
                ) : (
                  <span dir="auto">{entry.text}</span>
                )}
                {stoppedText && (
                  <div className="ai-run-stopped" dir="auto">
                    {stoppedText}
                  </div>
                )}
                {entry.rollbackKept && (
                  <div className="ai-run-stopped ai-rollback-kept" role="status" dir="auto">
                    {t('aiRollbackKept', {
                      parts: entry.rollbackKept
                        .map((part) => t(SIDE_PART_KEYS[part]))
                        .join(t('aiSidePartSep')),
                    })}
                  </div>
                )}
                {(chip?.chip === 'edited' || i === acceptAt) && (
                  <div className="ai-result-actions">
                    <button
                      type="button"
                      className="ai-result-view-changes"
                      onClick={focusFirstAiChange}
                    >
                      {aiUniworkText(lang, 'aiResultViewChanges')}
                    </button>
                    {i === acceptAt && (
                      <button
                        type="button"
                        className="ai-result-view-changes ai-accept-changes"
                        data-tip={t('aiAcceptMarkedTitle')}
                        onClick={() => {
                          clearAiHighlights()
                          setScopeTick((n) => n + 1)
                        }}
                      >
                        {t('aiAcceptMarked')}
                      </button>
                    )}
                    {chip?.chip === 'edited' && (
                      <span className="ai-result-edited-hint">
                        {singleShortcutHint(aiUniworkText(lang, 'aiResultEditedHint'))}
                      </span>
                    )}
                  </div>
                )}
                {entry.role === 'assistant' && entry.usage && (
                  <div className="ai-message-usage">
                    <AiUsageChip usage={entry.usage} lang={lang} />
                  </div>
                )}
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
                {entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
                {entry.mindmap && (
                  <MindMapCard
                    tree={entry.mindmap}
                    onAsk={(label) => {
                      setInput(t('aiMindMapAskPrompt', { label }))
                      inputRef.current?.focus()
                    }}
                    onJumpBlock={(index) => navigateToBlock(editorRef.current, index)}
                  />
                )}
                {entry.error &&
                  (aiNoticeKind(entry.error) ? (
                    // "nothing to chat with" is a setup / plan state: a plain notice, not a red error
                    <div className="ai-msg-notice">{aiNoticeBody(entry.error)}</div>
                  ) : (
                    <div className="ai-msg-error">
                      {uniworkErrorLineText(chip, entry.error, (error) =>
                        t('aiErrorPrefix', { error }),
                      )}
                    </div>
                  ))}
                {entry.error && (
                  <AiErrorAction
                    chip={chip}
                    lang={lang}
                    waiting={Boolean(entry.waitLine)}
                    onRetry={isLast && !busy && lastInstructionRef.current ? retry : undefined}
                    onChooseProvider={() => void window.desktop?.openAiModelSettings?.()}
                    onSignIn={() => void readUniworkCloudStatus()?.signIn?.()}
                    onAskAgain={isLast && !busy ? () => inputRef.current?.focus() : undefined}
                  />
                )}
                {cap('billing') && entry.error && aiNoticeKind(entry.error) && (
                  <div className="ai-msg-actions">
                    <button
                      className="ai-login-btn"
                      onClick={() => void window.desktop.aiOpenBilling?.()}
                    >
                      {t('aiOpenSettingsBtn')}
                    </button>
                  </div>
                )}
                {showToolbar && (
                  <div className="ai-msg-toolbar">
                    {entry.text && (
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
                    )}
                    {isLast &&
                      !busy &&
                      lastInstructionRef.current &&
                      !aiNoticeKind(entry.error) &&
                      !isUniworkRefusalErrorKey(entry.errorKey) &&
                      // the labelled "Thử lại" under the error line is the retry of an error turn
                      chip?.errorLine?.action !== 'retry' && (
                        <button
                          className="ai-msg-tool-btn"
                          onClick={retry}
                          aria-label={t('aiRegenerateTitle')}
                          data-tip={t('aiRegenerateTitle')}
                        >
                          {/* 24-canvas glyph at 18px (near-full-bleed paths, sized for optical
                          parity with the copy icon): stroke 1.5 paints 1.125px (1:16) */}
                          <svg
                            style={{ width: 18, height: 18 }}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M3.68881 9.85339C4.1791 8.0054 5.28205 6.30704 6.9459 5.09101C10.8046 2.27085 16.2188 3.11279 19.0389 6.97147C19.7242 7.90904 20.1932 8.93842 20.4553 10.0001" />
                            <path d="M2.00452 8.46411L2.87229 10.7059C2.96814 10.9535 3.24658 11.0765 3.4942 10.9807L5.73594 10.1129" />
                            <path d="M20.3308 14.4908C19.8405 16.3388 18.7376 18.0372 17.0738 19.2532C13.215 22.0734 7.80083 21.2314 4.98071 17.3728C4.22167 16.3342 3.72792 15.183 3.48686 13.9999" />
                            <path d="M22.0151 15.8801L21.1474 13.6384C21.0515 13.3908 20.7731 13.2677 20.5255 13.3636L18.2837 14.2314" />
                          </svg>
                        </button>
                      )}
                    {entry.snapshot && (
                      <>
                        {/* hairline between reply actions (icons) and the document action (icon+label);
                          CSS shows it only when an icon button actually precedes it */}
                        <span className="ai-rollback-sep" aria-hidden />
                        <RollbackButton
                          disabled={busy}
                          onClick={() => rollback(i, entry.snapshot!)}
                        />
                      </>
                    )}
                  </div>
                )}
                {entry.turnLimit && isLast && !busy && (
                  <button className="ai-continue-btn" onClick={continueRun}>
                    {t('aiContinue')}
                  </button>
                )}
              </div>
            )
          })}
          {saveOffer && !busy && (
            <AiSaveDraftCard
              lang={lang}
              name={saveOffer.name}
              onSave={() => {
                setSaveOffer(null)
                const detail: AiSaveOfferDetail = { name: saveOffer.name }
                window.dispatchEvent(new CustomEvent(AI_SAVE_OFFER_EVENT, { detail }))
              }}
              onLater={() => setSaveOffer(null)}
            />
          )}
        </div>

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
            <div className="ai-readonly-notice">{t('aiViewOnlyNotice')}</div>
          )}
          {attachNotice && <div className="ai-attach-notice">{attachNotice}</div>}
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
          {busy && editsPaused && (
            <div className="ai-edits-paused" role="status">
              {t('aiEditsPaused')}
            </div>
          )}
          <EditQueueCard
            items={editQueue}
            editor={editor}
            busy={busy}
            onEditInstruction={(qid, text) => onQueueEditInstruction?.(qid, text)}
            onRemove={(qid) => onQueueRemove?.(qid)}
            onDiscardAll={() => onQueueClear?.()}
            onSend={sendQueue}
            onFocus={(qid) => onQueueFocus?.(qid)}
          />
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
            header={
              (hasScopeSelection || attachments.length > 0) && (
                <>
                  {hasScopeSelection && (
                    <div className="ai-scope-row">
                      <span className="ai-scope-hint">
                        <button
                          type="button"
                          className="ai-scope-label"
                          onClick={() => setScopePreviewOpen((v) => !v)}
                          aria-expanded={scopePreviewOpen}
                          data-tip={t('aiScopeSelectionTip')}
                        >
                          {t('aiScopeSelection', { words: countWords(selectionText) })}
                        </button>
                        <button
                          type="button"
                          className="ai-scope-clear"
                          onClick={clearScopeSelection}
                          data-tip={t('aiScopeClearTitle')}
                          aria-label={t('aiScopeClearTitle')}
                        >
                          <svg width="12" height="12" viewBox="0 0 32 32" aria-hidden>
                            <path
                              d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                              fill="currentColor"
                            />
                          </svg>
                        </button>
                      </span>
                      {scopePreviewOpen && (
                        <div className="ai-scope-preview">
                          {selectionText.length > 400
                            ? `${selectionText.slice(0, 400)}…`
                            : selectionText}
                        </div>
                      )}
                    </div>
                  )}
                  {attachments.length > 0 && (
                    <div className="ai-attachments" onScroll={onAttachmentsScroll}>
                      {attachments.map((a) =>
                        ATTACHMENT_IMAGE_EXTS.has(a.ext) ? (
                          <span key={a.path} className="ai-attachment-thumb" data-tip={a.path}>
                            {attachmentPreviews[a.path] ? (
                              <img src={attachmentPreviews[a.path]} alt={a.name} />
                            ) : (
                              <span className="ai-attachment-thumb-pending" aria-hidden>
                                <img src={fileImageIcon} alt="" />
                              </span>
                            )}
                            <button
                              className="ai-attachment-thumb-remove"
                              onClick={() => removeAttachment(a.path)}
                              data-tip={t('aiRemoveAttachmentTitle')}
                              aria-label={t('aiRemoveAttachmentTitle')}
                            >
                              <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
                                <path
                                  d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                                  fill="currentColor"
                                  stroke="currentColor"
                                  strokeWidth="0.25"
                                />
                              </svg>
                            </button>
                          </span>
                        ) : (
                          <span key={a.path} className="ai-attachment-card" data-tip={a.path}>
                            <span className="ai-attachment-card-icon">
                              <AttachmentCardIcon ext={a.ext} />
                            </span>
                            <span className="ai-attachment-card-meta">
                              <span className="ai-attachment-card-name">
                                {truncateCardName(a.name)}
                              </span>
                              <span className="ai-attachment-card-size">
                                {formatAttachmentSize(a.sizeBytes)}
                              </span>
                            </span>
                            <button
                              className="ai-attachment-thumb-remove"
                              onClick={() => removeAttachment(a.path)}
                              data-tip={t('aiRemoveAttachmentTitle')}
                              aria-label={t('aiRemoveAttachmentTitle')}
                            >
                              <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
                                <path
                                  d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                                  fill="currentColor"
                                  stroke="currentColor"
                                  strokeWidth="0.25"
                                />
                              </svg>
                            </button>
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </>
              )
            }
            value={input}
            busy={busy}
            placeholder={t('aiInputPlaceholder')}
            hintIdle={t('aiHintIdle')}
            hintBusy={t('aiHintBusy')}
            hintIdleTitle={t('aiHintIdleTitle')}
            sendLabel={t('aiSend')}
            stopLabel={t('aiStop')}
            iconOnly
            sendIconEnabled={<img src={sendEnterOn} alt="" aria-hidden />}
            sendIconDisabled={<img src={sendEnterOff} alt="" aria-hidden />}
            stopIcon={<img src={sendStop} alt="" aria-hidden />}
            textareaRef={inputRef}
            onChange={setInput}
            onSend={run}
            onStop={cancel}
            onPasteFiles={(files) => void onPasteFiles(files)}
            lang={lang}
            viewOnly={isUniwork && readOnly ? true : undefined}
            uniwork={
              isUniwork
                ? {
                    provider: settings.provider,
                    lang,
                    note: composerNoteState,
                    onSignIn: () => void readUniworkCloudStatus()?.signIn?.(),
                    onChooseProvider: () => void window.desktop?.openAiModelSettings?.(),
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
            footerStart={
              <>
                <AiModelPicker
                  bridge={MODEL_BRIDGE}
                  lang={lang}
                  onAnnounce={(text) => setPickerNote({ text, over: panelLiveAnnouncement })}
                />
                {sessionUsage && <AiUsageChip usage={sessionUsage} session lang={lang} />}
                <button
                  className="ai-attach-btn"
                  onClick={pickAttachments}
                  data-tip={t('aiAttachTitle')}
                  aria-label={t('aiAttachTitle')}
                >
                  <img src={attachIcon} alt="" aria-hidden />
                </button>
                {!readOnly && (
                  // under tracked-changes protection the pill is on and locked: aria-disabled (not
                  // disabled) keeps it in the Tab order, and the reason is an in-panel tip that opens on
                  // hover and on keyboard focus (the global ScreenTip overflowed the panel)
                  <span
                    className={`ai-track-wrap${trackForced ? ' forced' : ''}`}
                    onMouseEnter={trackForced ? () => setTrackTipHover(true) : undefined}
                    onMouseLeave={trackForced ? () => setTrackTipHover(false) : undefined}
                  >
                    <button
                      className={`ai-track-btn${trackShown ? ' on' : ''}${trackForced ? ' locked' : ''}`}
                      onClick={toggleTrackChanges}
                      aria-disabled={trackForced ? true : undefined}
                      aria-describedby={trackForced ? 'ai-track-forced-reason' : undefined}
                      onFocus={trackForced ? () => setTrackTipFocus(true) : undefined}
                      onBlur={trackForced ? () => setTrackTipFocus(false) : undefined}
                      onKeyDown={
                        trackForced
                          ? (e) => {
                              if (e.key === 'Escape') {
                                setTrackTipFocus(false)
                                setTrackTipHover(false)
                              }
                            }
                          : undefined
                      }
                      data-tip={
                        trackForced
                          ? undefined
                          : trackShown
                            ? t('aiTrackOnTitle')
                            : t('aiTrackOffTitle')
                      }
                    >
                      {trackForced ? (
                        <svg
                          className="ai-track-lock"
                          width="10"
                          height="10"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v2Z" />
                        </svg>
                      ) : (
                        <span className="ai-track-dot" aria-hidden />
                      )}
                      <span className="ai-track-label">{t('aiTrackChanges')}</span>
                    </button>
                    {trackForced && (
                      <span
                        id="ai-track-forced-reason"
                        className="ai-track-tip"
                        role="tooltip"
                        data-open={trackTipHover || trackTipFocus ? 'true' : 'false'}
                      >
                        {t('aiTrackForced')}
                      </span>
                    )}
                  </span>
                )}
              </>
            }
          />
        </div>
      </div>
    </aside>
  )
}

/** Tool row list (unified with slides/sheets): dot + summary; expandable details when there's output; arrow shows on hover */
/** Step-row status icons (timeline glyphs: 14px in a 20px slot, 1.6 stroke) */
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

/** Quiet roll-back action in the message toolbar: restores the document to before the run's edits */
function RollbackButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const { t: tr } = useI18n()
  return (
    <button type="button" className="ai-rollback-btn" disabled={disabled} onClick={onClick}>
      {/* 24-canvas glyph at 18px (optical parity with the toolbar icons): stroke 1.5 paints 1.125px (1:16) */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5.91026 4L2.5 7.14791L5.91026 10.8205" />
        <path d="M3.96154 7.41028H15.1636C18.5169 7.41028 21.3646 10.1484 21.4953 13.5C21.6334 17.0416 18.707 20.0769 15.1636 20.0769H6.88384" />
      </svg>
      {tr('aiRollback')}
    </button>
  )
}

/** Tool activity group: a single quiet summary row
 *  that auto-opens while tools run, auto-collapses into "Worked · N steps" when they finish,
 *  and a manual toggle that always wins. Rows inside are step rows with 1px connectors. */
function ToolChipList({ tools }: { tools: ToolActivity[] }) {
  const { t: tr, lang } = useI18n()
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
  const label = anyRunning ? tr('aiGroupWorking') : workedStepsLabel(tr, lang, tools.length)

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
