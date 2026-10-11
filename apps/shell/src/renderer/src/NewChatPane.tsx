import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PracticeId, WorkbenchModuleId } from '@uniwork/practice-core'
import { AiTypingIndicator, IconStop } from '@genoffice/ui'
import { applyAgentIntent, undoAgentAddItem } from './agent-intent-apply'
import { emitAgentIntentNavigate } from './agent-intent-bus'
import { buildMyAiContextPack, type MyAiContextPack } from './context-manager'
import { useI18n } from './locale'
import { useUniworkCloudStatus } from './UniworkCloudPane'
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
  resolveFormFillContext,
} from './my-ai-forms'
import { buildTemplateBrief, resolveTemplateSlots, slotPromptPrefix } from './my-ai-templates'
import { readClients, readForms } from './workbench-pins'
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
  aiSettingsReady,
  openAiSettingsLabel,
  looksLikeMissingAiActivation,
  softAiActivationMessage,
} from './my-ai-activation'
import type { RecentEntry } from '../../shared/home-api'
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
}

const PASTE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

interface Suggestion {
  id: string
  labelVi: string
  labelEn: string
  promptVi: string
  promptEn: string
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    id: 'draft-doc',
    labelVi: 'Soạn Word theo yêu cầu',
    labelEn: 'Draft Word from brief',
    promptVi: 'Soạn văn bản Word: thư mời họp khách hàng tuần tới',
    promptEn: 'Draft a Word doc: client meeting invitation for next week',
  },
  {
    id: 'open-file',
    labelVi: 'Mở file gần đây',
    labelEn: 'Open a recent file',
    promptVi: 'Mở file báo cáo',
    promptEn: 'Open report file',
  },
  {
    id: 'search',
    labelVi: 'Tìm file',
    labelEn: 'Find a file',
    promptVi: 'Tìm file hợp đồng',
    promptEn: 'Find contract file',
  },
  {
    id: 'sum',
    labelVi: 'Tóm tắt file gần đây',
    labelEn: 'Summarize recents',
    promptVi: 'Tóm tắt file gần đây',
    promptEn: 'Summarize recent files',
  },
  {
    id: 'task',
    labelVi: 'Thêm việc',
    labelEn: 'Add a task',
    promptVi: 'Thêm công việc gọi khách lúc 15 giờ',
    promptEn: 'Add a task to call the client at 3pm',
  },
  {
    id: 'slide',
    labelVi: 'Tạo Slide AI',
    labelEn: 'AI Slides',
    promptVi: 'Tạo bài thuyết trình về kế hoạch quý',
    promptEn: 'Create a presentation about the quarterly plan',
  },
  {
    id: 'pdf',
    labelVi: 'Tạo PDF',
    labelEn: 'New PDF',
    promptVi: 'Tạo file PDF mới',
    promptEn: 'Create a new PDF file',
  },
  {
    id: 'cal',
    labelVi: 'Mở lịch',
    labelEn: 'Open calendar',
    promptVi: 'Mở tab lịch của tôi',
    promptEn: 'Open my calendar tab',
  },
  {
    id: 'multi',
    labelVi: '1 câu = nhiều bước',
    labelEn: 'One shot, multi-step',
    promptVi: 'Soạn báo giá Word và thêm công việc follow-up khách, mở tab Clients',
    promptEn: 'Draft a Word quote and add a follow-up task, open Clients tab',
  },
  {
    id: 'continue',
    labelVi: 'Tiếp tục tab đang mở',
    labelEn: 'Continue open tab',
    promptVi: 'Tiếp tục trên file đang mở: làm rõ phần kết luận',
    promptEn: 'Continue on the open file: clarify the conclusion section',
  },
  {
    id: 'sum-active',
    labelVi: 'Tóm tắt tab đang mở',
    labelEn: 'Summarize open tab',
    promptVi: 'Tóm tắt file đang mở',
    promptEn: 'Summarize the open file',
  },
  {
    id: 'sheet-ai',
    labelVi: 'Tạo Excel AI',
    labelEn: 'AI Excel',
    promptVi: 'Tạo bảng Excel theo dõi doanh số tháng này',
    promptEn: 'Create an Excel sheet to track this month’s sales',
  },
]

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
  const { lang } = useI18n()
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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

    const provider = settings.provider
    const model = settings.providers?.[provider]?.model

    if (!aiSettingsReady(settings)) {
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
          ...(result.ok ? {} : { role: 'system' as const }),
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
      if (msgId) patchMessage(msgId, { text: error, streaming: false, role: 'system' })
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
      const { clientRow } = resolveFormFillContext(practiceId, form, hint)
      const excerpt = form.filePath ? await readFormFileExcerpt(form.filePath) : ''
      const brief = buildFormFillBrief({ form, vi, userHint: hint, excerpt, clientRow })
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
        const clients = readClients(practiceId).slice(0, 5)
        const choices: ChatChoice[] = []
        const needsClient = resolved.missing.some(
          (s) => s.id === 'client' || s.id === 'party' || s.id === 'investor',
        )
        if (needsClient) {
          for (const c of clients) {
            choices.push({
              id: `tpl-client-${c.id}`,
              label: c.name,
              kind: 'prompt',
              value: label(
                `Soạn ${resolved.template.labelVi} cho khách ${c.name}`,
                `Draft ${resolved.template.labelEn} for client ${c.name}`,
              ),
            })
          }
        }
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
    const result = applyAgentIntent(step.intent, practiceId)
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
      if (local.topic === 'email') {
        topicChoices.push({
          id: 'email',
          label: label('Mở email', 'Open email'),
          kind: 'prompt',
          value: label('Mở tab email', 'Open email tab'),
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

  return (
    <main className="new-chat" aria-label={label('Trợ lý của bạn', 'My AI')}>
      <header className="new-chat-bar">
        <div>
          <strong>{label('Trợ lý của bạn', 'My AI')}</strong>
          <span>
            {label(
              'Lưu theo vai · thêm mục trên máy có Hoàn tác · AI/Token hỏi trước khi chạy.',
              'Saved per role · on-device adds support Undo · AI/Tokens ask first.',
            )}
          </span>
        </div>
        <button type="button" className="btn" onClick={resetChat} disabled={busy && empty}>
          {label('Chat mới', 'New chat')}
        </button>
      </header>

      <div className="new-chat-body">
        {empty ? (
          <div className="new-chat-hero">
            <p className="new-chat-kicker">uniAI · UniWork Office</p>
            <h1>{label('Bạn muốn làm gì hôm nay?', 'What do you want to get done?')}</h1>
            <p className="new-chat-sub">
              {label(
                'Ví dụ: “Soạn báo giá Word và thêm việc follow-up, mở Clients”, “Tóm tắt file gần đây”.',
                'e.g. “Draft a Word quote and add a follow-up task, open Clients”, “Summarize recent files”.',
              )}
            </p>
            <div className="new-chat-suggestions" role="list">
              {practiceChips.map((s) => (
                <button
                  key={`p-${s.id}`}
                  type="button"
                  className="new-chat-chip is-practice"
                  role="listitem"
                  disabled={busy}
                  onClick={() => submit(vi ? s.promptVi : s.promptEn)}
                >
                  {vi ? s.labelVi : s.labelEn}
                </button>
              ))}
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="new-chat-chip"
                  role="listitem"
                  disabled={busy}
                  onClick={() => submit(vi ? s.promptVi : s.promptEn)}
                >
                  {vi ? s.labelVi : s.labelEn}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="new-chat-thread" aria-live="polite">
            {messages.map((m) => (
              <article
                key={m.id}
                className={`new-chat-msg is-${m.role}${m.streaming ? ' is-streaming' : ''}`}
                data-role={m.role}
              >
                <span className="new-chat-msg-role">
                  {m.role === 'user'
                    ? label('Bạn', 'You')
                    : m.role === 'assistant'
                      ? 'uniAI'
                      : label('Hệ thống', 'System')}
                </span>
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

      <footer className="new-chat-composer">
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
          rows={2}
          value={input}
          disabled={busy}
          placeholder={label(
            'Soạn Word… · Đính kèm file/ảnh · Tóm tắt Recent…',
            'Draft Word… · Attach files/images · Summarize Recents…',
          )}
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
          <div className="new-chat-composer-left">
            <button
              type="button"
              className="btn new-chat-attach-btn"
              disabled={busy}
              onClick={() => void pickFiles()}
              title={label('Đính kèm file hoặc ảnh', 'Attach files or images')}
            >
              {label('Đính kèm', 'Attach')}
            </button>
            <span>
              {label(
                'Enter gửi · Shift+Enter xuống dòng',
                'Enter to send · Shift+Enter for newline',
              )}
            </span>
          </div>
          {busy ? (
            <button
              type="button"
              className="btn"
              onClick={stopStream}
              title={label('Dừng', 'Stop')}
            >
              <IconStop />
              <span>{label('Dừng', 'Stop')}</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSend}
              onClick={() => submit()}
            >
              {label('Gửi', 'Send')}
            </button>
          )}
        </div>
      </footer>
    </main>
  )
}
