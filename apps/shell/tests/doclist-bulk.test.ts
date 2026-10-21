import { describe, expect, it, vi } from 'vitest'
import {
  BULK_CONCURRENCY,
  bulkActionsFor,
  runBulk,
  runBulkAction,
  type BulkWorkResult,
} from '../src/renderer/src/doclist/bulk'
import { pruneSelection, selectedDocsOf } from '../src/renderer/src/doclist/selection'
import type { DocListScreen } from '../src/renderer/src/doclist/columns'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

const doc = (id: string, partial: Partial<DocumentsHomeDoc> = {}): DocumentsHomeDoc => ({
  id,
  workspaceId: 'ws-1',
  title: `${id}.docx`,
  format: 'docx',
  updatedAt: '2026-10-21T02:00:00.000Z',
  kind: 'file',
  parentId: null,
  canEdit: true,
  canManage: true,
  ...partial,
})
const docs = (n: number) => Array.from({ length: n }, (_, i) => doc(`d${i + 1}`))
const noSleep = async () => {}
const OK: BulkWorkResult = { ok: true }

/** a worker the test settles by hand, to watch how many run at once */
function gate() {
  let running = 0
  let peak = 0
  const waiting: Array<() => void> = []
  const work = (): Promise<BulkWorkResult> => {
    running++
    peak = Math.max(peak, running)
    return new Promise((resolve) => {
      waiting.push(() => {
        running--
        resolve(OK)
      })
    })
  }
  return {
    work,
    peak: () => peak,
    waiting: () => waiting.length,
    releaseOne: () => waiting.shift()?.(),
  }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('runBulk: fan-out of one batch (UNI-2047 A5)', () => {
  it('never runs more than 4 at once and still finishes every item', async () => {
    expect(BULK_CONCURRENCY).toBe(4)
    const g = gate()
    const done = runBulk(docs(10), g.work, { sleep: noSleep })
    await tick()
    expect(g.waiting()).toBe(4)
    // each finished call lets exactly one more start
    for (let i = 0; i < 10; i++) {
      g.releaseOne()
      await tick()
    }
    const result = await done
    expect(g.peak()).toBe(4)
    expect(result.total).toBe(10)
    expect(result.ok).toHaveLength(10)
  })

  it('retries once when the server throttles (rate_limited, or a server_error main marked retryable)', async () => {
    for (const first of [
      { ok: false, error: 'rate_limited' },
      { ok: false, error: 'server_error', retryable: true },
    ] as const) {
      const calls: Record<string, number> = {}
      const work = vi.fn(async (d: DocumentsHomeDoc): Promise<BulkWorkResult> => {
        calls[d.id] = (calls[d.id] ?? 0) + 1
        return calls[d.id] === 1 ? first : OK
      })
      const sleep = vi.fn(noSleep)
      const result = await runBulk(docs(3), work, { sleep })
      expect(work).toHaveBeenCalledTimes(6)
      expect(sleep).toHaveBeenCalledTimes(3)
      expect(result.ok).toEqual(['d1', 'd2', 'd3'])
      expect(result.failed).toEqual([])
    }
  })

  it('gives up after the one retry: a still-throttled item is a failure, not a loop', async () => {
    const work = vi.fn(async (): Promise<BulkWorkResult> => ({ ok: false, error: 'rate_limited' }))
    const result = await runBulk([doc('d1')], work, { sleep: noSleep })
    expect(work).toHaveBeenCalledTimes(2)
    expect(result.failed).toEqual([{ id: 'd1', error: 'rate_limited' }])
  })

  // A-FIX4 m4: a 500 after the server applied the change would answer conflict / not_found on the
  // second call, so the item would count as failed although it went through
  it('does not retry a server_error that is not a throttle, and a throttle is still one failure after the retry', async () => {
    const plain = vi.fn(async (): Promise<BulkWorkResult> => ({ ok: false, error: 'server_error' }))
    const result = await runBulk([doc('d1')], plain, { sleep: noSleep })
    expect(plain).toHaveBeenCalledTimes(1)
    expect(result.failed).toEqual([{ id: 'd1', error: 'server_error' }])

    const throttled = vi.fn(async (): Promise<BulkWorkResult> => ({
      ok: false,
      error: 'server_error',
      retryable: true,
    }))
    const again = await runBulk([doc('d1')], throttled, { sleep: noSleep })
    expect(throttled).toHaveBeenCalledTimes(2)
    expect(again.failed).toEqual([{ id: 'd1', error: 'server_error' }])
  })

  it('does not retry a refusal (forbidden, not_found, conflict)', async () => {
    for (const error of ['forbidden', 'not_found', 'conflict', 'deleted']) {
      const work = vi.fn(async (): Promise<BulkWorkResult> => ({ ok: false, error }))
      await runBulk([doc('d1')], work, { sleep: noSleep })
      expect(work).toHaveBeenCalledTimes(1)
    }
  })

  it('does not stop on a failure: the other items still run and a throw counts as a failure', async () => {
    const work = vi.fn(async (d: DocumentsHomeDoc): Promise<BulkWorkResult> => {
      if (d.id === 'd2') return { ok: false, error: 'forbidden' }
      if (d.id === 'd4') throw new Error('boom')
      return OK
    })
    const result = await runBulk(docs(5), work, { sleep: noSleep })
    expect(work).toHaveBeenCalledTimes(5)
    expect(result.total).toBe(5)
    expect(result.ok).toEqual(['d1', 'd3', 'd5'])
    expect(result.failed).toEqual([
      { id: 'd2', error: 'forbidden' },
      { id: 'd4', error: 'network' },
    ])
  })

  it('counts a mixed batch right (3 of 5) and keeps the order of the input', async () => {
    const work = async (d: DocumentsHomeDoc): Promise<BulkWorkResult> =>
      d.id === 'd1' || d.id === 'd5' ? { ok: false, error: 'conflict' } : OK
    const result = await runBulk(docs(5), work, { sleep: noSleep })
    expect(result.ok).toHaveLength(3)
    expect(result.failed.map((f) => f.id)).toEqual(['d1', 'd5'])
    expect(result.ok.length + result.failed.length).toBe(result.total)
  })

  it('an empty batch does nothing', async () => {
    const work = vi.fn(async () => OK)
    expect(await runBulk([], work, { sleep: noSleep })).toEqual({ total: 0, ok: [], failed: [] })
    expect(work).not.toHaveBeenCalled()
  })
})

describe('runBulkAction: one refresh at the end (UNI-2047 A5)', () => {
  it('refreshes the list once, after the last item settled', async () => {
    const order: string[] = []
    const work = async (d: DocumentsHomeDoc): Promise<BulkWorkResult> => {
      await tick()
      order.push(`done:${d.id}`)
      return d.id === 'd3' ? { ok: false, error: 'forbidden' } : OK
    }
    const refresh = vi.fn(() => order.push('refresh'))
    const result = await runBulkAction({ docs: docs(6), work, refresh, sleep: noSleep })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(order[order.length - 1]).toBe('refresh')
    expect(order.filter((o) => o.startsWith('done:'))).toHaveLength(6)
    expect(result.ok).toHaveLength(5)
  })

  it('refreshes once even when every item failed', async () => {
    const refresh = vi.fn()
    await runBulkAction({
      docs: docs(2),
      work: async () => ({ ok: false, error: 'forbidden' }),
      refresh,
      sleep: noSleep,
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('bulkActionsFor: Tải xuống takes the any-row rule (UNI-2068 ZB)', () => {
  const viewer = (id: string, partial: Partial<DocumentsHomeDoc> = {}) =>
    doc(id, { canManage: false, canEdit: false, ...partial })
  const folder = (id: string) => doc(id, { kind: 'folder' })
  const page = (id: string) => doc(id, { kind: 'page' })
  const shelved = (id: string) => doc(id, { shelvedAt: '2026-10-19T08:00:00.000Z' })

  it('is hidden without the zip bridge, whatever the rows', () => {
    expect(bulkActionsFor('workspace', [doc('a'), doc('b')])).not.toContain('download')
    expect(bulkActionsFor('workspace', [doc('a')], false, false)).not.toContain('download')
  })

  it('sits before Lưu trữ on the live list', () => {
    expect(bulkActionsFor('workspace', [doc('a'), doc('b')], false, true)).toEqual([
      'download',
      'shelve',
      'trash',
    ])
  })

  it('shows for a viewer too: reading is enough to download', () => {
    expect(bulkActionsFor('workspace', [viewer('v')], false, true)).toEqual(['download'])
  })

  it('one file among folders and pages is enough; the other actions still need every row', () => {
    const mixed = [doc('a'), folder('f'), page('p')]
    expect(bulkActionsFor('workspace', mixed, false, true)).toEqual(['download', 'trash'])
    // the rest of the rule is untouched: trash needs a manager on every row, download does not
    expect(
      bulkActionsFor('workspace', [doc('a'), viewer('v', { kind: 'file' })], false, true),
    ).toEqual(['download'])
  })

  it('a folder-only or page-only selection has no Download', () => {
    expect(bulkActionsFor('workspace', [folder('f')], false, true)).not.toContain('download')
    expect(bulkActionsFor('workspace', [folder('f'), page('p')], false, true)).not.toContain(
      'download',
    )
  })

  it('the shelf offers it between Bỏ lưu trữ and the trash', () => {
    expect(bulkActionsFor('shelved', [shelved('a'), shelved('b')], false, true)).toEqual([
      'unshelve',
      'download',
      'trash',
    ])
    expect(bulkActionsFor('shelved', [viewer('v', { shelvedAt: 'x' })], false, true)).toEqual([
      'download',
    ])
  })

  it('the trash screen and a trashed row have none', () => {
    const trashed = (id: string) => doc(id, { archived: true })
    expect(bulkActionsFor('trash', [trashed('a'), trashed('b')], false, true)).toEqual(['restore'])
    expect(bulkActionsFor('workspace', [trashed('a')], false, true)).not.toContain('download')
  })
})

describe('bulkActionsFor: the actions every selected row has (UNI-2047 A5)', () => {
  const MANAGER = (id: string) => doc(id)
  const live: DocListScreen[] = ['workspace', 'recent', 'shared', 'shared-by-me']

  it.each(live)('%s: managers of every row get Lưu trữ + Chuyển vào thùng rác', (screen) => {
    expect(bulkActionsFor(screen, [MANAGER('a'), MANAGER('b')])).toEqual(['shelve', 'trash'])
  })

  it('one row without the right takes the action away from the whole batch', () => {
    const viewer = doc('v', { canManage: false, canEdit: false })
    expect(bulkActionsFor('workspace', [MANAGER('a'), viewer])).toEqual([])
    expect(bulkActionsFor('workspace', [viewer])).toEqual([])
  })

  it('a folder cannot be shelved, so a batch with a folder keeps only the trash', () => {
    expect(bulkActionsFor('workspace', [MANAGER('a'), doc('f', { kind: 'folder' })])).toEqual([
      'trash',
    ])
  })

  it('a shelved search hit cannot be shelved again', () => {
    const hit = doc('h', { shelvedAt: '2026-10-19T08:00:00.000Z' })
    expect(bulkActionsFor('workspace', [MANAGER('a'), hit])).toEqual(['trash'])
  })

  it('shelved: Bỏ lưu trữ + Chuyển vào thùng rác for rows the person manages', () => {
    const shelved = (id: string) => doc(id, { shelvedAt: '2026-10-19T08:00:00.000Z' })
    expect(bulkActionsFor('shelved', [shelved('a'), shelved('b')])).toEqual(['unshelve', 'trash'])
    expect(
      bulkActionsFor('shelved', [shelved('a'), { ...shelved('b'), canManage: false }]),
    ).toEqual([])
  })

  it('trash: only Khôi phục, and only for rows the person manages', () => {
    const trashed = (id: string, canManage = true) =>
      doc(id, { archived: true, canManage, archivedAt: '2026-10-19T08:00:00.000Z' })
    expect(bulkActionsFor('trash', [trashed('a'), trashed('b')])).toEqual(['restore'])
    expect(bulkActionsFor('trash', [trashed('a'), trashed('b', false)])).toEqual([])
  })

  it('no rows, no actions', () => {
    expect(bulkActionsFor('workspace', [])).toEqual([])
  })
})

describe('selection helpers (UNI-2047 A5)', () => {
  const items = docs(4)

  it('selectedDocsOf keeps the list order and ignores ids that are not loaded', () => {
    expect(selectedDocsOf(items, new Set(['d3', 'ghost', 'd1'])).map((d) => d.id)).toEqual([
      'd1',
      'd3',
    ])
    expect(selectedDocsOf(items, new Set())).toEqual([])
  })

  it('pruneSelection drops rows that left the list and keeps the same set when nothing changed', () => {
    const same = new Set(['d1', 'd2'])
    expect(pruneSelection(same, items)).toBe(same)
    const pruned = pruneSelection(new Set(['d1', 'gone']), items)
    expect([...pruned]).toEqual(['d1'])
  })
})
