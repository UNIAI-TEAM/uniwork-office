/**
 * Pure helpers for the `@` mention trigger in the composer (S14): where a
 * trigger starts, what the query is, and how a picked person replaces it.
 * The picker itself lives in MentionPicker.tsx; nothing here touches the DOM.
 */

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
