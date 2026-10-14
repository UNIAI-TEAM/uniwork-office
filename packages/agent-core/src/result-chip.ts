import { classifyDroppedToolReason, type PanelNote } from './notice-surface'

export type ResultChipKind = 'edited' | 'unsupported' | 'clarify' | 'error' | 'answer'

export type ResultChipTone = 'ok' | 'neutral' | 'warn' | 'error' | 'info'

export type ResultChipLabelKey =
  | 'aiResultEdited'
  | 'aiResultUnsupported'
  | 'aiResultClarify'
  | 'aiResultError'
  | 'aiResultAnswer'

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

export type ResultChipErrorAction =
  | 'ask-again'
  | 'choose-provider'
  | 'sign-in'
  | 'retry'
  | 'open-in-app'

export type ResultChipErrorActionKey =
  | 'aiRunAskAgain'
  | 'aiRunChooseOther'
  | 'acctSignInAgain'
  | 'aiRunOpenInApp'

export interface ResultChipToolExecution {
  readonly name: string
  readonly mutated?: boolean | undefined
  readonly isError?: boolean | undefined
  readonly summary?: string | undefined
  readonly output?: string | undefined
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
  readonly cellsMetaParams?: {
    readonly written: number
    readonly range: string
    readonly overwritten: number
  } | undefined
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
  readonly provider?: string | undefined
  readonly text?: string | null | undefined
  /** True when >=1 editor write tool succeeded in the turn */
  readonly mutated?: boolean | undefined
  readonly toolExecutions?: readonly ResultChipToolExecution[] | undefined
  readonly droppedToolCalls?: readonly ResultChipDroppedToolCall[] | undefined
  readonly panelNotes?: readonly PanelNote[] | undefined
  /** True when the allowlisted `ask_clarification` tool was called */
  readonly clarifyCalled?: boolean | undefined
  /** S9 error string or `{ code, message }` when the turn ended in an error */
  readonly error?: string | ResultChipErrorInput | null | undefined
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
  const code = (typeof error === 'string' ? error : error.code ?? error.message ?? '').trim()
  const rawMessage = typeof error === 'string' ? error : error.message ?? error.code ?? ''
  if (!code && !rawMessage) return null

  const lower = code.toLowerCase()
  if (
    lower === 'run_limit_reached' ||
    lower === 'turn_limit' ||
    lower === 'max_turns' ||
    code === 'aiErrRunLimit'
  ) {
    return {
      key: 'aiErrRunLimit',
      rawMessage,
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
      rawMessage,
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
      rawMessage,
      action: 'choose-provider',
      actionKey: 'aiRunChooseOther',
    }
  }
  if (
    lower === 'capability_off' ||
    lower === 'ai_disabled' ||
    lower === 'uniwork_off' ||
    code === 'aiErrCapabilityOff'
  ) {
    return {
      key: 'aiErrCapabilityOff',
      rawMessage,
      action: 'choose-provider',
      actionKey: 'aiRunChooseOther',
    }
  }
  if (
    lower === 'session_expired' ||
    lower === 'unauthorized' ||
    lower === 'unauthenticated' ||
    code === 'aiErrSession'
  ) {
    return {
      key: 'aiErrSession',
      rawMessage,
      action: 'sign-in',
      actionKey: 'acctSignInAgain',
    }
  }
  if (
    lower === 'ai_rate_limited' ||
    lower === 'rate_limited' ||
    lower === 'too_many_requests' ||
    code === 'aiErrRateLimitedNoWait'
  ) {
    return {
      key: 'aiErrRateLimitedNoWait',
      rawMessage,
      action: 'retry',
      actionKey: null,
    }
  }
  if (
    lower === 'unavailable' ||
    lower === 'ai_provider_error' ||
    lower === 'service_unavailable' ||
    code === 'aiErrUnavailable'
  ) {
    return {
      key: 'aiErrUnavailable',
      rawMessage,
      action: 'retry',
      actionKey: null,
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
      rawMessage,
      action: 'retry',
      actionKey: null,
    }
  }
  if (lower === 'offline' || code === 'aiErrOffline') {
    return {
      key: 'aiErrOffline',
      rawMessage,
      action: null,
      actionKey: null,
    }
  }
  if (lower === 'revoked' || lower === 'access_revoked' || code === 'aiErrRevoked') {
    return {
      key: 'aiErrRevoked',
      rawMessage,
      action: null,
      actionKey: null,
    }
  }
  if (lower === 'downgraded' || lower === 'view_only_downgraded' || code === 'aiErrDowngraded') {
    return {
      key: 'aiErrDowngraded',
      rawMessage,
      action: null,
      actionKey: null,
    }
  }
  if (lower === 'conversation_expired' || code === 'aiConversationRestarted') {
    return {
      key: 'aiConversationRestarted',
      rawMessage,
      action: null,
      actionKey: null,
    }
  }
  if (
    lower === 'workbook_too_large' ||
    lower === 'payload_too_large' ||
    code === 'aiErrWorkbookTooLarge'
  ) {
    return {
      key: 'aiErrWorkbookTooLarge',
      rawMessage,
      action: 'open-in-app',
      actionKey: 'aiRunOpenInApp',
    }
  }
  if (lower === 'question_too_long' || code === 'aiErrQuestionTooLong') {
    return {
      key: 'aiErrQuestionTooLong',
      rawMessage,
      action: null,
      actionKey: null,
    }
  }
  if (lower === 'question_rejected' || code === 'aiErrQuestionRejected') {
    return {
      key: 'aiErrQuestionRejected',
      rawMessage,
      action: null,
      actionKey: null,
    }
  }

