// Bulk actions of the Documents list. The server has no many-id endpoint, so one batch is a
// client fan-out over the single-document calls (shared list rules): at most 4 at once, one
// retry when the server throttles, a failure never stops the batch, and the list is read again
// once at the end (not after every call).
import type { StringKey, TFunc } from '../locale'
import { UNIWORK_ERROR_KEYS } from '../uniwork-docs-model'
import type { UniworkDocErrorCode } from '../../../shared/home-api'
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import {
  restoreDocument,
  shelveDocument,
  trashDocument,
  trashShelvedDocument,
  unshelveDocument,
} from '../uniwork-library-api'
import type { DocListScreen } from './columns'
import { buildRowMenu, type RowMenuActionId } from './row-menu'

export const BULK_CONCURRENCY = 4
/** pause before the single retry of a throttled call */
const RETRY_DELAY_MS = 1000

/** the row-menu actions a batch can run on many rows (Move takes one row in the app) */
export type BulkActionId = Extract<
  RowMenuActionId,
  'share' | 'restore' | 'unshelve' | 'download' | 'shelve' | 'trash'
>

/**
 * the ones that fan out over single-document calls here; Chia sẻ opens its own dialog and runs the
 * bridge's bulk, Tải xuống plans one file or one zip (uniwork-zip-download)
 */
export type BulkWorkActionId = Exclude<BulkActionId, 'share' | 'download'>

// Rules board §3 order: Chia sẻ first (the web's bar), the keep actions with Tải xuống before the
// archive entry (live: Share · Download · Archive · Trash; shelf: Unarchive · Download · Trash), the delete entry last
const BULK_ORDER: readonly BulkActionId[] = [
  'share',
  'restore',
  'unshelve',
  'download',
  'shelve',
  'trash',
]

/** `retryable`: main marked the failure a throttle (429 / 503); nothing else is worth a second call */
export type BulkWorkResult = { ok: true } | { ok: false; error: string; retryable?: boolean }

export interface BulkResult {
  total: number
  /** ids that went through, in input order */
  ok: string[]
  failed: Array<{ id: string; error: string }>
}

export interface BulkOptions {
  concurrency?: number
  /** the pause before the retry; tests pass a no-op */
  sleep?: (ms: number) => Promise<void>
}

/**
 * main maps the server's 429 (and 503) to server_error and marks it `retryable`
 * (uniwork-docs/service.ts); a rate_limited code is accepted too, should the bridge ever carry
 * it. Any other server_error may already have been applied: a second call would answer
 * conflict / not_found and count the item as failed although it went through.
 */
