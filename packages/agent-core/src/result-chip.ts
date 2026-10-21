import { classifyDroppedToolReason } from './notice-surface'

export type ResultChipKind = 'edited' | 'unsupported' | 'clarify' | 'error' | 'answer'

export type ResultChipTone = 'ok' | 'neutral' | 'warn' | 'error' | 'info'

export type ResultChipLabelKey =
  'aiResultEdited' | 'aiResultUnsupported' | 'aiResultClarify' | 'aiResultError' | 'aiResultAnswer'

export type ResultChipReasonKey = 'aiErrViewOnlyEdit' | 'aiErrUnsupported'

export type ResultChipErrorKey =
  | 'aiErrRunLimit'
  | 'aiErrCredits'
  | 'aiErrEntitlement'
  | 'aiErrCapabilityOff'
  | 'aiErrSession'
  | 'aiErrRateLimitedNoWait'
  | 'aiErrUnavailable'
  | 'aiErrDisconnected'
  | 'aiErrOffline'
  | 'aiErrRevoked'
  | 'aiErrDowngraded'
  | 'aiConversationRestarted'
  | 'aiErrWorkbookTooLarge'
  | 'aiErrQuestionTooLong'
  | 'aiErrQuestionRejected'
  | 'aiErrViewOnlyEdit'
  | 'aiErrUnsupported'
  | 'aiErrGeneric'

export type ResultChipErrorAction =
  'ask-again' | 'choose-provider' | 'sign-in' | 'retry' | 'open-in-app'

export type ResultChipErrorActionKey =
  'aiRunAskAgain' | 'aiRunChooseOther' | 'acctSignInAgain' | 'aiRunOpenInApp' | 'aiRunRetry'

export interface ResultChipToolExecution {
  readonly name: string
  readonly mutated?: boolean | undefined
  readonly isError?: boolean | undefined
  readonly summary?: string | undefined
  readonly output?: string | undefined
  readonly cellsMeta?: ResultChipCellsMetaInput | null | undefined
}

export interface ResultChipDroppedToolCall {
  readonly name: string
  readonly reason?: string | undefined
  readonly module?: string | undefined
}

export interface ResultChipCellsMetaInput {
  readonly sheet?: string | undefined
  readonly range: string
  readonly written: number
  readonly overwritten?: number | undefined
  readonly rows?: number | undefined
  readonly warnings?: readonly string[] | undefined
}

export interface ResultChipMeta {
  readonly sheet?: string | undefined
  readonly range?: string | undefined
  readonly written?: number | undefined
  readonly overwritten?: number | undefined
  readonly rows?: number | undefined
  readonly cellsMetaKey?: 'aiResultCellsMeta' | undefined
  readonly cellsMetaParams?:
    | {
        readonly written: number
        readonly range: string
        /** `null` when the tool did not report an overwritten count (unknown is not zero) */
        readonly overwritten: number | null
      }
    | undefined
  readonly warnings?: readonly string[] | undefined
}

export interface ResultChipErrorInput {
  readonly code?: string | undefined
  readonly message?: string | undefined
}

export interface ResultChipErrorLine {
  readonly key: ResultChipErrorKey | null
  readonly params?: Readonly<Record<string, string | number>> | undefined
  readonly rawMessage?: string | undefined
  readonly action: ResultChipErrorAction | null
  readonly actionKey: ResultChipErrorActionKey | null
}

