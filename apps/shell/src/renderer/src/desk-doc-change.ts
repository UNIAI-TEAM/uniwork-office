import type { WorkNotification } from '../../shared/uniwork-work-api'
import type { StringKey } from './locale'

/** The verbs the server folds into one `document_changed` row (the web words the same ten). */
const VERBS = [
  'renamed',
  'moved',
  'trashed',
  'restored',
  'deleted',
  'shelved',
  'unshelved',
  'access_changed',
  'version_created',
  'relocated',
] as const
type DocumentChangedVerb = (typeof VERBS)[number]

const VERB_SET: ReadonlySet<string> = new Set(VERBS)

export interface DocumentChangedFacts {
  /** null for a verb this client does not word (a newer server) */
  verb: DocumentChangedVerb | null
  count: number
  titles: string[]
  /** documents beyond the titles shown; 0 when every one is named */
  more: number
}

const isDocumentChanged = (n: WorkNotification) => n.kind === 'document_changed'

/** titles of the sample documents the reader can read now, in order; a blank title is skipped */
function sampleTitles(n: WorkNotification): string[] {
  return (n.sample_documents ?? []).map((d) => d.title.trim()).filter((t) => t !== '')
}

/**
 * How many distinct documents the row covers: `params.document_count`, then the row's `count`
 * (the server sets both to the distinct count), then the titles in hand, and one at the least.
 */
function documentCount(n: WorkNotification, titles: readonly string[]): number {
  const fromParam = Number.parseInt(n.params.document_count ?? '', 10)
  if (Number.isFinite(fromParam) && fromParam > 0) return fromParam
  if (typeof n.count === 'number' && Number.isFinite(n.count) && n.count > 0) return n.count
  return Math.max(1, titles.length)
}

export function documentChangedFacts(n: WorkNotification): DocumentChangedFacts {
  const titles = sampleTitles(n)
  const count = documentCount(n, titles)
  const verb = n.params.verb ?? ''
  return {
    verb: VERB_SET.has(verb) ? (verb as DocumentChangedVerb) : null,
    count,
    titles,
    more: Math.max(0, count - titles.length),
  }
}

/**
 * One document that was deleted or moved to the trash has no page to open (the trash view is
 * manage-only, most recipients are not managers); several documents always open the list.
 */
export function documentChangedHasPage(n: WorkNotification): boolean {
  const { verb, count } = documentChangedFacts(n)
  if (count > 1) return true
  return !(verb === 'deleted' || verb === 'trashed' || n.resource_deleted)
}

/** several documents: a click opens the list of them instead of a page */
export function opensDocumentList(n: WorkNotification): boolean {
  return isDocumentChanged(n) && documentChangedFacts(n).count > 1 && documentChangedHasPage(n)
}

/**
 * The sentence key of the row: one per verb and shape (several, one named, one unnamed). A verb this
 * client does not word reads the generic "changed N documents"; ids never reach the sentence.
 */
export function documentChangedSentenceKey(n: WorkNotification): StringKey {
  const { verb, count, titles } = documentChangedFacts(n)
  const shape = count > 1 ? 'many' : titles.length > 0 ? 'one' : 'untitled'
  if (verb === null && shape === 'many') return 'wbNotif_document_changed'
  return `wbNotif_document_changed_${verb ?? 'generic'}_${shape}` as StringKey
}

/** the params the sentence places: who, the one document's name, how many */
export function documentChangedTitleParams(n: WorkNotification): Record<string, string> {
  const { count, titles } = documentChangedFacts(n)
  return {
    actor: n.params.actor ?? '',
    document: titles[0] ?? '',
    count: String(count),
    document_count: String(count),
  }
}

/** what a click on a document notice can do: open it, or only say it is gone / out of reach */
export function noticeState(n: WorkNotification): 'open' | 'deleted' | 'no_access' {
  if (n.resource_deleted) return 'deleted'
  if (n.resource_access_lost) return 'no_access'
  return 'open'
}
