import {
  resultChip,
  type ResultChipErrorKey,
  type ResultChipInput,
  type ResultChipLabelKey,
  type ResultChipOutput,
} from './result-chip'

export type ResultChip = ResultChipOutput
export type ResultChipStoppedKey = NonNullable<ResultChipOutput['stoppedKey']>

export interface UniworkPanelEntryLike {
  role: string
  streaming?: boolean | undefined
  text?: string | undefined
  waitLine?: string | undefined
  status?: string | undefined
  notes?: ReadonlyArray<{ text: string }> | undefined
  resultChip?: ResultChipOutput | null | undefined
}

export type UniworkTranslateFn = (
  key: ResultChipLabelKey | ResultChipStoppedKey | ResultChipErrorKey,
  vars?: Record<string, string | number>,
) => string

export interface EntryResultChipView {
  chip: ResultChipOutput
  labelText: string | null
  stoppedText: string | null
}

export interface PanelLiveAnnouncementInput {
  entries: ReadonlyArray<UniworkPanelEntryLike>
  busy: boolean
  translate: UniworkTranslateFn
  lastEntryChipInput?: ResultChipInput | null | undefined
}

/**
 * The text a fallback chip input falls back to. An explicit `hasStreamedText: false` means the
 * entry text is a filler the panel wrote (for example after a Stop before the first token), so it
 * must not count as an answer.
 */
function fallbackChipText(
  entry: UniworkPanelEntryLike,
  input: ResultChipInput,
): string | null | undefined {
  return input.text ?? (input.hasStreamedText === false ? '' : entry.text)
}

function isEmptyResultChip(chip: ResultChipOutput | null | undefined): boolean {
  if (!chip) return true
  return (
    chip.chip === null &&
    chip.labelKey === null &&
    !chip.stoppedLine &&
    chip.stoppedKey === null &&
    chip.errorLine === null
  )
}

/**
 * Returns true when the assistant turn containing `entries[index]` has ended:
 * - For the final entry in the thread, when `!busy`.
 * - For an earlier entry, when the immediately following entry is a user turn.
 */
export function isTurnEnded(
  entries: ReadonlyArray<{ role: string }>,
  index: number,
  busy: boolean,
): boolean {
  if (index < 0 || index >= entries.length) return false
  const next = entries[index + 1]
  return next ? next.role === 'user' : !busy
}

export const turnEnded = isTurnEnded

/**
 * Resolves the ResultChipOutput for an assistant entry once its turn has ended
 * and streaming has finished. Prefers a precomputed `entry.resultChip` and falls
 * back to computing `resultChip(fallbackInput)` when provided. Returns `null`
 * when the turn is not a UniWork turn (empty chip output).
 */
export function resolveEntryResultChip(
  entries: ReadonlyArray<UniworkPanelEntryLike>,
  index: number,
  busy: boolean,
  fallbackInput?: ResultChipInput | null,
): ResultChipOutput | null {
  const entry = entries[index]
  if (!entry || entry.role !== 'assistant' || entry.streaming) return null
  if (!isTurnEnded(entries, index, busy)) return null
  const resolved =
    entry.resultChip !== undefined
      ? entry.resultChip
      : fallbackInput
        ? resultChip({
            ...fallbackInput,
            text: fallbackChipText(entry, fallbackInput),
          })
        : null
  return isEmptyResultChip(resolved) ? null : (resolved ?? null)
}

/**
 * Computes the localized label and optional stopped line for an assistant entry's
 * ResultChip, narrowing `chip.labelKey !== null` before invoking `translate`.
 */
export function getEntryResultChipView(
  entries: ReadonlyArray<UniworkPanelEntryLike>,
  index: number,
  busy: boolean,
  translate: UniworkTranslateFn,
  fallbackInput?: ResultChipInput | null,
): EntryResultChipView | null {
  const chip = resolveEntryResultChip(entries, index, busy, fallbackInput)
  if (!chip) return null
  const labelText = chip.labelKey !== null ? translate(chip.labelKey) : null
  const stoppedText = chip.stoppedKey !== null ? translate(chip.stoppedKey) : null
  if (labelText === null && stoppedText === null) return null
  return { chip, labelText, stoppedText }
}