  return {
    key: null,
    rawMessage,
    action: 'retry',
    actionKey: null,
  }
}

/**
 * Extracts XLSX write metadata (`range`, `written`, `overwritten`, `sheet`, `rows`) from tool summaries/outputs
 * when explicit `cellsMeta` was not passed.
 */
export function extractSheetsCellsMeta(
  tools: readonly ResultChipToolExecution[] | undefined,
): ResultChipCellsMetaInput | null {
  if (!tools || tools.length === 0) return null
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i]
    if (!t || t.isError) continue
    const source = `${t.summary ?? ''} ${t.output ?? ''}`.trim()
    if (!source) continue
    const rangeMatch =
      /(?:[A-Za-z0-9_'\s]+!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/.exec(source)
    const writtenMatch = /(\d+)\s*(?:cells?|ô)/i.exec(source)
    const overwrittenMatch = /(\d+)\s*(?:existing\s+cells?\s+)?(?:overwritten|ô[^)]*ghi\s+đè)/i.exec(
      source,
    )
    if (rangeMatch && writtenMatch) {
      const range = rangeMatch[0]!.trim()
      const sheet = range.includes('!') ? range.split('!')[0]!.replace(/^'|'$/g, '') : undefined
      return {
        ...(sheet ? { sheet } : {}),
        range,
        written: Number(writtenMatch[1]),
        overwritten: overwrittenMatch ? Number(overwrittenMatch[1]) : 0,
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
            overwritten: cells.overwritten ?? 0,
          },
        }
      : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

/**
 * Pure, deterministic result chip classifier for UniWork AI turns:
 * (1) `edited` if >=1 editor write tool succeeded in the turn (wins even if the turn later ended in error -> chip edited + S9 error line with action)
 * (2) `unsupported` only from `x_uniwork.dropped_tool_calls` when no write ran (`view_only` -> `aiErrViewOnlyEdit`, `not_allowlisted` -> `aiErrUnsupported {module}`)
 * (3) `clarify` only when the allowlisted `ask_clarification` tool was called
 * (4) `error` when the turn ended in an S9 error
 * (5) `answer` otherwise (including §6.5 engine-cannot-compute with warning in meta, and Stop with partial text).
 * Stop with no text and no write -> `chip: null`, `stoppedLine: true` (`aiRunStopped`).
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
  const errorLine = classifyS9Error(input.error, input.turnLimit)
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

  // (2) unsupported: only from x_uniwork.dropped_tool_calls when no write ran
  const droppedCalls: ResultChipDroppedToolCall[] = [
    ...(input.droppedToolCalls ?? []),
    ...(input.panelNotes
      ?.filter((n) => n.kind === 'dropped')
      .map((n) => ({
        name: n.toolName ?? 'tool',
        reason: n.reason,
        module: n.module,
      })) ?? []),
  ]
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
      stoppedLine: stopped,
      stoppedKey: stopped ? 'aiRunStopped' : null,
    }
  }

  // (3) clarify: only when the allowlisted ask_clarification tool was called
  const hasClarify =
    Boolean(input.clarifyCalled) ||
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
      stoppedLine: stopped,
      stoppedKey: stopped ? 'aiRunStopped' : null,
    }
  }

  // Stop rules before any write
  if (stopped) {
    const hasText = Boolean(input.text && input.text.trim().length > 0)
    if (!hasText) {
      return {
        chip: null,
        labelKey: null,
        tone: null,
        viewChangesKey: null,
        editedHintKey: null,
        meta: null,
        errorLine: null,
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