function isThrottled(outcome: { error: string; retryable?: boolean }): boolean {
  return outcome.error === 'rate_limited' || outcome.retryable === true
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function attempt<T>(
  item: T,
  work: (item: T) => Promise<BulkWorkResult>,
): Promise<BulkWorkResult> {
  try {
    return await work(item)
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** run `work` over `items`, at most `concurrency` at once; never rejects, never stops early */
export async function runBulk<T extends { id: string }>(
  items: readonly T[],
  work: (item: T) => Promise<BulkWorkResult>,
  options: BulkOptions = {},
): Promise<BulkResult> {
  const sleep = options.sleep ?? wait
  const outcomes: BulkWorkResult[] = new Array(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next++
      const item = items[index]!
      let outcome = await attempt(item, work)
      if (!outcome.ok && isThrottled(outcome)) {
        await sleep(RETRY_DELAY_MS)
        outcome = await attempt(item, work)
      }
      outcomes[index] = outcome
    }
  }
  const lanes = Math.min(options.concurrency ?? BULK_CONCURRENCY, items.length)
  await Promise.all(Array.from({ length: lanes }, lane))

  const result: BulkResult = { total: items.length, ok: [], failed: [] }
  items.forEach((item, index) => {
    const outcome = outcomes[index]!
    if (outcome.ok) result.ok.push(item.id)
    else result.failed.push({ id: item.id, error: outcome.error })
  })
  return result
}

/** one batch: fan out, then read the list again once whatever the outcome */
export async function runBulkAction<T extends { id: string }>(
  input: {
    docs: readonly T[]
    work: (item: T) => Promise<BulkWorkResult>
    refresh: () => void
  } & BulkOptions,
): Promise<BulkResult> {
  const { docs, work, refresh, ...options } = input
  const result = await runBulk(docs, work, options)
  refresh()
  return result
}

/**
 * Whether the Share dialog would let the viewer change this row's access: the row menu opens it
 * for any reader, but only a manager (or an administering admin) gets its write half, and a
 * shelved document gives access away only (the web's `canShareWrite`).
 */
function canShareWrite(doc: DocumentsHomeDoc): boolean {
  return (doc.myLevel === 'manage' || doc.adminScope === true) && !doc.shelvedAt
}

/**
 * The actions of the bulk bar: the ids the row menu offers for every selected row (so the
 * permissions are the menu's, never a second copy of them). Chia sẻ also needs every row
 * manageable and the shell's Share bridge (`canShare`): never a dead button.
 * Tải xuống is the exception (the web's rule): it shows when at least ONE selected row is a file
 * (the rest are skipped and listed), and only with the zip bridge (`canDownload`).
 */
export function bulkActionsFor(
  screen: DocListScreen,
  docs: readonly DocumentsHomeDoc[],
  canShare = false,
  canDownload = false,
): BulkActionId[] {
  if (docs.length === 0) return []
  const stub = () => {}
  const run: Partial<Record<RowMenuActionId, () => void>> = {}
  for (const id of BULK_ORDER) run[id] = stub
  const offers = (doc: DocumentsHomeDoc, id: BulkActionId) =>
    buildRowMenu({ screen, doc, run, offlineLabel: null, label: (key) => key }).some(
      (item) => item.id === id,
    )
  return BULK_ORDER.filter((id) => {
    if (id === 'download') return canDownload && docs.some((doc) => offers(doc, id))
    return (
      (id !== 'share' || canShare) &&
      docs.every((doc) => (id !== 'share' || canShareWrite(doc)) && offers(doc, id))
    )
  })
}

/** the single-document call one batch item runs: the same calls the row menu uses */
export function bulkWorkFor(
  action: BulkWorkActionId,
  screen: DocListScreen,
): (doc: DocumentsHomeDoc) => Promise<BulkWorkResult> {
  const call = (doc: DocumentsHomeDoc) => {
    switch (action) {
      case 'shelve':
        return shelveDocument(doc.id)
      case 'unshelve':
        return unshelveDocument(doc.id)
      case 'restore':
        return restoreDocument(doc.id)
      case 'trash':
        // a shelved row has its own trash call; every other screen archives (a folder or a page
        // through the kind-agnostic call, since the archive call is file-only)
        return screen === 'shelved' ? trashShelvedDocument(doc.id) : trashDocument(doc)
    }
  }
  return async (doc) => {
    const res = await call(doc)
    return res.ok
      ? { ok: true }
      : { ok: false, error: res.error, ...(res.retryable ? { retryable: true } : {}) }
  }
}

const DONE_KEYS: Record<BulkWorkActionId, StringKey> = {
  shelve: 'dlBulkDoneShelve',
  unshelve: 'dlBulkDoneUnshelve',
  restore: 'dlBulkDoneRestore',
  trash: 'dlBulkDoneTrash',
}

/** the toast of a finished batch: "3/5" counts, plus the commonest reason when some failed */
export function bulkSummary(
  action: BulkWorkActionId,
  result: BulkResult,
  t: TFunc,
): { message: string; tone: 'ok' | 'error' } {
  const done = t(DONE_KEYS[action], { ok: result.ok.length, total: result.total })
  if (result.failed.length === 0) return { message: done, tone: 'ok' }
  const counts = new Map<string, number>()
  for (const { error } of result.failed) counts.set(error, (counts.get(error) ?? 0) + 1)
  const [reason] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!
  const key = UNIWORK_ERROR_KEYS[reason as UniworkDocErrorCode] ?? 'uwDocActionFailed'
  return { message: `${done}. ${t(key)}`, tone: 'error' }
}
