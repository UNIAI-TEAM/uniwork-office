/**
 * Pure helpers for the `@` mention trigger in the composer (S14): where a
 * trigger starts, what the query is, and how a picked person replaces it.
 * The picker itself lives in MentionPicker.tsx; nothing here touches the DOM.
 */
import { parseBody } from './body'

/** wait after the last key before asking the server (spine S14) */
export const MENTION_DEBOUNCE_MS = 150
/** the picker never lists more rows than this (spine S14, mention-candidates) */
export const MENTION_MAX_ROWS = 20
/** a longer run is prose, not a name being searched */
const MAX_QUERY_LENGTH = 64

export interface MentionTrigger {
  /** index of the `@` */
  start: number
  /** text between the `@` and the caret */
  query: string
}

/**
 * The open trigger at `caret`, or null. An `@` counts only at a word start
 * (start of text or after whitespace), so an email address, or the `@` inside
 * an already built token `[@Name](mention://...)`, never opens the picker.
 * The query ends at the caret and may not contain whitespace.
 */
export function findMentionTrigger(text: string, caret: number): MentionTrigger | null {
  if (caret < 1 || caret > text.length) return null
  let runStart = caret
  while (runStart > 0 && !/\s/.test(text.charAt(runStart - 1))) runStart--
  if (text.charAt(runStart) !== '@') return null
  const query = text.slice(runStart + 1, caret)
  if (query.includes('@') || query.length > MAX_QUERY_LENGTH) return null
  return { start: runStart, query }
}

/** Replace `@query` (trigger.start..caret) with the token and one space; the caret lands after the space. */
export function insertMention(
  text: string,
  trigger: MentionTrigger,
  caret: number,
  token: string,
): { text: string; caret: number } {
  const inserted = `${token} `
  return {
    text: text.slice(0, trigger.start) + inserted + text.slice(caret),
    caret: trigger.start + inserted.length,
  }
}

/**
 * A picked or pasted mention as the composer holds it: the textarea shows `@label`, the range
 * says which characters are that mention, and `raw` is the token the stored body carries.
 */
export interface MentionRange {
  /** index of the `@` in the displayed text */
  start: number
  /** end of `@label` in the displayed text (exclusive) */
  end: number
  id: string
  label: string
  /** `[@label](mention://member/<id>)` exactly as it goes into the body */
  raw: string
  /** G8-18: false when picked from the picker with `can_view: false`; undefined when typed or pasted */
  canView?: boolean
}

export interface MentionDoc {
  /** what the textarea shows */
  text: string
  /** sorted, non-overlapping */
  ranges: MentionRange[]
}

const displayOf = (label: string) => `@${label}`

/** G8-18: full conjunction list of names in the UI locale (never truncated). */
export function formatMentionNames(names: readonly string[], lang: string): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  try {
    return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(names)
  } catch {
    return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names)
  }
}

/**
 * G8-18: whether this caller may offer "Share view access": the source can send it (the web frame
 * defines `shareView` only with the effective `commentsShareView` capability) and the host did not
 * switch the capability off. A per-person `can_share` is only ever read from a post-send result.
 */
export function canShareView(
  host: { capabilities?: { commentsShareView?: boolean }; commentsShareView?: boolean },
  source: { shareView?: unknown },
): boolean {
  const flag = host.capabilities?.commentsShareView ?? host.commentsShareView
  return typeof source.shareView === 'function' && flag !== false
}

/** The displayed form of a stored body: top-level mention tokens become `@Name` + a range. */
export function mentionDocFromBody(body: string): MentionDoc {
  if (!body.includes('mention://member/')) return { text: body, ranges: [] }
  let text = ''
  const ranges: MentionRange[] = []
  for (const token of parseBody(body)) {
    if (token.type === 'mention') {
      const shown = displayOf(token.label)
      ranges.push({
        start: text.length,
        end: text.length + shown.length,
        id: token.userId,
        label: token.label,
        raw: token.raw,
      })
      text += shown
    } else {
      text += token.raw
    }
  }
  return { text, ranges }
}

/** The body to store or send: every range goes back to its token, the rest is verbatim. */
export function mentionDocToBody(doc: MentionDoc): string {
  let out = ''
  let at = 0
  for (const r of doc.ranges) {
    out += doc.text.slice(at, r.start) + r.raw
    at = r.end
  }
  return out + doc.text.slice(at)
}

/**
 * Carry the ranges across one replacement of `text[from, to)` by `inserted` characters:
 * a range wholly before it stays, one wholly after it shifts, one the edit touches is dropped
 * (its characters stay as plain text).
 */
function shiftRanges(
  ranges: MentionRange[],
  from: number,
  to: number,
  inserted: number,
): MentionRange[] {
  const delta = inserted - (to - from)
  const out: MentionRange[] = []
  for (const r of ranges) {
    if (r.end <= from) out.push(r)
    else if (r.start >= to) out.push({ ...r, start: r.start + delta, end: r.end + delta })
  }
  return out
}

/**
 * The edit region a caret pins down, when `next` is `prev` with one run of characters inserted
 * (the caret sits after it) or removed (the caret sits where it was); `null` when the caret
 * and the two texts do not agree on such an edit.
 */