const TERMINAL_PUNCTUATION_RE = /[.!?。！？]$/

function joinAnnouncementParts(parts: readonly string[]): string {
  const nonEmpty = parts.map((p) => p.trim()).filter((p) => p.length > 0)
  if (nonEmpty.length === 0) return ''
  return nonEmpty
    .map((part, idx) =>
      idx < nonEmpty.length - 1 && !TERMINAL_PUNCTUATION_RE.test(part) ? `${part}.` : part,
    )
    .join(' ')
}

/**
 * Computes the polite live-region announcement for an AI panel thread:
 * 1. Active `waitLine` / `status` (plus any streaming in-thread note) on the latest entry.
 * 2. Latest in-thread note while streaming when no wait line is set.
 * 3. On turn completion (`!streaming && !busy`), ONLY the ResultChip label, its error line and
 *    the stopped line, in that order (RF2-9) — never the full assistant answer body (RF1-19).
 */
export function panelLiveAnnouncement(input: PanelLiveAnnouncementInput): string {
  const { entries, busy, translate, lastEntryChipInput } = input
  if (entries.length === 0) return ''
  const lastEntry = entries[entries.length - 1]
  if (!lastEntry || lastEntry.role !== 'assistant') return ''
  const waitOrStatus = lastEntry.waitLine || lastEntry.status
  const latestNote =
    lastEntry.notes && lastEntry.notes.length > 0
      ? lastEntry.notes[lastEntry.notes.length - 1]!.text
      : ''
  if (waitOrStatus) {
    return latestNote ? `${waitOrStatus} ${latestNote}` : waitOrStatus
  }
  if (latestNote && lastEntry.streaming) {
    return latestNote
  }
  if (!lastEntry.streaming && !busy) {
    const rawChip =
      lastEntry.resultChip !== undefined
        ? lastEntry.resultChip
        : lastEntryChipInput
          ? resultChip({
              ...lastEntryChipInput,
              text: fallbackChipText(lastEntry, lastEntryChipInput),
            })
          : null
    if (!rawChip || isEmptyResultChip(rawChip)) return ''
    // label, then the error line, then the stopped line: what the visible turn shows, never the body
    const parts: string[] = []
    if (rawChip.labelKey !== null) parts.push(translate(rawChip.labelKey))
    // the dropped-call reason is the visible line of an "unsupported" chip (S9 table)
    if (rawChip.reasonKey) parts.push(translate(rawChip.reasonKey, rawChip.reasonParams))
    if (rawChip.errorLine?.key)
      parts.push(translate(rawChip.errorLine.key, rawChip.errorLine.params))
    if (rawChip.stoppedKey !== null) parts.push(translate(rawChip.stoppedKey))
    return joinAnnouncementParts(parts)
  }
  return ''
}

/**
 * The visible error line of a turn. An `error` chip already reads "Lỗi" / "Error", so its line is
 * the bare message; under any other chip (an edited turn that then failed) or none, `withPrefix`
 * adds the panel's own "Error: …" wording.
 */
export function uniworkErrorLineText(
  chip: ResultChipOutput | null | undefined,
  errorText: string,
  withPrefix: (errorText: string) => string,
): string {
  return chip?.chip === 'error' ? errorText : withPrefix(errorText)
}

function isMacPlatform(): boolean {
  const g = globalThis as { navigator?: { platform?: string } }
  return /mac/i.test(g.navigator?.platform ?? '')
}

/**
 * One shortcut instead of the dictionary's "Ctrl/⌘+Z" pair. The i18n layer rewrites "⌘" to "Ctrl"
 * off the Mac, which leaves "Ctrl/Ctrl+Z" (and "Strg/Ctrl+Z"): keep the first, locale-named key.
 * On a Mac the text is untouched by i18n, so the pair becomes "⌘Z".
 */
export function singleShortcutHint(text: string, isMac: boolean = isMacPlatform()): string {
  return text.replace(/\p{L}+\/(?:⌘|\p{L}+)\+([A-Za-z0-9])/gu, (match, key: string) => {
    const left = match.slice(0, match.indexOf('/'))
    return isMac ? `⌘${key}` : `${left}+${key}`
  })
}