export interface ResultChipInput {
  /** Whether UniWork AI (`uniwork`) is active; when explicitly `false` (or `provider !== 'uniwork'`), returns `chip: null` */
  readonly isUniwork?: boolean | undefined
  readonly provider?: string | null | undefined
  readonly text?: string | null | undefined
  /** Alias for non-empty streamed text when `text` is omitted */
  readonly hasStreamedText?: boolean | undefined
  /** True when >=1 editor write tool succeeded in the turn */
  readonly mutated?: boolean | undefined
  readonly toolExecutions?: readonly ResultChipToolExecution[] | undefined
  readonly droppedToolCalls?: readonly ResultChipDroppedToolCall[] | undefined
  /** True when the allowlisted `ask_clarification` tool was called */
  readonly clarifyCalled?: boolean | undefined
  /** Alias for `clarifyCalled` */
  readonly clarifyAsked?: boolean | undefined
  /** S9 error string or `{ code, message }` when the turn ended in an error */
  readonly error?: string | ResultChipErrorInput | null | undefined
  /** Alias indicating the turn ended in an error when `error` is passed via `text` */
  readonly isError?: boolean | undefined
  /** True when the user stopped the turn (`Stop` button or `Esc`) */
  readonly stopped?: boolean | undefined
  /** True when the turn hit the step limit (`run_limit_reached`) */
  readonly turnLimit?: boolean | undefined
  /** Module display name for `aiErrUnsupported {module}` (e.g. `'Docs'`, `'Sheets'`) */
  readonly moduleName?: string | undefined
  /** XLSX write metadata (`sheet`, `range`, `written`, `overwritten`, `rows`, `warnings`) */
  readonly cellsMeta?: ResultChipCellsMetaInput | null | undefined
  /** §6.5 Formula engine cannot compute warning */
  readonly engineCannotCompute?: boolean | undefined
  readonly engineWarning?: string | undefined
  readonly warnings?: readonly string[] | undefined
}

export interface ResultChipOutput {
  readonly chip: ResultChipKind | null
  readonly labelKey: ResultChipLabelKey | null
  readonly tone: ResultChipTone | null
  readonly viewChangesKey: 'aiResultViewChanges' | null
  readonly editedHintKey: 'aiResultEditedHint' | null
  readonly reasonKey?: ResultChipReasonKey | undefined
  readonly reasonParams?: Readonly<Record<string, string | number>> | undefined
  readonly meta: ResultChipMeta | null
  readonly errorLine: ResultChipErrorLine | null
  readonly stoppedLine: boolean
  readonly stoppedKey: 'aiRunStopped' | null
}