function anchoredEdit(
  prev: string,
  next: string,
  caret: number,
): { from: number; delEnd: number; insEnd: number } | null {
  const delta = next.length - prev.length
  if (delta > 0) {
    const from = caret - delta
    if (from < 0 || caret > next.length) return null
    if (prev.slice(0, from) !== next.slice(0, from) || prev.slice(from) !== next.slice(caret)) {
      return null
    }
    return { from, delEnd: from, insEnd: caret }
  }
  if (delta < 0) {
    const delEnd = caret - delta
    if (caret < 0 || delEnd > prev.length) return null
    if (prev.slice(0, caret) !== next.slice(0, caret) || prev.slice(delEnd) !== next.slice(caret)) {
      return null
    }
    return { from: caret, delEnd, insEnd: caret }
  }
  return null
}

/**
 * The doc after the user changed the textarea from `prev.text` to `next`. The edit is the
 * region between the common prefix and suffix; ranges follow as in `shiftRanges`, and pasted
 * text that holds mention tokens is converted to `@Name` + ranges. `mapCaret` translates a
 * caret of `next` into the displayed text when a conversion changed its length.
 *
 * The prefix/suffix split is ambiguous when the inserted or removed text equals the characters
 * it slides over (an `@` typed right before an `@Name` chip). The caret of the change event
 * (`caret`, the textarea's `selectionStart` after the edit) then anchors a pure insertion or
 * deletion; a caret that does not describe the change is ignored.
 */
export function applyMentionEdit(
  prev: MentionDoc,
  next: string,
  caret?: number,
): { doc: MentionDoc; mapCaret(caret: number): number } {
  const same = (caret: number) => caret
  let p = 0
  const max = Math.min(prev.text.length, next.length)
  while (p < max && prev.text.charCodeAt(p) === next.charCodeAt(p)) p++
  let s = 0
  while (
    s < max - p &&
    prev.text.charCodeAt(prev.text.length - 1 - s) === next.charCodeAt(next.length - 1 - s)
  ) {
    s++
  }
  let from = p
  let delEnd = prev.text.length - s
  let insEnd = next.length - s
  const anchor = caret === undefined ? null : anchoredEdit(prev.text, next, caret)
  if (anchor) {
    from = anchor.from
    delEnd = anchor.delEnd
    insEnd = anchor.insEnd
  }
  // a range whose characters no longer read `@label` is stale (never trust it)
  const live = prev.ranges.filter((r) => prev.text.slice(r.start, r.end) === displayOf(r.label))
  const ins = next.slice(from, insEnd)
  const conv = mentionDocFromBody(ins)
  const kept = shiftRanges(live, from, delEnd, conv.text.length)
  const added = conv.ranges.map((r) => ({ ...r, start: r.start + from, end: r.end + from }))
  const ranges = [...kept, ...added].sort((a, b) => a.start - b.start)
  const text = next.slice(0, from) + conv.text + next.slice(insEnd)
  if (conv.text.length === ins.length) return { doc: { text, ranges }, mapCaret: same }
  const diff = conv.text.length - ins.length
  return {
    doc: { text, ranges },
    mapCaret: (caret) =>
      caret >= insEnd ? caret + diff : caret > from ? from + conv.text.length : caret,
  }
}

/** A person picked for `trigger` (`@query` up to `caret`): `@Name` + one space, a new range, caret after the space. */
export function pickMention(
  doc: MentionDoc,
  trigger: MentionTrigger,
  caret: number,
  who: { id: string; label: string; raw: string; canView?: boolean },
): { doc: MentionDoc; caret: number } {
  const shown = displayOf(who.label)
  const out = insertMention(doc.text, trigger, caret, shown)
  const kept = shiftRanges(doc.ranges, trigger.start, caret, shown.length + 1)
  const range: MentionRange = {
    start: trigger.start,
    end: trigger.start + shown.length,
    id: who.id,
    label: who.label,
    raw: who.raw,
    ...(who.canView !== undefined ? { canView: who.canView } : {}),
  }
  return {
    doc: { text: out.text, ranges: [...kept, range].sort((a, b) => a.start - b.start) },
    caret: out.caret,
  }
}

interface UniqueLabelEntry {
  userId: string
  label: string
  email?: string
}

const labelKey = (label: string) =>
  label
    .replace(/[\]\n\r]/g, ' ')
    .trim()
    .toLowerCase()

/** Append ` (suffix)` to every label two or more entries share (labels compare case-insensitively). */
function suffixSharedLabels(
  entries: UniqueLabelEntry[],
  suffix: (e: UniqueLabelEntry) => string,
): void {
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(labelKey(e.label), (counts.get(labelKey(e.label)) ?? 0) + 1)
  for (const e of entries) {
    if ((counts.get(labelKey(e.label)) ?? 0) > 1) e.label = `${e.label} (${suffix(e)})`
  }
}

/**
 * The label a picked person gets (web `withUniqueLabel`, 302a45d4f on `chat-mention-utils`):
 * when someone else already in the doc goes by the same name, the label gains chat's
 * suffix — the email local part, then the user id when that still collides — so `@Name`
 * spells one person. The same person twice (same id) keeps the plain label.
 */
export function uniqueMentionLabel(
  candidate: { user_id: string; display_name: string; email?: string },
  doc: MentionDoc,
): string {
  const base = candidate.display_name || candidate.user_id
  const list: UniqueLabelEntry[] = [
    ...doc.ranges
      .filter((r) => r.id.toUpperCase() !== candidate.user_id.toUpperCase())
      .map((r) => ({ userId: r.id, label: r.label || r.id })),
    {
      userId: candidate.user_id,
      label: base,
      ...(candidate.email ? { email: candidate.email } : {}),
    },
  ]
  const suffix = (e: UniqueLabelEntry) => e.email?.split('@')[0]?.trim() || e.userId
  suffixSharedLabels(list, suffix)
  suffixSharedLabels(list, (e) => e.userId)
  return list[list.length - 1]!.label
}
