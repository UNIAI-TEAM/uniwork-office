import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { getPractice, type PracticeId, type WorkbenchModuleId } from '@uniwork/practice-core'
import { AiTypingIndicator, IconSend, IconStop, UniAiMark } from '@genoffice/ui'
import { applyAgentIntent, undoAgentAddItem } from './agent-intent-apply'
import { emitAgentIntentNavigate } from './agent-intent-bus'
import { buildMyAiContextPack, type MyAiContextPack } from './context-manager'
import { useI18n } from './locale'
import { useUniworkCloudStatus } from './UniworkCloudPane'
import { AskUniPane, hasAskUniBridge } from './AskUniPane'
import { recordAiTurnUsage } from './ai-usage-ledger'
import { appendMyAiAudit } from './my-ai-audit'
import {
  collectAttachmentTextBlock,
  collectImageAttachments,
  formatAttachmentSize,
  isImageAttachment,
  mergeAttachmentResult,
  type AttachmentMeta,
} from './my-ai-attachments'
import {
  describeConsent,
  describeRouteDone,
  routeNeedsConsent,
  workbenchModuleLabel,
} from './my-ai-consent'
import { clearMyAiHistory, loadMyAiHistory, saveMyAiHistory } from './my-ai-history'
import { answerMyAiLocally, buildLocalAnswerSnapshot } from './my-ai-local-answer'
import { practiceMyAiChips } from './my-ai-playbooks'
import {
  buildFormFillBrief,
  findFormForTemplate,
  getFormById,
  listFormsWithFiles,
  readFormFileExcerpt,
} from './my-ai-forms'
import { buildTemplateBrief, resolveTemplateSlots, slotPromptPrefix } from './my-ai-templates'
import { readForms } from './workbench-pins'
import {
  isAmbiguousRecentMatch,
  isSubstantiveCreateBrief,
  officeAppLabel,
  rankRecents,
  rankRecentsScored,
  routeMyAiText,
  wantsLocalContext,
  type MyAiRoute,
  type MyAiStep,
  type OfficeApp,
} from './my-ai-router'
import { streamMyAiReply } from './my-ai-stream'
import {
  myAiTurnTarget,
  openAiSettingsLabel,
  looksLikeMissingAiActivation,
  softAiActivationMessage,
} from './my-ai-activation'
import type { RecentEntry } from '../../shared/home-api'
import { FileBadge } from './FileBadge'
import { FILE_EXCERPT_MAX_FILES, formatExcerptsForPrompt } from '../../shared/file-excerpt'

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatChoice {
  id: string
  label: string
  /** Path to open, prompt text, consent, soft-mutate undo, or Settings section */
  kind: 'open_path' | 'prompt' | 'confirm' | 'cancel' | 'undo' | 'open_settings'
  value: string
}

interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  choices?: ChatChoice[]
  /** Choices already used / superseded */
  choicesResolved?: boolean
  contextUsed?: boolean
  streaming?: boolean
  attachments?: AttachmentMeta[]
  /** a failed action: rendered with danger tokens instead of the neutral notice look */
  tone?: 'error'
}

const PASTE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

type SuggestionGroupId = 'write' | 'data' | 'present' | 'files' | 'plan'
/** `role` is the active practice's playbook chips; the rest are fixed office work. */
type GroupId = 'role' | SuggestionGroupId

interface Suggestion {
  id: string
  group: SuggestionGroupId
  promptVi: string
  promptEn: string
}

const SUGGESTION_GROUPS: readonly { id: SuggestionGroupId; labelVi: string; labelEn: string }[] = [
  { id: 'write', labelVi: 'Soạn thảo', labelEn: 'Write' },
  { id: 'data', labelVi: 'Bảng tính', labelEn: 'Sheets' },
  { id: 'present', labelVi: 'Trình bày', labelEn: 'Present' },
  { id: 'files', labelVi: 'Tài liệu', labelEn: 'Files' },
  { id: 'plan', labelVi: 'Công việc', labelEn: 'Tasks' },
]

// Everyday enterprise office work; each prompt must still hit a my-ai-router branch.
const SUGGESTIONS: readonly Suggestion[] = [
  {
    id: 'draft-doc',
    group: 'write',
    promptVi: 'Soạn văn bản Word: công văn gửi đối tác thông báo lịch giao hàng tháng tới',
    promptEn: 'Draft a Word doc: letter to a partner announcing next month’s delivery schedule',
  },
  {
    id: 'minutes',
    group: 'write',
    promptVi: 'Soạn văn bản Word: biên bản họp giao ban tuần, có mục kết luận và người phụ trách',
    promptEn: 'Draft a Word doc: weekly team meeting minutes with decisions and owners',
  },
  {
    id: 'multi',
    group: 'write',
    promptVi: 'Soạn báo giá Word và thêm công việc theo dõi khách',
    promptEn: 'Draft a Word quote and add a follow-up task',
  },
  {
    id: 'revenue-sheet',
    group: 'data',
    promptVi: 'Tạo bảng Excel báo cáo doanh thu theo tháng và theo kênh bán',
    promptEn: 'Create an Excel sheet reporting revenue by month and sales channel',
  },
  {
    id: 'expense-sheet',
    group: 'data',
    promptVi: 'Tạo bảng Excel theo dõi chi phí phòng ban theo tháng',
    promptEn: 'Create an Excel sheet tracking department expenses by month',
  },
  {
    id: 'project-plan',
    group: 'data',
    promptVi: 'Tạo bảng Excel kế hoạch dự án có mốc thời gian, người phụ trách và trạng thái',
    promptEn: 'Create an Excel project plan with milestones, owners and status',
  },
  {
    id: 'quarter-slides',
    group: 'present',
    promptVi: 'Tạo bài thuyết trình báo cáo kết quả kinh doanh quý cho ban giám đốc',
    promptEn: 'Create a slide deck on quarterly business results for the leadership team',
  },
  {
    id: 'company-slides',
    group: 'present',
    promptVi: 'Tạo bài thuyết trình giới thiệu năng lực công ty cho khách hàng mới',
    promptEn: 'Create a slide deck introducing our company to a new client',
  },
  {
    id: 'search',
    group: 'files',
    promptVi: 'Tìm file hợp đồng',
    promptEn: 'Find file: contract',
  },
  {
    id: 'sum',
    group: 'files',
    promptVi: 'Tóm tắt file gần đây',
    promptEn: 'Summarize recent files',
  },
  {
    id: 'sum-active',
    group: 'files',
    promptVi: 'Tóm tắt file đang mở',
    promptEn: 'Summarize the active file',
  },
  {
    id: 'continue',
    group: 'files',
    promptVi:
      'Tiếp tục trên file đang mở: rà soát câu chữ cho trang trọng, đúng văn phong doanh nghiệp',
    promptEn: 'Continue on the open file: tighten the wording into a formal business tone',
  },
  {
    id: 'task',
    group: 'plan',
    promptVi: 'Thêm công việc gửi báo cáo tuần cho trưởng phòng lúc 16 giờ',
    promptEn: 'Add a task to send the weekly report to my manager at 4pm',
  },
  {
    id: 'tasks-tab',
    group: 'plan',
    promptVi: 'Mở tab công việc của tôi',
    promptEn: 'Open my tasks tab',
  },
  {
    id: 'cal',
    group: 'plan',
    promptVi: 'Mở tab lịch của tôi',
    promptEn: 'Open my calendar tab',
  },
]

/** The sentence a suggestion row shows: the prompt minus its routing prefix. */
function suggestionText(prompt: string): string {
  const body = prompt.replace(/^(Soạn văn bản Word|Draft a Word doc):\s*/i, '')
  return body.charAt(0).toUpperCase() + body.slice(1)
}

/** "2 giờ trước" / "2 hours ago"; past a week, a short date. */
function relativeTime(ms: number, vi: boolean, now = Date.now()): string {
  const locale = vi ? 'vi' : 'en'
  const sec = Math.round((ms - now) / 1000)
  const abs = Math.abs(sec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 7 * 86400) return rtf.format(Math.round(sec / 86400), 'day')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(ms)
}

function greeting(vi: boolean, hour = new Date().getHours()): string {
  if (hour < 11) return vi ? 'Chào buổi sáng' : 'Good morning'
  if (hour < 13) return vi ? 'Chào buổi trưa' : 'Good afternoon'
  if (hour < 18) return vi ? 'Chào buổi chiều' : 'Good afternoon'
  return vi ? 'Chào buổi tối' : 'Good evening'
}