export function classifyS9Error(
  error: string | ResultChipErrorInput | null | undefined,
  turnLimit?: boolean,
): ResultChipErrorLine | null {
  if (turnLimit && !error) {
    return {
      key: 'aiErrRunLimit',
      action: 'ask-again',
      actionKey: 'aiRunAskAgain',
    }
  }
  if (!error) return null
  const code = (typeof error === 'string' ? error : (error.code ?? error.message ?? '')).trim()
  const rawMessage = typeof error === 'string' ? error : (error.message ?? error.code ?? '')
  if (!code && !rawMessage) return null

  const lower = code.toLowerCase()
  if (
    lower === 'run_limit_reached' ||
    lower === 'run_expired' ||
    lower === 'turn_limit' ||
    lower === 'max_turns' ||
    code === 'aiErrRunLimit'
  ) {
    return {
      key: 'aiErrRunLimit',
      action: 'ask-again',
      actionKey: 'aiRunAskAgain',
    }
  }
  if (
    lower === 'credits_exhausted' ||
    lower === 'insufficient_credits' ||
    code === 'aiErrCredits'
  ) {
    return {
      key: 'aiErrCredits',
      action: 'choose-provider',
      actionKey: 'aiRunChooseOther',
    }
  }
  if (
    lower === 'entitlement_required' ||
    lower === 'plan_required' ||
    lower === 'not_entitled' ||
    code === 'aiErrEntitlement'
  ) {
    return {
      key: 'aiErrEntitlement',
      action: 'choose-provider',
      actionKey: 'aiRunChooseOther',
    }
  }
  if (
    lower === 'office_capability_off' ||
    lower === 'capability_off' ||
    lower === 'format_off' ||
    lower === 'format-off' ||
    lower === 'ai_disabled' ||
    lower === 'uniwork_off' ||
    code === 'aiErrCapabilityOff'
  ) {
    return {
      key: 'aiErrCapabilityOff',
      action: 'choose-provider',
      actionKey: 'aiRunChooseOther',
    }
  }
  if (
    lower === 'session_expired' ||
    lower === 'unauthorized' ||
    lower === 'unauthenticated' ||
    lower === '401' ||
    code === 'aiErrSession'
  ) {
    return {
      key: 'aiErrSession',
      action: 'sign-in',
      actionKey: 'acctSignInAgain',
    }
  }
  if (
    lower === 'ai_rate_limited' ||
    lower === 'ai_uniwork_busy' ||
    lower === 'rate_limited' ||
    lower === 'too_many_requests' ||
    lower === '429' ||
    code === 'aiErrRateLimitedNoWait'
  ) {
    return {
      key: 'aiErrRateLimitedNoWait',
      action: 'retry',
      actionKey: 'aiRunRetry',
    }
  }
  if (
    lower === 'provider_unreachable' ||
    lower === 'cloud_unavailable' ||
    lower === 'timeout' ||
    lower === 'ai_provider_timeout' ||
    lower === 'unavailable' ||
    lower === 'ai_provider_error' ||
    lower === 'service_unavailable' ||
    lower === '502' ||
    lower === '503' ||
    lower === '504' ||
    code === 'aiErrUnavailable'
  ) {
    return {
      key: 'aiErrUnavailable',
      action: 'retry',
      actionKey: 'aiRunRetry',
    }
  }
  if (
    lower === 'disconnected' ||
    lower === 'network_error' ||
    lower === 'stream_disconnected' ||
    code === 'aiErrDisconnected'
  ) {
    return {
      key: 'aiErrDisconnected',
      action: 'retry',
      actionKey: 'aiRunRetry',
    }
  }
  if (lower === 'offline' || code === 'aiErrOffline') {
    return {
      key: 'aiErrOffline',
      action: null,
      actionKey: null,
    }
  }
  if (lower === 'revoked' || lower === 'access_revoked' || code === 'aiErrRevoked') {
    return {
      key: 'aiErrRevoked',
      action: null,
      actionKey: null,
    }
  }
  if (lower === 'downgraded' || lower === 'view_only_downgraded' || code === 'aiErrDowngraded') {
    return {
      key: 'aiErrDowngraded',
      action: null,
      actionKey: null,
    }
  }
  if (lower === 'conversation_expired' || code === 'aiConversationRestarted') {
    return {
      key: 'aiConversationRestarted',
      action: null,
      actionKey: null,
    }
  }
  if (
    lower === 'workbook_too_large' ||
    lower === 'payload_too_large' ||
    lower === 'ai_tool_result_too_large' ||
    code === 'aiErrWorkbookTooLarge'
  ) {
    return {
      key: 'aiErrWorkbookTooLarge',
      action: 'open-in-app',
      actionKey: 'aiRunOpenInApp',
    }
  }
  if (lower === 'question_too_long' || code === 'aiErrQuestionTooLong') {
    return {
      key: 'aiErrQuestionTooLong',
      action: null,
      actionKey: null,
    }
  }
  if (lower === 'question_rejected' || code === 'aiErrQuestionRejected') {
    return {
      key: 'aiErrQuestionRejected',
      action: null,
      actionKey: null,
    }
  }

  // Never fall through to key: null + raw server text (RF1-6). A code we cannot name is not a
  // "service unavailable" either, so it gets the generic line and no Retry (RF2-3).
  return {
    key: 'aiErrGeneric',
    action: null,
    actionKey: null,
  }
}

/** True for an error that only reports the user's own cancel (AbortError, "aborted", "cancelled"). */
export function isAbortTypeError(error: string | ResultChipErrorInput | null | undefined): boolean {
  if (!error) return false
  const parts = typeof error === 'string' ? [error] : [error.code ?? '', error.message ?? '']
  return parts.some((part) =>
    /\babort(?:ed|_err|error)?\b|aborterror|\bcancel+ed\b|err_canceled|user_cancel/i.test(part),
  )
}

