import type { UniworkDocTypePick } from '../../shared/home-api'

/**
 * UNI-2113: the Documents home Type multi-select's vocabulary, in the menu's order (UniNote, then
 * the file formats). The server's `?type=` takes exactly these eight values, as written.
 */
export const DOC_TYPE_PICKS: readonly UniworkDocTypePick[] = [
  'page',
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'md',
  'html',
  'txt',
]

/**
 * The boundary of the Type picks (IPC in, wire out): only vocabulary values stay (an unknown,
 * empty or differently cased one is a 400 `invalid_type` on the server), each once, in menu order
 * and at most the vocabulary's size. Anything that is not an array is no pick at all.
 */
export function normalizeTypePicks(value: unknown): UniworkDocTypePick[] {
  if (!Array.isArray(value)) return []
  return DOC_TYPE_PICKS.filter((pick) => value.includes(pick))
}