/** 16px / 1.2 stroke grid, same as the @genoffice/ui icon set. */
function Glyph({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const GROUP_GLYPHS: Record<GroupId, ReactElement> = {
  role: (
    <>
      <rect x="2.5" y="5" width="11" height="8" rx="1.5" />
      <path d="M6 5V3.8c0-.4.3-.8.8-.8h2.4c.5 0 .8.4.8.8V5M2.5 8.5h11" />
    </>
  ),
  write: (
    <>
      <path d="M4 2.5h5.5L12 5v8.5H4z" />
      <path d="M9.5 2.5V5H12M6 8h4M6 10.5h4" />
    </>
  ),
  data: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M2.5 10h11M6.5 3v10" />
    </>
  ),
  present: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1.2" />
      <path d="M8 11v2.5M5.5 13.5h5" />
    </>
  ),
  files: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3.5 3.5" />
    </>
  ),
  plan: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M6 10l1.5 1.5 3-3" />
    </>
  ),
}

function IconPaperclip(): ReactElement {
  return (
    <Glyph>
      <path d="M13.2 7.6 8 12.8a3.2 3.2 0 0 1-4.5-4.5l5.4-5.4a2.1 2.1 0 0 1 3 3L6.5 11.3a1.1 1.1 0 0 1-1.5-1.5l4.8-4.8" />
    </Glyph>
  )
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

async function loadRecents(limit = 80) {
  const page = await window.aiOffice.recents({ offset: 0, limit })
  return page.entries.filter((e) => !e.missing)
}

async function createOfficeFile(app: OfficeApp, brief?: string): Promise<string> {
  const preset = brief?.trim()
    ? { text: brief.trim(), autoRun: true as const, displayText: brief.trim().slice(0, 120) }
    : undefined

  if (app === 'docs') {
    if (preset) await window.aiOffice.newDoc({ aiPreset: preset })
    else await window.aiOffice.newDoc()
    return preset ? 'docs+ai' : 'docs'
  }
  if (app === 'slides') {
    if (preset) await window.aiOffice.newSlide({ aiPreset: preset })
    else await window.aiOffice.newSlide()
    return preset ? 'slides+ai' : 'slides'
  }
  if (app === 'sheets') {
    if (preset) await window.aiOffice.newSheet({ aiPreset: preset })
    else await window.aiOffice.newSheet()
    return preset ? 'sheets+ai' : 'sheets'
  }
  if (preset) await window.aiOffice.newPdf({ aiPreset: preset })
  else await window.aiOffice.newPdf()
  return preset ? 'pdf+ai' : 'pdf'
}

function enrichBrief(brief: string, pack: MyAiContextPack, userText: string): string {
  if (!wantsLocalContext(userText) && !wantsLocalContext(brief)) return brief
  const ctx = pack.plainText.slice(0, 1_800)
  return `${brief}\n\n---\nLocal context (on-device):\n${ctx}`
}

function contextFootnote(vi: boolean, excerpts = false): string {
  if (excerpts) {
    return vi
      ? '\n\n_(Đã đọc excerpt trên máy + ngữ cảnh Workbench. Không bịa nội dung ngoài excerpt.)_'
      : '\n\n_(Used on-device file excerpts + Workbench context. Did not invent text beyond excerpts.)_'
  }
  return vi
    ? '\n\n_(Đã dùng ngữ cảnh máy: việc / ghi chú / email / lịch / Recent.)_'
    : '\n\n_(Used on-device context: tasks / notes / email / calendar / Recents.)_'
}

interface Props {
  practiceId: PracticeId
  ensureWorkbench: () => void
}

export function NewChatPane({ practiceId, ensureWorkbench }: Props): ReactElement {
  const { lang, t } = useI18n()
  const vi = lang === 'vi'
  const cloud = useUniworkCloudStatus()
  const label = (a: string, b: string) => (vi ? a : b)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({})
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadMyAiHistory(practiceId).map((m) => ({
      ...m,
      choicesResolved: true as const,
      streaming: false,
    })),
  )
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingConsentRef = useRef<{ route: MyAiRoute; userText: string } | null>(null)
  const pendingResumeRef = useRef<{
    steps: MyAiStep[]
    userText: string
    consentGranted: boolean
    goalVi?: string
    goalEn?: string
  } | null>(null)
  const turnAttachmentsRef = useRef<AttachmentMeta[]>([])
  const streamCancelRef = useRef<(() => void) | null>(null)
  const skipPersistRef = useRef(false)
  const practiceChips = useMemo(() => practiceMyAiChips(practiceId), [practiceId])
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null)
  // Ask UNI is the workspace-question mode next to the chat; the toggle needs the shell bridge
  const [mode, setMode] = useState<'chat' | 'ask'>('chat')
  // once opened, the Ask UNI pane stays mounted (hidden) so its conversation survives the toggle
  const [askOpened, setAskOpened] = useState(false)
  const groupBtnRefs = useRef<Partial<Record<GroupId, HTMLButtonElement | null>>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [continueFiles, setContinueFiles] = useState<RecentEntry[]>([])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, busy])

  const hasThread = messages.length > 0

  // "Pick up where you left off" on the empty screen: the three newest reachable recents
  useEffect(() => {
    if (hasThread) return
    let alive = true
    const refresh = () => {
      loadRecents(12)
        .then((entries) => {
          if (alive) setContinueFiles(entries.slice(0, 3))
        })
        .catch(() => {
          if (alive) setContinueFiles([])
        })
    }
    // no recents-changed event exists; coming back from a document tab focuses/reveals Home
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hasThread])

  useEffect(() => {
    if (copiedId === null) return
    const t = window.setTimeout(() => setCopiedId(null), 1600)
    return () => window.clearTimeout(t)
  }, [copiedId])

  const copyMessage = async (m: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(m.text)
      setCopiedId(m.id)
    } catch {
      // clipboard denied: leave the button as is rather than claim success
    }
  }
  // the composer remounts when the thread starts and is disabled while busy: hand focus back each time
  useEffect(() => {
    if (!busy) inputRef.current?.focus()
  }, [busy, hasThread])

  useEffect(() => {
    skipPersistRef.current = true
    pendingConsentRef.current = null
    pendingResumeRef.current = null
    streamCancelRef.current?.()
    streamCancelRef.current = null
    turnAttachmentsRef.current = []
    setAttachments([])
    setAttachNotice(null)
    setMessages(
      loadMyAiHistory(practiceId).map((m) => ({
        ...m,
        choicesResolved: true,
        streaming: false,
      })),
    )
    setInput('')
    setBusy(false)
  }, [practiceId])

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    saveMyAiHistory(
      practiceId,
      messages
        .filter((m) => !m.streaming)
        .map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          contextUsed: m.contextUsed,
          attachments: m.attachments,
        })),
    )
  }, [practiceId, messages])

  useEffect(() => {
    let cancelled = false
    const allAtts = [...attachments, ...messages.flatMap((m) => m.attachments ?? [])]
    const wanted = new Set(allAtts.filter(isImageAttachment).map((a) => a.path))
    const loadPreviews = async () => {
      const next: Record<string, string> = { ...attachmentPreviews }
      let changed = false
      for (const path of wanted) {
        if (next[path]) continue
        const res = await window.aiOffice.readAttachmentImage?.(path)
        if (cancelled) return
        if (res?.ok && res.base64 && res.mime) {
          next[path] = `data:${res.mime};base64,${res.base64}`
          changed = true
        }
      }
      for (const path of Object.keys(next)) {
        if (!wanted.has(path)) {
          delete next[path]
          changed = true
        }
      }
      if (changed) setAttachmentPreviews(next)
    }
    void loadPreviews()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    attachments.map((a) => a.path).join('|'),
    messages.map((m) => (m.attachments ?? []).map((a) => a.path).join(',')).join('|'),
  ])

  const push = (msg: Omit<ChatMessage, 'id'> & { id?: string }) => {
    const id = msg.id ?? newId()
    setMessages((prev) => {
      const cleared = prev.map((m) =>
        m.choices && !m.choicesResolved ? { ...m, choicesResolved: true } : m,
      )
      return [...cleared, { ...msg, id }]
    })
    return id
  }

  const patchMessage = (id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  const stopStream = () => {
    streamCancelRef.current?.()
    streamCancelRef.current = null
  }

  const applyAttachResult = (result: Parameters<typeof mergeAttachmentResult>[1]) => {
    const { next, notice } = mergeAttachmentResult(attachments, result)
    setAttachments(next)
    if (notice) {
      setAttachNotice(notice)
      window.setTimeout(() => setAttachNotice(null), 4000)
    }
  }

  const pickFiles = async () => {
    const result = (await window.aiOffice.pickAttachments?.()) ?? null
    applyAttachResult(result)
  }

  const removeAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path))
  }

  const openAiSettingsChoice = (): ChatChoice => ({
    id: 'open-ai-settings',
    label: openAiSettingsLabel(vi),
    kind: 'open_settings',
    value: 'aiModel',
  })

  const activationFailure = (
    msgId: string | undefined,
    showBubble: boolean,
  ): { ok: false; error: string; messageId?: string } => {
    const error = softAiActivationMessage(vi, cloud?.state)
    if (showBubble && msgId) {
      patchMessage(msgId, {
        text: error,
        streaming: false,
        role: 'system',
        choices: [openAiSettingsChoice()],
        choicesResolved: false,
      })
    } else if (showBubble) {
      const id = push({
        role: 'system',
        text: error,
        choices: [openAiSettingsChoice()],
      })
      return { ok: false, error, messageId: id }
    }
    return { ok: false, error, messageId: msgId }
  }

  const runStreamedAi = async (opts: {
    system: string
    user: string
    messageId?: string
    images?: Awaited<ReturnType<typeof collectImageAttachments>>
    /** When false, stream without leaving a chat bubble (plan aggregation). */
    showBubble?: boolean
  }): Promise<{ ok: boolean; content?: string; error?: string; messageId?: string }> => {
    const api = window.aiOffice
    const showBubble = opts.showBubble !== false
    if (!api.getAiSettings) return { ok: false, error: 'AI unavailable' }
    const settings = await api.getAiSettings()

    const { provider, model, ready } = myAiTurnTarget(settings)

    if (!ready) {
      return activationFailure(opts.messageId, showBubble)
    }

    if (!api.aiStream) {
      if (!api.aiChat) return { ok: false, error: 'AI unavailable' }
      const res = await api.aiChat({ settings, system: opts.system, user: opts.user })
      recordAiTurnUsage({
        source: 'my-ai',
        summary: opts.user.slice(0, 120) || 'My AI',
        system: opts.system,
        user: opts.user,
        completion: res.content,
        provider,
        model,
        ok: Boolean(res.ok),
      })
      if (!res.ok && looksLikeMissingAiActivation(res.error || '')) {
        return activationFailure(opts.messageId, showBubble)
      }
      if (!showBubble) return res
      const msgId =
        opts.messageId ??
        push({
          role: res.ok ? 'assistant' : 'system',
          text: res.content?.trim() || res.error || '',
          streaming: false,
        })
      if (opts.messageId) {
        patchMessage(msgId, {
          text: res.content?.trim() || res.error || '',
          streaming: false,
          role: res.ok ? 'assistant' : 'system',
        })
      }
      return { ...res, messageId: msgId }
    }

    const msgId = showBubble
      ? (opts.messageId ?? push({ role: 'assistant', text: '', streaming: true }))
      : undefined
    if (opts.messageId && showBubble) patchMessage(msgId!, { text: '', streaming: true })
    try {
      const result = await streamMyAiReply({
        system: opts.system,
        user: opts.user,
        images: opts.images,
        settings,
        lang,
        onDelta: (text) => {
          if (msgId) patchMessage(msgId, { text, streaming: true })
        },
        onReady: (cancel) => {
          streamCancelRef.current = cancel
        },
      })
      streamCancelRef.current = null
      recordAiTurnUsage({
        source: 'my-ai',
        summary: opts.user.slice(0, 120) || 'My AI',
        system: opts.system,
        user: opts.user,
        completion: result.content,
        provider,
        model,
        ok: Boolean(result.ok),
        cancelled: result.cancelled,
      })
      if (!result.ok && looksLikeMissingAiActivation(result.error || '')) {
        return activationFailure(msgId, showBubble)
      }
      const text = result.content?.trim() || result.error || ''
      if (msgId) {
        patchMessage(msgId, {
          text,
          streaming: false,
          ...(result.ok ? {} : { role: 'system' as const, tone: 'error' as const }),
        })
      }
      return { ...result, messageId: msgId }
    } catch (err) {
      streamCancelRef.current = null
      const error = err instanceof Error ? err.message : String(err)
      recordAiTurnUsage({
        source: 'my-ai',
        summary: opts.user.slice(0, 120) || 'My AI',
        system: opts.system,
        user: opts.user,
        provider,
        model,
        ok: false,
      })
      if (looksLikeMissingAiActivation(error)) {
        return activationFailure(msgId, showBubble)
      }
      if (msgId) {
        patchMessage(msgId, { text: error, streaming: false, role: 'system', tone: 'error' })
      }
      return { ok: false, error, messageId: msgId }
    }
  }

  const resetChat = () => {
    stopStream()
    pendingConsentRef.current = null
    pendingResumeRef.current = null
    turnAttachmentsRef.current = []
    clearMyAiHistory(practiceId)
    skipPersistRef.current = true
    setMessages([])
    setAttachments([])
    setAttachNotice(null)
    setInput('')
    setBusy(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const describeCreate = (app: OfficeApp, mode: string, brief?: string, usedCtx?: boolean) => {
    const name = officeAppLabel(app, vi)
    let body: string
    if (mode.endsWith('+ai') && brief) {
      const shown = brief.split('\n---\n')[0]!.trim()
      body = label(
        `Đã mở ${name} mới và gửi yêu cầu cho AI trong tab: “${shown.slice(0, 160)}${shown.length > 160 ? '…' : ''}”.`,
        `Opened a new ${name} tab and queued AI with: “${shown.slice(0, 160)}${shown.length > 160 ? '…' : ''}”.`,
      )
    } else if (app === 'pdf' && !mode.endsWith('+ai')) {
      body = label('Đã tạo và mở PDF mới.', 'Created and opened a new PDF.')
    } else {
      body = label(
        `Đã mở ${name} mới — tiếp tục trong tab vừa tạo.`,
        `Opened a new ${name} — continue in the new tab.`,
      )
    }
    return usedCtx ? body + contextFootnote(vi) : body
  }

  const openPathChoice = async (path: string, name: string) => {
    setBusy(true)
    try {
      await window.aiOffice.openPath(path)
      const resume = pendingResumeRef.current
      pendingResumeRef.current = null
      if (resume && resume.steps.length > 0) {
        // P4: soft ack — no “▶ continuing the rest / plan” language
        push({
          role: 'assistant',
          text: label(`Đã mở “${name}”.`, `Opened “${name}”.`),
        })
        const goalVi = resume.goalVi?.trim() || 'Hoàn thành phần còn lại'
        const goalEn = resume.goalEn?.trim() || 'Finish the rest'
        const resumeRoute: MyAiRoute = {
          kind: 'plan',
          steps: resume.steps,
          goalVi,
          goalEn,
          summaryVi: goalVi,
          summaryEn: goalEn,
        }
        await runRoute(resumeRoute, resume.userText, {
          consentGranted: resume.consentGranted,
          skipUserPush: true,
          resumeMode: true,
        })
        return
      }
      push({
        role: 'assistant',
        text: label(`Đã mở “${name}”.`, `Opened “${name}”.`),
      })
    } catch (err) {
      pendingResumeRef.current = null
      push({
        role: 'system',
        tone: 'error',
        text: label(
          `Lỗi: ${err instanceof Error ? err.message : String(err)}`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ),
      })
    } finally {
      setBusy(false)
    }
  }

  const onChoice = (msgId: string, choice: ChatChoice) => {
    if (busy) return
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, choicesResolved: true } : m)))
    if (choice.kind === 'open_path') {
      void openPathChoice(choice.value, choice.label)
      return
    }
    if (choice.kind === 'open_settings') {
      window.dispatchEvent(
        new CustomEvent('uniwork:open-settings', {
          detail: { section: choice.value || 'account' },
        }),
      )
      return
    }
    if (choice.kind === 'cancel') {
      const pending = pendingConsentRef.current
      pendingConsentRef.current = null
      pendingResumeRef.current = null
      if (pending) {
        appendMyAiAudit({
          practiceId,
          userText: pending.userText,
          routeKind: pending.route.kind,
          summary: 'User dismissed consent',
          ok: false,
          consented: false,
        })
      }
      push({
        role: 'assistant',
        text: label('Đã hủy.', 'Canceled.'),
      })
      return
    }
    if (choice.kind === 'undo') {
      try {
        const parsed = JSON.parse(choice.value) as { moduleId: string; itemId: string }
        const r = undoAgentAddItem(practiceId, {
          moduleId: parsed.moduleId as WorkbenchModuleId,
          itemId: parsed.itemId,
        })
        push({
          role: 'assistant',
          text: label(r.messageVi, r.messageEn),
        })
      } catch {
        push({
          role: 'assistant',
          text: label('Không hoàn tác được.', 'Could not undo.'),
        })
      }
      return
    }
    if (choice.kind === 'confirm') {
      const pending = pendingConsentRef.current
      pendingConsentRef.current = null
      if (!pending) return
      void runRoute(pending.route, pending.userText, { consentGranted: true, skipUserPush: true })
      return
    }
    submit(choice.value)
  }

  type StepOutcome = {
    text: string
    choices?: ChatChoice[]
    contextUsed?: boolean
    /** Ambiguous open/search — pause remaining plan steps */
    pausePlan?: boolean
    /** Reply already streamed into this message id — skip duplicate push */
    streamedMessageId?: string
  }

  const executeStep = async (
    step: MyAiStep,
    userText: string,
    entries: RecentEntry[],
    pack: MyAiContextPack,
    opts?: { showAiBubble?: boolean },
  ): Promise<StepOutcome> => {
    if (step.kind === 'fill_form') {
      const hint = step.hint || userText
      if (!step.formId) {
        const pool = listFormsWithFiles(practiceId)
        const fallback = pool.length > 0 ? pool : readForms(practiceId)
        if (fallback.length === 0) {
          return {
            text: label(
              'Chưa có biểu mẫu trong thư viện. Mở Workbench → Biểu mẫu để tải file mẫu lên.',
              'No forms in the library yet. Open Workbench → Forms to upload a template file.',
            ),
            pausePlan: true,
          }
        }
        return {
          text: label('Bạn muốn điền biểu mẫu nào?', 'Which library form should I fill?'),
          choices: fallback.slice(0, 8).map((f) => ({
            id: `form-${f.id}`,
            label: f.fileName ? `${f.title} (${f.fileName})` : f.title,
            kind: 'prompt' as const,
            value: label(`Điền biểu mẫu ${f.title}`, `Fill form ${f.title}`),
          })),
          pausePlan: true,
        }
      }
      const form = getFormById(practiceId, step.formId)
      if (!form) {
        return {
          text: label('Không tìm thấy biểu mẫu trong thư viện.', 'Library form not found.'),
          pausePlan: true,
        }
      }
      const excerpt = form.filePath ? await readFormFileExcerpt(form.filePath) : ''
      const brief = buildFormFillBrief({ form, vi, userHint: hint, excerpt })
      const mode = await createOfficeFile('docs', brief)
      return {
        text: describeCreate('docs', mode, brief, true),
        contextUsed: true,
      }
    }

    if (step.kind === 'fill_template') {
      const resolved = resolveTemplateSlots(practiceId, step.templateId, step.hint || userText)
      if (!resolved) {
        return {
          text: label('Không tìm thấy mẫu tài liệu.', 'Document template not found.'),
          pausePlan: true,
        }
      }
      if (resolved.missing.length > 0) {
        const miss = resolved.missing
          .map((s) => (vi ? s.labelVi : s.labelEn))
          .join(vi ? ', ' : ', ')
        const choices: ChatChoice[] = []
        for (const slot of resolved.missing.slice(0, 2)) {
          choices.push({
            id: `tpl-slot-${slot.id}`,
            label: label(`Nhập ${slot.labelVi}…`, `Enter ${slot.labelEn}…`),
            kind: 'prompt',
            value: slotPromptPrefix(slot, resolved.template, vi),
          })
        }
        return {
          text: label(
            `Để soạn mẫu “${resolved.template.labelVi}” đúng khung, mình còn thiếu: ${miss}. Bổ sung giúp nhé.`,
            `To draft the “${resolved.template.labelEn}” template correctly, I still need: ${miss}.`,
          ),
          choices: choices.length > 0 ? choices : undefined,
          pausePlan: true,
        }
      }
      let brief = buildTemplateBrief(resolved, vi)
      const libForm = findFormForTemplate(practiceId, resolved.template)
      if (libForm?.filePath) {
        const excerpt = await readFormFileExcerpt(libForm.filePath)
        if (excerpt) {
          brief +=
            (vi
              ? `\n\nMẫu gốc từ thư viện Biểu mẫu (“${libForm.title}”${libForm.fileName ? ` — ${libForm.fileName}` : ''}). Bám sát khung sau:\n`
              : `\n\nLibrary form template (“${libForm.title}”${libForm.fileName ? ` — ${libForm.fileName}` : ''}). Follow this structure:\n`) +
            excerpt
        }
      }
      const mode = await createOfficeFile(resolved.template.app, brief)
      return {
        text: describeCreate(resolved.template.app, mode, brief, true),
        contextUsed: true,
      }
    }

    if (
      step.kind === 'ask_create' ||
      (step.kind === 'create_file' && !step.blank && !isSubstantiveCreateBrief(step.brief ?? ''))
    ) {
      const app = step.app
      const name = officeAppLabel(app, vi)
      const draftPrefix =
        app === 'docs'
          ? label('Soạn văn bản Word: ', 'Draft a Word doc: ')
          : app === 'sheets'
            ? label('Tạo bảng Excel: ', 'Create an Excel sheet: ')
            : app === 'slides'
              ? label('Tạo slide: ', 'Create a slide deck: ')
              : label('Tạo file PDF: ', 'Create a PDF: ')
      const blankPrompt =
        app === 'docs'
          ? label('Tạo Word trống', 'Create a blank Word doc')
          : app === 'sheets'
            ? label('Tạo Excel trống', 'Create a blank Excel sheet')
            : app === 'slides'
              ? label('Tạo slide trống', 'Create a blank slide deck')
              : label('Tạo PDF trống', 'Create a blank PDF')
      return {
        text: label(
          `Bạn muốn soạn ${name} về gì? Viết ngắn chủ đề hoặc dàn ý — mình mới mở file và soạn.`,
          `What should this ${name} be about? Share a short topic or outline — then I’ll open and draft it.`,
        ),
        choices: [
          {
            id: 'ask-create-topic',
            label: label('Nhập chủ đề…', 'Enter topic…'),
            kind: 'prompt',
            value: draftPrefix,
          },
          {
            id: 'ask-create-blank',
            label: label('Chỉ tạo trống', 'Blank only'),
            kind: 'prompt',
            value: blankPrompt,
          },
        ],
        pausePlan: true,
      }
    }

    if (step.kind === 'create_file') {
      const rawBrief = step.blank ? undefined : step.brief
      let brief = rawBrief ? enrichBrief(rawBrief, pack, userText) : undefined
      const attachBlock = await collectAttachmentTextBlock(turnAttachmentsRef.current)
      if (brief && attachBlock) {
        brief = `${brief}\n\n---\nAttached files (on-device):\n${attachBlock}`
      } else if (!brief && attachBlock && !step.blank) {
        // Attachment alone is not a user topic — ask instead of inventing a draft
        return {
          text: label(
            `Bạn muốn soạn ${officeAppLabel(step.app, true)} về gì? (Có tệp đính kèm — nêu chủ đề để mình dùng kèm.)`,
            `What should this ${officeAppLabel(step.app, false)} be about? (You attached files — add a topic so I can use them.)`,
          ),
          choices: [
            {
              id: 'ask-create-topic',
              label: label('Nhập chủ đề…', 'Enter topic…'),
              kind: 'prompt',
              value:
                step.app === 'docs'
                  ? label('Soạn văn bản Word: ', 'Draft a Word doc: ')
                  : label('Tạo file: ', 'Create file: '),
            },
          ],
          pausePlan: true,
        }
      }
      const usedCtx = Boolean((brief && brief !== rawBrief) || (attachBlock && brief))
      const mode = await createOfficeFile(step.app, brief)
      return {
        text: describeCreate(step.app, mode, brief, usedCtx),
        contextUsed: usedCtx,
      }
    }

    if (step.kind === 'open_file') {
      const scored = rankRecentsScored(entries, step.query, 5)
      if (scored.length === 0) {
        return {
          text: label(
            `Chưa thấy “${step.query}” trong file gần đây. Thử tên ngắn hơn?`,
            `No recent file like “${step.query}”. Try a shorter name?`,
          ),
          choices: [
            {
              id: 'search',
              label: label(`Tìm “${step.query}”`, `Find “${step.query}”`),
              kind: 'prompt',
              value: label(`Tìm file ${step.query}`, `Find file ${step.query}`),
            },
          ],
          pausePlan: true,
        }
      }
      if (isAmbiguousRecentMatch(scored)) {
        return {
          // P4: short ask — choices carry the list
          text: label(
            step.query.trim() ? `Vài file khớp “${step.query}” — mở cái nào?` : 'Mở file nào?',
            step.query.trim() ? `A few match “${step.query}” — which one?` : 'Which file?',
          ),
          choices: scored.map((s) => ({
            id: s.entry.path,
            label: s.entry.name,
            kind: 'open_path' as const,
            value: s.entry.path,
          })),
          pausePlan: true,
        }
      }
      const best = scored[0]!.entry
      await window.aiOffice.openPath(best.path)
      const rest = scored.slice(1)
      return {
        text: label(`Đã mở “${best.name}”.`, `Opened “${best.name}”.`),
        choices:
          rest.length > 0
            ? rest.map((s) => ({
                id: s.entry.path,
                label: label(`Mở ${s.entry.name}`, `Open ${s.entry.name}`),
                kind: 'open_path' as const,
                value: s.entry.path,
              }))
            : undefined,
      }
    }

    if (step.kind === 'search_files') {
      const scored = rankRecentsScored(entries, step.query, 8)
      if (scored.length === 0) {
        return {
          text: label(
            `Chưa thấy “${step.query}” trong file gần đây.`,
            `No recent files matched “${step.query}”.`,
          ),
          pausePlan: true,
        }
      }
      return {
        // P4: short ask — file buttons are the list (no Recent dump)
        text: label(
          step.query.trim() ? `Mở file nào cho “${step.query}”?` : 'Mở file nào?',
          step.query.trim() ? `Which file for “${step.query}”?` : 'Which file?',
        ),
        choices: scored.map((s) => ({
          id: s.entry.path,
          label: s.entry.name,
          kind: 'open_path' as const,
          value: s.entry.path,
        })),
        pausePlan: true,
      }
    }

    if (step.kind === 'summarize_recents') {
      const pool = step.query
        ? rankRecents(entries, step.query, step.limit)
        : entries.slice(0, step.limit)
      if (pool.length === 0) {
        return {
          text: label('Chưa có file gần đây để tóm tắt.', 'No recent files to summarize.'),
        }
      }
      const toRead = pool.slice(0, FILE_EXCERPT_MAX_FILES)
      const excerpts = (await window.aiOffice.fileExcerpts?.(toRead.map((e) => e.path))) ?? []
      const excerptBlock = formatExcerptsForPrompt(excerpts)
      const okCount = excerpts.filter((e) => e.status === 'ok').length
      const listing = pool
        .map((e, i) => `${i + 1}. ${e.name} (.${e.ext}) — ${new Date(e.mtimeMs).toLocaleString()}`)
        .join('\n')

      let summary =
        okCount > 0
          ? excerpts
              .filter((e) => e.status === 'ok' && e.excerpt)
              .map(
                (e) =>
                  `• ${e.name}: ${e.excerpt!.slice(0, 280)}${e.excerpt!.length > 280 ? '…' : ''}`,
              )
              .join('\n')
          : listing

      let usedAi = false
      let streamedMessageId: string | undefined
      const attachBlock = await collectAttachmentTextBlock(turnAttachmentsRef.current)
      const images = await collectImageAttachments(turnAttachmentsRef.current)
      const choices: ChatChoice[] = pool.slice(0, 5).map((e) => ({
        id: e.path,
        label: label(`Mở ${e.name}`, `Open ${e.name}`),
        kind: 'open_path' as const,
        value: e.path,
      }))
      try {
        if (okCount > 0 || listing || attachBlock) {
          const system = vi
            ? `Bạn là trợ lý desktop UniWork. Tóm tắt nội dung thật từ excerpt file (tiếng Việt, gạch đầu dòng theo từng file: chủ đề, điểm chính, việc có thể làm tiếp). Chỉ dùng excerpt / tệp đính kèm — không bịa. Nếu excerpt trống, nói rõ không đọc được.\n\nNgữ cảnh máy:\n${pack.plainText.slice(0, 1_800)}`
            : `You are a UniWork desktop assistant. Summarize real content from the file excerpts (bullets per file: topic, key points, suggested next actions). Use only excerpts / attachments — do not invent. If an excerpt is missing, say so.\n\nOn-device context:\n${pack.plainText.slice(0, 1_800)}`
          const user = [
            excerptBlock
              ? `Files:\n${listing}\n\nExcerpts:\n${excerptBlock}`
              : `Files (no excerpts):\n${listing}`,
            attachBlock ? `\n\nUser attachments:\n${attachBlock}` : '',
          ].join('')
          const res = await runStreamedAi({
            system,
            user,
            images,
            showBubble: opts?.showAiBubble !== false,
          })
          if (res.ok && res.content?.trim()) {
            summary = res.content.trim()
            usedAi = true
            streamedMessageId = res.messageId
          }
        }
      } catch {
        /* keep local excerpt digest */
      }

      const unread = excerpts.filter((e) => e.status !== 'ok')
      const unreadNote =
        unread.length > 0
          ? label(
              `\nKhông đọc được: ${unread.map((e) => `${e.name} (${e.status})`).join(', ')}.`,
              `\nCould not read: ${unread.map((e) => `${e.name} (${e.status})`).join(', ')}.`,
            )
          : ''

      const text =
        label(
          `Tóm tắt file gần đây (${pool.length}, đọc ${okCount} excerpt):\n${summary}${unreadNote}`,
          `Recent files summary (${pool.length}, ${okCount} excerpts read):\n${summary}${unreadNote}`,
        ) + contextFootnote(vi, okCount > 0 || usedAi)

      if (streamedMessageId) {
        patchMessage(streamedMessageId, {
          text,
          contextUsed: true,
          choices,
          streaming: false,
        })
      }

      return {
        text,
        contextUsed: true,
        streamedMessageId,
        choices,
      }
    }

    if (step.kind === 'continue_active') {
      const tab = await window.aiOffice.activeOfficeTab?.()
      if (!tab) {
        return {
          text: label(
            'Chưa có tab Office đang mở để tiếp tục. Hãy mở Word/Excel/Slides/PDF trước.',
            'No open Office tab to continue. Open Word/Excel/Slides/PDF first.',
          ),
          pausePlan: true,
        }
      }
      const brief =
        step.brief?.trim() ||
        (vi
          ? 'Tiếp tục chỉnh sửa tài liệu này theo ngữ cảnh hiện tại.'
          : 'Continue editing this document with the current context.')
      const pushed = await window.aiOffice.pushAiPreset?.({
        text: brief,
        autoRun: true,
        displayText: brief.slice(0, 120),
        tabId: tab.id,
      })
      if (!pushed?.ok) {
        return {
          text: label(
            `Không gửi được yêu cầu tới tab “${tab.title}”.`,
            `Could not send the request to tab “${tab.title}”.`,
          ),
          pausePlan: true,
        }
      }
      return {
        text: label(
          `Đã chuyển tới “${tab.title}” (${tab.kind}) và gửi yêu cầu cho AI trong tab.`,
          `Switched to “${tab.title}” (${tab.kind}) and queued AI in that tab.`,
        ),
        contextUsed: true,
      }
    }

    if (step.kind === 'summarize_active') {
      const tab = await window.aiOffice.activeOfficeTab?.()
      if (!tab) {
        return {
          text: label('Chưa có tab Office đang mở để tóm tắt.', 'No open Office tab to summarize.'),
          pausePlan: true,
        }
      }
      if (tab.path) {
        const excerpts = (await window.aiOffice.fileExcerpts?.([tab.path])) ?? []
        const excerptBlock = formatExcerptsForPrompt(excerpts)
        const ok = excerpts.some((e) => e.status === 'ok')
        let summary = ok
          ? excerpts
              .filter((e) => e.status === 'ok' && e.excerpt)
              .map((e) => e.excerpt!.slice(0, 600))
              .join('\n')
          : label(
              '(Không đọc được excerpt — sẽ hỏi AI trong tab.)',
              '(No excerpt — will ask AI in-tab.)',
            )
        let streamedMessageId: string | undefined
        const attachBlock = await collectAttachmentTextBlock(turnAttachmentsRef.current)
        const images = await collectImageAttachments(turnAttachmentsRef.current)
        if (ok || attachBlock || images.length > 0) {
          try {
            const res = await runStreamedAi({
              system: vi
                ? `Tóm tắt ngắn nội dung file đang mở (tiếng Việt, gạch đầu dòng). Chỉ dùng excerpt / tệp đính kèm — không bịa.\n\n${pack.plainText.slice(0, 1_200)}`
                : `Briefly summarize the open file (bullets). Use only the excerpt / attachments — do not invent.\n\n${pack.plainText.slice(0, 1_200)}`,
              user: [
                `File: ${tab.title}\n\n${excerptBlock}`,
                attachBlock ? `\n\nAttachments:\n${attachBlock}` : '',
              ].join(''),
              images,
              showBubble: opts?.showAiBubble !== false,
            })
            if (res.ok && res.content?.trim()) {
              summary = res.content.trim()
              streamedMessageId = res.messageId
            }
          } catch {
            /* keep excerpt */
          }
        } else {
          await window.aiOffice.pushAiPreset?.({
            text: vi ? 'Tóm tắt nội dung tài liệu này.' : 'Summarize this document.',
            autoRun: true,
            tabId: tab.id,
          })
        }
        const choices: ChatChoice[] = [
          {
            id: 'open-active',
            label: label(`Mở lại ${tab.title}`, `Re-open ${tab.title}`),
            kind: 'prompt',
            value: label('Tiếp tục trên file đang mở', 'Continue on the open file'),
          },
        ]
        const text =
          label(`Tóm tắt “${tab.title}”:\n${summary}`, `Summary of “${tab.title}”:\n${summary}`) +
          contextFootnote(vi, ok)
        if (streamedMessageId) {
          patchMessage(streamedMessageId, { text, contextUsed: true, choices, streaming: false })
        }
        return {
          text,
          contextUsed: true,
          streamedMessageId,
          choices,
        }
      }
      await window.aiOffice.pushAiPreset?.({
        text: vi ? 'Tóm tắt nội dung tài liệu này.' : 'Summarize this document.',
        autoRun: true,
        tabId: tab.id,
      })
      return {
        text: label(
          `Đã mở “${tab.title}” và nhờ AI trong tab tóm tắt (file chưa có đường dẫn trên đĩa).`,
          `Opened “${tab.title}” and asked in-tab AI to summarize (untitled / no path yet).`,
        ),
        contextUsed: true,
      }
    }

    // workbench — stay in My AI for soft adds; only jump when user asked to open a tab
    const result = await applyAgentIntent(step.intent, practiceId)
    const jumpToWorkbench =
      step.intent.action === 'open' ||
      step.intent.action === 'navigate' ||
      step.intent.action === 'run_skill'
    if (jumpToWorkbench) {
      ensureWorkbench()
      emitAgentIntentNavigate(result.tabId, step.intent)
    }
    const tabName = workbenchModuleLabel(result.tabId, vi)
    const openChoice: ChatChoice = {
      id: `open-wb-${result.tabId}`,
      label: label(`Mở ${tabName}`, `Open ${tabName}`),
      kind: 'prompt',
      value: label(`Mở tab ${tabName}`, `Open ${tabName} tab`),
    }
    const choices: ChatChoice[] = result.undo
      ? [
          {
            id: `undo-${result.undo.itemId}`,
            label: label('Hoàn tác', 'Undo'),
            kind: 'undo',
            value: JSON.stringify(result.undo),
          },
          openChoice,
        ]
      : step.intent.action === 'add_item' || jumpToWorkbench
        ? [openChoice]
        : []
    return {
      text: label(result.messageVi, result.messageEn),
      contextUsed: true,
      ...(choices.length > 0 ? { choices } : {}),
    }
  }

  /** Merge CTAs from plan steps: undos first, then unique open-tab / file picks. */
  const mergePlanChoices = (outs: StepOutcome[]): ChatChoice[] | undefined => {
    const undos: ChatChoice[] = []
    const opens: ChatChoice[] = []
    const rest: ChatChoice[] = []
    const seen = new Set<string>()
    for (const out of outs) {
      for (const c of out.choices ?? []) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        if (c.kind === 'undo') undos.push(c)
        else if (c.id.startsWith('open-wb-') || c.kind === 'open_path') opens.push(c)
        else rest.push(c)
      }
    }
    const merged = [...undos, ...opens, ...rest]
    return merged.length > 0 ? merged : undefined
  }

  const runRoute = async (
    route: MyAiRoute,
    userText: string,
    opts?: {
      consentGranted?: boolean
      skipUserPush?: boolean
      resumeMode?: boolean
      attachments?: AttachmentMeta[]
    },
  ) => {
    if (!opts?.skipUserPush) {
      push({
        role: 'user',
        text: userText,
        ...(opts?.attachments && opts.attachments.length > 0
          ? { attachments: opts.attachments }
          : {}),
      })
    }
    setBusy(true)
    try {
      const needs = routeNeedsConsent(route)
      if (needs.length > 0 && !opts?.consentGranted) {
        pendingConsentRef.current = { route, userText }
        push({
          role: 'assistant',
          text: describeConsent(route, vi) + label('\n\nLàm luôn?', '\n\nDo it now?'),
          choices: [
            {
              id: 'consent-ok',
              label: label('Làm luôn', 'Do it'),
              kind: 'confirm',
              value: 'ok',
            },
            {
              id: 'consent-no',
              label: label('Hủy', 'Cancel'),
              kind: 'cancel',
              value: 'no',
            },
          ],
        })
        appendMyAiAudit({
          practiceId,
          userText,
          routeKind: route.kind,
          summary: 'Awaiting consent',
          ok: true,
          consented: false,
        })
        return
      }

      const entries = await loadRecents()
      const pack = buildMyAiContextPack(practiceId, {
        vi,
        recents: entries.slice(0, 8).map((e) => ({
          name: e.name,
          ext: e.ext,
          mtimeMs: e.mtimeMs,
        })),
      })

      if (route.kind === 'plan') {
        const stepOuts: StepOutcome[] = []
        let contextUsed = false
        let paused = false
        for (let i = 0; i < route.steps.length; i++) {
          const step = route.steps[i]!
          const out = await executeStep(step, userText, entries, pack, { showAiBubble: false })
          stepOuts.push(out)
          appendMyAiAudit({
            practiceId,
            userText,
            routeKind: 'plan',
            stepKind: step.kind,
            summary: out.text.slice(0, 200),
            ok: !out.pausePlan,
            consented: opts?.consentGranted === true || needs.length === 0,
          })
          if (out.contextUsed) contextUsed = true
          if (out.pausePlan) {
            paused = true
            const remaining = route.steps.slice(i + 1)
            if (remaining.length > 0 && out.choices?.some((c) => c.kind === 'open_path')) {
              pendingResumeRef.current = {
                steps: remaining,
                userText,
                consentGranted: opts?.consentGranted === true || needs.length === 0,
                goalVi: route.goalVi,
                goalEn: route.goalEn,
              }
            } else {
              pendingResumeRef.current = null
            }
            break
          }
        }
        if (!paused) pendingResumeRef.current = null

        // P2/P4 result card: one headline + CTAs (no plan-pause jargon)
        const lastOut = stepOuts[stepOuts.length - 1]
        const pickingFile = paused && Boolean(lastOut?.choices?.some((c) => c.kind === 'open_path'))
        let headline: string
        let showDetail: boolean
        if (pickingFile) {
          // Soft ask — choice chips are the file list; skip “Chi tiết” dump
          headline = lastOut?.text?.trim() || describeRouteDone(route, vi, { paused: true })
          showDetail = false
        } else if (paused) {
          // Blocked / not found — step copy is the message
          headline = lastOut?.text?.trim() || label('Chưa làm tiếp được.', 'Couldn’t continue yet.')
          showDetail = false
        } else {
          headline = describeRouteDone(route, vi, {
            completedSteps: route.steps.length,
          })
          const detailLines = stepOuts
            .map((o) => o.text.trim())
            .filter(Boolean)
            .filter((t, idx, arr) => arr.indexOf(t) === idx)
          showDetail = detailLines.some(
            (t) =>
              /không|no recent|không thấy|không tìm|chưa thấy|error|lỗi/i.test(t) || t.length > 120,
          )
          const text =
            headline +
            (showDetail && detailLines.length > 0
              ? `\n\n${label('Chi tiết:', 'Details:')}\n${detailLines.map((t) => `• ${t}`).join('\n')}`
              : '')
          push({
            role: 'assistant',
            text,
            contextUsed,
            choices: mergePlanChoices(stepOuts),
          })
          return
        }

        push({
          role: 'assistant',
          text: headline,
          contextUsed,
          choices: mergePlanChoices(stepOuts),
        })
        return
      }

      if (route.kind !== 'unknown') {
        const out = await executeStep(route, userText, entries, pack, { showAiBubble: true })
        appendMyAiAudit({
          practiceId,
          userText,
          routeKind: route.kind,
          stepKind: route.kind,
          summary: out.text.slice(0, 200),
          ok: !out.pausePlan,
          consented: opts?.consentGranted === true || needs.length === 0,
        })
        if (out.streamedMessageId) {
          // already in thread
        } else {
          push({
            role: 'assistant',
            text: out.text,
            contextUsed: out.contextUsed,
            choices: out.choices,
          })
        }
        return
      }

      // unknown — Local Q&A first; Hub AI only after Token consent (Settings model)
      const localSnap = buildLocalAnswerSnapshot(
        practiceId,
        entries.slice(0, 8).map((e) => ({ name: e.name, ext: e.ext, mtimeMs: e.mtimeMs })),
      )
      const local = answerMyAiLocally(userText, localSnap, vi)
      let clarify = local.text
      let usedAi = false
      let streamedMessageId: string | undefined
      const attachBlock = await collectAttachmentTextBlock(turnAttachmentsRef.current)
      const images = await collectImageAttachments(turnAttachmentsRef.current)
      if (opts?.consentGranted) {
        try {
          if (userText.length >= 8 || attachBlock || images.length > 0) {
            const res = await runStreamedAi({
              system: vi
                ? `Bạn là Trợ lý UniWork trên desktop. Trả lời ngắn (≤4 câu) tiếng Việt dựa ngữ cảnh máy / tệp đính kèm — không bịa file. Nếu chưa rõ, hỏi 1 câu và đề xuất 2–3 hành động (soạn Word / mở file / thêm việc / mở lịch).\n\n${pack.plainText.slice(0, 2_500)}`
                : `You are UniWork desktop My AI. Reply briefly (≤4 sentences) using only on-device context / attachments — do not invent files. If unclear, ask one question and suggest 2–3 actions (draft Word / open file / add task / open calendar).\n\n${pack.plainText.slice(0, 2_500)}`,
              user: [userText, attachBlock ? `\n\nAttachments:\n${attachBlock}` : ''].join(''),
              images,
              showBubble: true,
            })
            if (res.ok && res.content?.trim()) {
              clarify = res.content.trim()
              usedAi = true
              streamedMessageId = res.messageId
            }
          }
        } catch {
          /* keep local answer */
        }
      }

      const topicChoices: ChatChoice[] = []
      if (local.topic === 'calendar' || local.topic === 'pulse') {
        topicChoices.push({
          id: 'cal',
          label: label('Mở lịch', 'Open calendar'),
          kind: 'prompt',
          value: label('Mở tab lịch của tôi', 'Open my calendar tab'),
        })
      }
      if (local.topic === 'tasks' || local.topic === 'pulse') {
        topicChoices.push({
          id: 'task-open',
          label: label('Mở việc', 'Open tasks'),
          kind: 'prompt',
          value: label('Mở tab công việc', 'Open tasks tab'),
        })
      }
      if (local.topic === 'recents') {
        topicChoices.push({
          id: 'open',
          label: label('Mở file…', 'Open file…'),
          kind: 'prompt',
          value: label('Mở file ', 'Open file '),
        })
      }
      if (local.topic === 'notes') {
        topicChoices.push({
          id: 'notes',
          label: label('Mở ghi chú', 'Open notes'),
          kind: 'prompt',
          value: label('Mở tab ghi chú', 'Open notes tab'),
        })
      }

      const clarifyChoices: ChatChoice[] = [
        ...topicChoices,
        {
          id: 'draft',
          label: label('Soạn Word…', 'Draft Word…'),
          kind: 'prompt',
          value: label('Soạn văn bản Word: ', 'Draft a Word doc: '),
        },
        ...(topicChoices.some((c) => c.id === 'open')
          ? []
          : [
              {
                id: 'open-generic',
                label: label('Mở file…', 'Open file…'),
                kind: 'prompt' as const,
                value: label('Mở file ', 'Open file '),
              },
            ]),
        ...(topicChoices.some((c) => c.id === 'task-open')
          ? []
          : [
              {
                id: 'task',
                label: label('Thêm việc…', 'Add a task…'),
                kind: 'prompt' as const,
                value: label('Thêm công việc ', 'Add a task '),
              },
            ]),
      ]
      // Dedupe by id
      const seenChoice = new Set<string>()
      const uniqueChoices = clarifyChoices.filter((c) => {
        if (seenChoice.has(c.id)) return false
        seenChoice.add(c.id)
        return true
      })

      const offerAi =
        !usedAi && local.offerAi && (userText.length >= 8 || turnAttachmentsRef.current.length > 0)
      if (offerAi) {
        pendingConsentRef.current = { route, userText }
        uniqueChoices.unshift({
          id: 'ai-clarify',
          label: label('Làm rõ bằng AI (Token)', 'Clarify with AI (Tokens)'),
          kind: 'confirm',
          value: 'ai',
        })
      }

      const text =
        clarify +
        (usedAi
          ? contextFootnote(vi)
          : local.topic === 'fallback' || local.topic === 'off_topic'
            ? offerAi
              ? label(
                  '\n\nMuốn mình suy nghĩ sâu hơn thì bấm “Làm rõ bằng AI” nhé.',
                  '\n\nWant a deeper take? Tap “Clarify with AI”.',
                )
              : ''
            : label(
                '\n\n_(Trả lời nhanh từ dữ liệu trên máy.)_',
                '\n\n_(Quick answer from on-device data.)_',
              ))

      if (streamedMessageId) {
        patchMessage(streamedMessageId, {
          text,
          contextUsed: usedAi || local.contextUsed,
          choices: uniqueChoices,
          streaming: false,
        })
      } else {
        push({
          role: 'assistant',
          text,
          contextUsed: usedAi || local.contextUsed,
          choices: uniqueChoices,
        })
      }
    } catch (err) {
      push({
        role: 'system',
        tone: 'error',
        text: label(
          `Lỗi: ${err instanceof Error ? err.message : String(err)}`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ),
      })
    } finally {
      setBusy(false)
    }
  }

  const submit = (raw?: string) => {
    if (busy) return
    const sentAtts = [...attachments]
    let text = (raw ?? input).trim()
    if (!text && sentAtts.length === 0) return
    // Prompt chips that end with trailing space / colon: put into composer for user to finish
    if (
      raw !== undefined &&
      (text.endsWith(':') ||
        text.endsWith(' ') ||
        /^(Soạn văn bản Word:|Draft a Word doc:|Mở file|Open file|Thêm công việc|Add a task)\s*$/i.test(
          text,
        ))
    ) {
      setInput(text)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        const el = inputRef.current
        if (el) {
          const n = el.value.length
          el.setSelectionRange(n, n)
        }
      })
      return
    }
    if (!text && sentAtts.length > 0) {
      text = label(
        'Hãy xem các tệp đính kèm và đề xuất việc nên làm tiếp.',
        'Please review the attached files and suggest next steps.',
      )
    }
    pendingConsentRef.current = null
    pendingResumeRef.current = null
    turnAttachmentsRef.current = sentAtts
    setAttachments([])
    setInput('')
    const route = routeMyAiText(text, { practiceId })
    void runRoute(route, text, { attachments: sentAtts })
  }

  useEffect(() => {
    const onExternal = (ev: Event) => {
      const text = (ev as CustomEvent<{ text?: string }>).detail?.text?.trim()
      if (!text || busy) return
      submit(text)
    }
    window.addEventListener('uniwork:my-ai-submit', onExternal)
    return () => window.removeEventListener('uniwork:my-ai-submit', onExternal)
  }, [busy, practiceId, attachments, input])

  const empty = messages.length === 0
  const canSend = !busy && (Boolean(input.trim()) || attachments.length > 0)
  const practice = getPractice(practiceId)
  const groups: { id: GroupId; label: string }[] = [
    ...(practiceChips.length > 0 && practice
      ? [{ id: 'role' as const, label: vi ? practice.labelVi : practice.labelEn }]
      : []),
    ...SUGGESTION_GROUPS.map((g) => ({ id: g.id, label: vi ? g.labelVi : g.labelEn })),
  ]
  const groupPrompts: { id: string; prompt: string }[] =
    openGroup === null
      ? []
      : openGroup === 'role'
        ? practiceChips.map((c) => ({ id: `p-${c.id}`, prompt: vi ? c.promptVi : c.promptEn }))
        : SUGGESTIONS.filter((s) => s.group === openGroup).map((s) => ({
            id: s.id,
            prompt: vi ? s.promptVi : s.promptEn,
          }))

  // Esc closes the open list from the buttons or the list and returns focus to its button
  const onGroupKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || openGroup === null) return
    e.stopPropagation()
    groupBtnRefs.current[openGroup]?.focus()
    setOpenGroup(null)
  }

  // One composer instance: under the greeting while empty, docked at the bottom once a thread exists.
  const composer = (
    <footer className="new-chat-composer">
      <div className="new-chat-composer-box">
        {attachments.length > 0 ? (
          <div className="new-chat-composer-atts" role="list">
            {attachments.map((a) => (
              <div key={a.path} className="new-chat-composer-att" role="listitem">
                {isImageAttachment(a) && attachmentPreviews[a.path] ? (
                  <img
                    src={attachmentPreviews[a.path]}
                    alt=""
                    className="new-chat-composer-att-img"
                  />
                ) : (
                  <span className="new-chat-composer-att-ext">{a.ext.toUpperCase()}</span>
                )}
                <span className="new-chat-composer-att-name" title={a.name}>
                  {a.name}
                </span>
                <button
                  type="button"
                  className="new-chat-composer-att-x"
                  aria-label={label('Gỡ', 'Remove')}
                  disabled={busy}
                  onClick={() => removeAttachment(a.path)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {attachNotice ? <p className="new-chat-attach-notice">{attachNotice}</p> : null}
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          disabled={busy}
          aria-label={label('Yêu cầu cho UniAI', 'Message UniAI')}
          placeholder={
            hasThread
              ? label('Trả lời UniAI…', 'Reply to UniAI…')
              : label(
                  'Giao việc cho UniAI: soạn văn bản, lập bảng, tóm tắt tài liệu…',
                  'Ask UniAI to draft a document, build a sheet, summarize a file…',
                )
          }
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const items = e.clipboardData?.items
            if (!items) return
            for (const item of Array.from(items)) {
              if (!item.type.startsWith('image/')) continue
              const ext = PASTE_MIME_EXT[item.type]
              if (!ext) continue
              e.preventDefault()
              const blob = item.getAsFile()
              if (!blob) continue
              void blob.arrayBuffer().then(async (buf) => {
                const result = (await window.aiOffice.addPastedImage?.(buf, ext)) ?? null
                applyAttachResult(result)
              })
              break
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length === 0) return
            const paths = files
              .map((f) => {
                try {
                  return window.aiOffice.getPathForFile?.(f) ?? ''
                } catch {
                  return ''
                }
              })
              .filter(Boolean)
            if (paths.length === 0) return
            void window.aiOffice.addAttachmentPaths?.(paths).then((result) => {
              applyAttachResult(result ?? null)
            })
          }}
        />
        <div className="new-chat-composer-actions">
          <button
            type="button"
            className="new-chat-icon-btn"
            disabled={busy}
            onClick={() => void pickFiles()}
            title={label('Đính kèm file hoặc ảnh', 'Attach files or images')}
            aria-label={label('Đính kèm file hoặc ảnh', 'Attach files or images')}
          >
            <IconPaperclip />
          </button>
          {busy ? (
            <button
              type="button"
              className="new-chat-send is-stop"
              onClick={stopStream}
              title={label('Dừng', 'Stop')}
              aria-label={label('Dừng', 'Stop')}
            >
              <IconStop size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="new-chat-send"
              disabled={!canSend}
              onClick={() => submit()}
              title={label(
                'Gửi (Enter) · Shift+Enter xuống dòng',
                'Send (Enter) · Shift+Enter for newline',
              )}
              aria-label={label('Gửi', 'Send')}
            >
              <IconSend size={16} />
            </button>
          )}
        </div>
      </div>
    </footer>
  )

  const footnote = (
    <p className="new-chat-footnote">
      {label(
        'UniAI hỏi trước khi dùng token AI · Thao tác thêm trên máy đều hoàn tác được · Lịch sử lưu theo vai trò',
        'UniAI asks before spending AI tokens · On-device changes can be undone · History is kept per role',
      )}
    </p>
  )

  const askAvailable = hasAskUniBridge()
  const askMode = askAvailable && mode === 'ask'

  const modeToggle = askAvailable ? (
    <div className="askuni-modes" role="group" aria-label={t('askUniModeGroup')}>
      <button
        type="button"
        className={`askuni-mode${askMode ? '' : ' is-on'}`}
        aria-pressed={!askMode}
        onClick={() => setMode('chat')}
      >
        {t('askUniModeChat')}
      </button>
      <button
        type="button"
        className={`askuni-mode${askMode ? ' is-on' : ''}`}
        aria-pressed={askMode}
        onClick={() => {
          setMode('ask')
          setAskOpened(true)
        }}
      >
        {t('askUniModeAsk')}
      </button>
    </div>
  ) : null

  const bar = (
    <header className="new-chat-bar">
      <h1 className="new-chat-title">{label('Trợ lý của bạn', 'My AI')}</h1>
      {modeToggle}
      {empty || askMode ? null : (
        <button type="button" className="new-chat-ghost-btn" onClick={resetChat} disabled={busy}>
          <Glyph>
            <path d="M8 3.5v9M3.5 8h9" />
          </Glyph>
          {label('Chat mới', 'New chat')}
        </button>
      )}
    </header>
  )

  // the chat body is skipped in Ask UNI mode; the Ask UNI pane stays mounted (hidden) once opened,
  // and the header (with the focused toggle) is one element in both modes
  const chatContent = (
    <>
      <div className="new-chat-body">
        {empty ? (
          <div className="new-chat-hero">
            <h2 className="new-chat-greeting">
              <UniAiMark size={28} />
              {greeting(vi)}
            </h2>
            {composer}
            <div
              className="new-chat-groups"
              role="group"
              aria-label={label('Gợi ý theo nhóm việc', 'Suggestions by kind of work')}
              onKeyDown={onGroupKeyDown}
            >
              {groups.map((g) => (
                <button
                  key={g.id}
                  ref={(el) => {
                    groupBtnRefs.current[g.id] = el
                  }}
                  type="button"
                  className={`new-chat-group-btn${openGroup === g.id ? ' is-open' : ''}`}
                  aria-expanded={openGroup === g.id}
                  aria-controls="new-chat-group-list"
                  disabled={busy}
                  onClick={() => setOpenGroup((cur) => (cur === g.id ? null : g.id))}
                >
                  <Glyph>{GROUP_GLYPHS[g.id]}</Glyph>
                  {g.label}
                </button>
              ))}
            </div>
            {groupPrompts.length > 0 ? (
              <ul
                id="new-chat-group-list"
                key={openGroup}
                className="new-chat-group-list"
                aria-label={groups.find((g) => g.id === openGroup)?.label}
                onKeyDown={onGroupKeyDown}
              >
                {groupPrompts.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="new-chat-prompt"
                      disabled={busy}
                      title={suggestionText(g.prompt)}
                      onClick={() => {
                        setOpenGroup(null)
                        submit(g.prompt)
                      }}
                    >
                      <span>{suggestionText(g.prompt)}</span>
                      <Glyph>
                        <path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" />
                      </Glyph>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {continueFiles.length > 0 ? (
              <section className="new-chat-continue" aria-labelledby="new-chat-continue-title">
                <h3 id="new-chat-continue-title" className="new-chat-continue-title">
                  {label('Làm tiếp', 'Pick up where you left off')}
                </h3>
                <ul className="new-chat-continue-list">
                  {continueFiles.map((f) => (
                    <li key={f.path} className="new-chat-continue-row">
                      <button
                        type="button"
                        className="new-chat-continue-open"
                        title={f.path}
                        onClick={() => {
                          window.aiOffice.openPath(f.path).catch((err: unknown) => {
                            push({
                              role: 'system',
                              tone: 'error',
                              text: label(
                                `Không mở được “${f.name}”: ${err instanceof Error ? err.message : String(err)}`,
                                `Couldn’t open “${f.name}”: ${err instanceof Error ? err.message : String(err)}`,
                              ),
                            })
                          })
                        }}
                      >
                        <FileBadge ext={f.ext} size={28} />
                        <span className="new-chat-continue-name">{f.name}</span>
                        <span className="new-chat-continue-time">
                          {relativeTime(f.mtimeMs, vi)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="new-chat-continue-ask"
                        disabled={busy}
                        aria-label={label(`Tóm tắt ${f.name}`, `Summarize ${f.name}`)}
                        onClick={() =>
                          submit(vi ? `Tóm tắt file ${f.name}` : `Summarize file ${f.name}`)
                        }
                      >
                        {label('Tóm tắt', 'Summarize')}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
        {empty ? footnote : null}
        {empty ? null : (
          <div className="new-chat-thread" aria-live="polite">
            {messages.map((m) => (
              <article
                key={m.id}
                className={`new-chat-msg is-${m.role}${m.streaming ? ' is-streaming' : ''}${m.tone === 'error' ? ' is-error' : ''}`}
                data-role={m.role}
              >
                {m.role === 'user' ? null : (
                  <span className="new-chat-msg-role">
                    {m.role === 'assistant' ? <UniAiMark size={18} /> : null}
                    {m.role === 'assistant'
                      ? 'UniAI'
                      : m.tone === 'error'
                        ? label('Chưa thực hiện được', 'Couldn’t complete')
                        : label('Hệ thống', 'System')}
                  </span>
                )}
                {m.attachments && m.attachments.length > 0 ? (
                  <div
                    className="new-chat-msg-atts"
                    aria-label={label('Tệp đính kèm', 'Attachments')}
                  >
                    {m.attachments.map((a) =>
                      isImageAttachment(a) ? (
                        <span key={a.path} className="new-chat-att-thumb" title={a.name}>
                          {attachmentPreviews[a.path] ? (
                            <img src={attachmentPreviews[a.path]} alt={a.name} />
                          ) : (
                            <span className="new-chat-att-thumb-fallback">
                              {a.ext.toUpperCase()}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span key={a.path} className="new-chat-att-card" title={a.name}>
                          <span className="new-chat-att-card-ext">{a.ext.toUpperCase()}</span>
                          <span className="new-chat-att-card-meta">
                            <span className="new-chat-att-card-name">{a.name}</span>
                            <span className="new-chat-att-card-size">
                              {formatAttachmentSize(a.sizeBytes)}
                            </span>
                          </span>
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
                {m.streaming && !m.text ? (
                  <AiTypingIndicator label={label('Đang suy nghĩ', 'Thinking')} />
                ) : (
                  <p className={m.streaming ? 'is-streaming-text' : undefined}>{m.text}</p>
                )}
                {m.choices && m.choices.length > 0 && !m.choicesResolved ? (
                  <div className="new-chat-msg-choices" role="group">
                    {m.choices.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="new-chat-chip"
                        disabled={busy}
                        onClick={() => onChoice(m.id, c)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {m.role === 'assistant' && !m.streaming && m.text ? (
                  <div className="new-chat-msg-actions">
                    <button
                      type="button"
                      className="new-chat-msg-action"
                      onClick={() => void copyMessage(m)}
                    >
                      <Glyph>
                        {copiedId === m.id ? (
                          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                        ) : (
                          <>
                            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                            <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
                          </>
                        )}
                      </Glyph>
                      <span aria-live="polite">
                        {copiedId === m.id
                          ? label('Đã sao chép', 'Copied')
                          : label('Sao chép', 'Copy')}
                      </span>
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {busy && !messages.some((m) => m.streaming) ? (
              <div className="new-chat-typing-row">
                <AiTypingIndicator label={label('Đang xử lý', 'Working')} />
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {empty ? null : composer}
      {empty ? null : footnote}
    </>
  )

  return (
    <main
      className={`new-chat${askMode ? ' is-ask' : empty ? ' is-empty' : ''}`}
      aria-label={label('Trợ lý của bạn', 'My AI')}
    >
      {bar}
      {askMode ? null : chatContent}
      {askAvailable && askOpened ? <AskUniPane visible={askMode} /> : null}
    </main>
  )
}