/** Valid A1 column index (A..XFD = 1..16384) and row index (1..1048576). */
function isValidA1Ref(colLetters: string, rowDigits: string): boolean {
  if (!/^[A-Z]{1,3}$/.test(colLetters) || !/^[1-9]\d{0,6}$/.test(rowDigits)) return false
  let col = 0
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 64)
  }
  if (col < 1 || col > 16384) return false
  const row = Number(rowDigits)
  return row >= 1 && row <= 1048576
}

/**
 * Extracts a valid XLSX range token (e.g. `Sheet1!B4:C9`, `'Revenue 2026'!$D$2:$F$10`, `A1:D10`)
 * while rejecting ordinary tokens like `UTF8` or `ID2` that lack a sheet prefix or range colon.
 */
function matchValidSheetRange(source: string): { sheet?: string; range: string } | null {
  const pattern =
    /(?<![A-Za-z0-9_$])(?:(?:'([^']+)'|(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*))!)?(\$?)([A-Z]{1,3})(\$?)([1-9]\d{0,6})(?::(\$?)([A-Z]{1,3})(\$?)([1-9]\d{0,6}))?(?![A-Za-z0-9_])/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(source)) !== null) {
    const quotedSheet = m[1]
    const bareSheet = m[2]
    const c1 = m[4]!
    const r1 = m[6]!
    const c2 = m[8]
    const r2 = m[10]
    const hasSheet = Boolean(quotedSheet || bareSheet)
    const hasColon = Boolean(c2 && r2)
    // Reject bare single-cell-looking tokens in prose (e.g. UTF8, ID2) unless qualified with `!` or `:`
    if (!hasSheet && !hasColon) continue
    if (!isValidA1Ref(c1, r1)) continue
    if (hasColon && !isValidA1Ref(c2!, r2!)) continue
    const sheet = quotedSheet ?? bareSheet
    return {
      ...(sheet ? { sheet } : {}),
      range: m[0]!,
    }
  }
  return null
}

function tryParseStructuredCellsMeta(
  tool: ResultChipToolExecution,
): ResultChipCellsMetaInput | null {
  if (tool.cellsMeta && typeof tool.cellsMeta.range === 'string') {
    return tool.cellsMeta
  }
  const raw = tool.output?.trim()
  if (!raw || !raw.startsWith('{')) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const candidate =
      parsed.cellsMeta && typeof parsed.cellsMeta === 'object'
        ? (parsed.cellsMeta as Record<string, unknown>)
        : parsed
    if (typeof candidate.range === 'string' && typeof candidate.written === 'number') {
      const sheet =
        typeof candidate.sheet === 'string'
          ? candidate.sheet
          : candidate.range.includes('!')
            ? candidate.range.split('!')[0]!.replace(/^'|'$/g, '')
            : undefined
      return {
        ...(sheet ? { sheet } : {}),
        range: candidate.range,
        written: candidate.written,
        ...(typeof candidate.overwritten === 'number'
          ? { overwritten: candidate.overwritten }
          : {}),
        ...(typeof candidate.rows === 'number' ? { rows: candidate.rows } : {}),
        ...(Array.isArray(candidate.warnings)
          ? { warnings: candidate.warnings.filter((w): w is string => typeof w === 'string') }
          : {}),
      }
    }
  } catch {
    // Not structured JSON output; fall back to summary/output token extraction
  }
  return null
}

/**
 * Extracts XLSX write metadata (`range`, `written`, `overwritten`, `sheet`, `rows`) from structured
 * tool output when available, falling back to English summary/output tokens when explicit `cellsMeta`
 * was not passed.
 */
