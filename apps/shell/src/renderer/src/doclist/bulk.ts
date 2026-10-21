// Bulk actions of the Documents list. The server has no many-id endpoint, so one batch is a
// client fan-out over the single-document calls (shared list rules): at most 4 at once, one
// retry when the server throttles, a failure never stops the batch, and the list is read again
// once at the end (not after every call).
import type { StringKey, TFunc } from '../locale'
import { UNIWORK_ERROR_KEYS } from '../uniwork-docs-model'
import type { UniworkDocErrorCode } from '../../../shared/home-api'
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import {
  archiveDocument,
  restoreDocument,
  shelveDocument,
  trashShelvedDocument,
  unshelveDocument,
} from '../uniwork-library-api'
import type { DocListScreen } from './columns'
import { buildRowMenu, type RowMenuActionId } from './row-menu'

export const BULK_CONCURRENCY = 4
/** pause before the single retry of a throttled call */
const RETRY_DELAY_MS = 1000

/** the row-menu actions a batch can run on many rows (Move takes one row in the app) */
export type BulkActionId = Extract<RowMenuActionId, 'restore' | 'unshelve' | 'shelve' | 'trash'>

// Rules board §3 order: the keep actions first, the delete entry last
const BULK_ORDER: readonly BulkActionId[] = ['restore', 'unshelve', 'shelve', 'trash']

export type BulkWorkResult = { ok: true } | { ok: false; error: string }

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
 * main maps the server's 429 (and 503) to server_error (uniwork-docs/errors.ts); a
 * rate_limited code is accepted too, should the bridge ever carry it
 */
function isThrottled(error: string): boolean {
  return error === 'rate_limited' || error === 'server_error'
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
      if (!outcome.ok && isThrottled(outcome.error)) {
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
 * The actions of the bulk bar: the ids the row menu offers for every selected row (so the
 * permissions are the menu's, never a second copy of them).
 */
export function bulkActionsFor(
  screen: DocListScreen,
  docs: readonly DocumentsHomeDoc[],
): BulkActionId[] {
  if (docs.length === 0) return []
  const stub = () => {}
  const run: Partial<Record<RowMenuActionId, () => void>> = {}
  for (const id of BULK_ORDER) run[id] = stub
  return BULK_ORDER.filter((id) =>
    docs.every((doc) =>
      buildRowMenu({ screen, doc, run, offlineLabel: null, label: (key) => key }).some(
        (item) => item.id === id,
      ),
    ),
  )
}

/** the single-document call one batch item runs: the same calls the row menu uses */
export function bulkWorkFor(
  action: BulkActionId,
  screen: DocListScreen,
): (doc: DocumentsHomeDoc) => Promise<BulkWorkResult> {
  const call = (id: string) => {
    switch (action) {
      case 'shelve':
        return shelveDocument(id)
      case 'unshelve':
        return unshelveDocument(id)
      case 'restore':
        return restoreDocument(id)
      case 'trash':
        // a shelved row has its own trash call; every other screen archives
        return screen === 'shelved' ? trashShelvedDocument(id) : archiveDocument(id)
    }
  }
  return async (doc) => {
    const res = await call(doc.id)
    return res.ok ? { ok: true } : { ok: false, error: res.error }
  }
}

const DONE_KEYS: Record<BulkActionId, StringKey> = {
  shelve: 'dlBulkDoneShelve',
  unshelve: 'dlBulkDoneUnshelve',
  restore: 'dlBulkDoneRestore',
  trash: 'dlBulkDoneTrash',
}

/** the toast of a finished batch: "3/5" counts, plus the commonest reason when some failed */
export function bulkSummary(
  action: BulkActionId,
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