export function extractSheetsCellsMeta(
  tools: readonly ResultChipToolExecution[] | undefined,
): ResultChipCellsMetaInput | null {
  if (!tools || tools.length === 0) return null
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i]
    if (!t || t.isError) continue
    const structured = tryParseStructuredCellsMeta(t)
    if (structured) return structured

    const source = `${t.summary ?? ''} ${t.output ?? ''}`.trim()
    if (!source) continue
    const matchedRange = matchValidSheetRange(source)
    const writtenMatch = /(\d+)\s*cells?\b/i.exec(source)
    const overwrittenMatch = /(\d+)\s*(?:existing\s+cells?\s+)?overwritten\b/i.exec(source)
    if (matchedRange && writtenMatch) {
      return {
        ...(matchedRange.sheet ? { sheet: matchedRange.sheet } : {}),
        range: matchedRange.range,
        written: Number(writtenMatch[1]),
        ...(overwrittenMatch ? { overwritten: Number(overwrittenMatch[1]) } : {}),
      }
    }
  }
  return null
}

function buildMeta(input: ResultChipInput): ResultChipMeta | null {
  const cells = input.cellsMeta ?? extractSheetsCellsMeta(input.toolExecutions)
  const warnings: string[] = [
    ...(input.warnings ?? []),
    ...(cells?.warnings ?? []),
    ...(input.engineWarning ? [input.engineWarning] : []),
  ]

  if (!cells && warnings.length === 0) {
    return null
  }

  return {
    ...(cells?.sheet ? { sheet: cells.sheet } : {}),
    ...(cells?.range ? { range: cells.range } : {}),
    ...(cells?.written !== undefined ? { written: cells.written } : {}),
    ...(cells?.overwritten !== undefined ? { overwritten: cells.overwritten } : {}),
    ...(cells?.rows !== undefined ? { rows: cells.rows } : {}),
    ...(cells
      ? {
          cellsMetaKey: 'aiResultCellsMeta' as const,
          cellsMetaParams: {
            written: cells.written,
            range: cells.range,
            overwritten: cells.overwritten ?? null,
          },
        }
      : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

function deduplicateDroppedCalls(
  calls: readonly ResultChipDroppedToolCall[] | undefined,
): ResultChipDroppedToolCall[] {
  if (!calls || calls.length === 0) return []
  const seen = new Set<string>()
  const viewOnly: ResultChipDroppedToolCall[] = []
  const notAllowlisted: ResultChipDroppedToolCall[] = []
  for (const call of calls) {
    const kind = classifyDroppedToolReason(call.reason)
    if (kind === 'other') continue
    const key = `${kind}:${call.module ?? ''}:${call.name}`
    if (!seen.has(key)) {
      seen.add(key)
      ;(kind === 'view_only' ? viewOnly : notAllowlisted).push(call)
    }
  }
  // view_only is the more specific reason for the user, so it leads whatever the arrival order
  return [...viewOnly, ...notAllowlisted]
}

/**
 * Pure, deterministic result chip classifier for UniWork AI turns:
 * (1) `edited` if >=1 editor write tool succeeded in the turn (wins even if the turn later ended in error -> chip edited + S9 error line with action)
 * (2) Stop before any write: if there is text -> `answer` chip + `aiRunStopped`; if no text -> `chip: null` + `aiRunStopped` (preserving any `errorLine`)
 * (3) `unsupported` only from `x_uniwork.dropped_tool_calls` when no write ran (`view_only` -> `aiErrViewOnlyEdit`, `not_allowlisted` -> `aiErrUnsupported {module}`)
 * (4) `clarify` only when the allowlisted `ask_clarification` tool was called
 * (5) `error` when the turn ended in an S9 error
 * (6) `answer` otherwise (including §6.5 engine-cannot-compute with warning in meta).
 */
export function resultChip(input: ResultChipInput): ResultChipOutput {
  const isUniwork =
    input.isUniwork ?? (input.provider === undefined ? true : input.provider === 'uniwork')

  if (!isUniwork) {
    return {
      chip: null,
      labelKey: null,
      tone: null,
      viewChangesKey: null,
      editedHintKey: null,
      meta: null,
      errorLine: null,
      stoppedLine: false,
      stoppedKey: null,
    }
  }

  const hasWrite =
    Boolean(input.mutated) ||
    Boolean(input.toolExecutions?.some((t) => t.mutated === true && !t.isError))

  const stopped = Boolean(input.stopped)
  const rawError = input.error ?? (input.isError ? input.text || 'unavailable' : null)
  // An abort reported while the user pressed Stop is the Stop itself, not a failure (RF2-3)
  const effectiveError = stopped && isAbortTypeError(rawError) ? null : rawError
  const errorLine = classifyS9Error(effectiveError, input.turnLimit)
  const meta = buildMeta(input)

  // (1) edited: >=1 editor write tool succeeded in the turn
  if (hasWrite) {
    return {
      chip: 'edited',
      labelKey: 'aiResultEdited',
      tone: 'ok',
      viewChangesKey: 'aiResultViewChanges',
      editedHintKey: 'aiResultEditedHint',
      meta,
      errorLine,
      stoppedLine: stopped,
      stoppedKey: stopped ? 'aiRunStopped' : null,
    }
  }

  // Stop rules before any write take priority over dropped and clarify chips (RF1-9),
  // while preserving any error raised during the stopped turn (RF1-10).
  if (stopped) {
    const hasText =
      Boolean(input.hasStreamedText) || Boolean(input.text && input.text.trim().length > 0)
    if (!hasText) {
      return {
        chip: null,
        labelKey: null,
        tone: null,
        viewChangesKey: null,
        editedHintKey: null,
        meta: null,
        errorLine,
        stoppedLine: true,
        stoppedKey: 'aiRunStopped',
      }
    }
    return {
      chip: 'answer',
      labelKey: 'aiResultAnswer',
      tone: 'info',
      viewChangesKey: null,
      editedHintKey: null,
      meta,
      errorLine,
      stoppedLine: true,
      stoppedKey: 'aiRunStopped',
    }
  }

  // (2) unsupported: only from x_uniwork.dropped_tool_calls when no write ran (RF1-13)
  const droppedCalls = deduplicateDroppedCalls(input.droppedToolCalls)
  if (droppedCalls.length > 0) {
    const first = droppedCalls[0]!
    const kind = classifyDroppedToolReason(first.reason)
    const isViewOnly = kind === 'view_only'
    const moduleName = first.module ?? input.moduleName ?? 'Office'
    return {
      chip: 'unsupported',
      labelKey: 'aiResultUnsupported',
      tone: 'neutral',
      viewChangesKey: null,
      editedHintKey: null,
      reasonKey: isViewOnly ? 'aiErrViewOnlyEdit' : 'aiErrUnsupported',
      ...(isViewOnly ? {} : { reasonParams: { module: moduleName } }),
      meta,
      errorLine,
      stoppedLine: false,
      stoppedKey: null,
    }
  }

  // (3) clarify: only when the allowlisted ask_clarification tool was called
  const hasClarify =
    Boolean(input.clarifyCalled) ||
    Boolean(input.clarifyAsked) ||
    Boolean(input.toolExecutions?.some((t) => t.name === 'ask_clarification' && !t.isError))
  if (hasClarify) {
    return {
      chip: 'clarify',
      labelKey: 'aiResultClarify',
      tone: 'warn',
      viewChangesKey: null,
      editedHintKey: null,
      meta,
      errorLine,
      stoppedLine: false,
      stoppedKey: null,
    }
  }

  // (4) error: when the turn ended in an S9 error
  if (errorLine) {
    return {
      chip: 'error',
      labelKey: 'aiResultError',
      tone: 'error',
      viewChangesKey: null,
      editedHintKey: null,
      meta,
      errorLine,
      stoppedLine: false,
      stoppedKey: null,
    }
  }

  // (5) answer (including §6.5 engine cannot compute with warning in meta)
  return {
    chip: 'answer',
    labelKey: 'aiResultAnswer',
    tone: 'info',
    viewChangesKey: null,
    editedHintKey: null,
    meta,
    errorLine: null,
    stoppedLine: false,
    stoppedKey: null,
  }
}
