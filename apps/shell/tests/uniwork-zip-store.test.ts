import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cancelZipRun,
  closeZipRun,
  isZipDownloadBusy,
  resetZipDownloadStore,
  runZipDownload,
  zipRuns,
} from '../src/renderer/src/uniwork-zip-download/zip-download-store'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import { fakeZipBridge, type FakeZipBridge } from './uniwork-zip-fake-bridge'

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
const files = (n: number) => Array.from({ length: n }, (_, i) => doc(`f${i + 1}`))
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let bridge: FakeZipBridge
const run = (docs: DocumentsHomeDoc[], screen: 'workspace' | 'shelved' = 'workspace') =>
  runZipDownload({ bridge, workspaceId: 'ws-1', screen, docs })

beforeEach(() => {
  bridge = fakeZipBridge()
})
afterEach(() => resetZipDownloadStore())

describe('runZipDownload: one file is a plain download (D4)', () => {
  it('asks the bridge for the file under its own name, no zip job', async () => {
    expect(await run([doc('a')])).toBe(true)
    expect(bridge.starts).toEqual([])
    expect(bridge.files).toEqual([
      { workspaceId: 'ws-1', documentId: 'a', suggestedName: 'a.docx' },
    ])
    const [r] = zipRuns()
    expect(r).toMatchObject({ kind: 'file', phase: 'done', ok: 1, total: 1, path: '/tmp/a.docx' })
    expect(isZipDownloadBusy()).toBe(false)
  })

  it('a cancelled save dialog leaves no run and no trace', async () => {
    bridge.nextFile = { ok: false, path: null, code: 'dialog_canceled' }
    expect(await run([doc('a')])).toBe(false)
    expect(zipRuns()).toEqual([])
  })

  it('a failed download is one failed run naming the file and the reason', async () => {
    bridge.nextFile = { ok: false, path: null, code: 'too_large' }
    expect(await run([doc('a')])).toBe(true)
    expect(zipRuns()[0]).toMatchObject({
      kind: 'file',
      phase: 'failed',
      lines: [{ documentId: 'a', title: 'a.docx', reason: 'too_large' }],
    })
    bridge.nextFile = { ok: false, path: null, code: 'network' }
    await run([doc('b')])
    expect(zipRuns()[1]!.lines).toEqual([{ documentId: 'b', title: 'b.docx', reason: 'failed' }])
  })

  it('keeps the rows left out next to the file (a folder in the selection)', async () => {
    await run([doc('a'), doc('d', { kind: 'folder', title: 'Docs' })])
    expect(zipRuns()[0]).toMatchObject({
      phase: 'done',
      ok: 1,
      total: 2,
      lines: [{ documentId: 'd', title: 'Docs', reason: 'not_a_file' }],
    })
  })
})

describe('runZipDownload: many files are one zip job', () => {
  it('sends the ids of the first 100 files and lists the rest as zip_limit', async () => {
    await run(files(103))
    expect(bridge.starts).toHaveLength(1)
    expect(bridge.starts[0]!.workspaceId).toBe('ws-1')
    expect(bridge.starts[0]!.documentIds).toHaveLength(100)
    expect(bridge.starts[0]!.documentIds[99]).toBe('f100')
    const [r] = zipRuns()
    expect(r).toMatchObject({ kind: 'zip', total: 103 })
    expect(r!.lines.map((l) => l.reason)).toEqual(['zip_limit', 'zip_limit', 'zip_limit'])
  })

  it('never sends a page, a folder or another workspace row', async () => {
    await run([doc('a'), doc('b'), doc('p', { kind: 'page' }), doc('x', { workspaceId: 'ws-2' })])
    expect(bridge.starts[0]!.documentIds).toEqual(['a', 'b'])
    expect(zipRuns()[0]!.lines.map((l) => [l.documentId, l.reason])).toEqual([
      ['p', 'not_a_file'],
      ['x', 'other_workspace'],
    ])
  })

  it('a cancelled save dialog creates no run', async () => {
    bridge.nextStart = { ok: false, code: 'dialog_canceled' }
    expect(await run(files(2))).toBe(false)
    expect(zipRuns()).toEqual([])
  })

  it('a refused start is one failed run with the code', async () => {
    bridge.nextStart = { ok: false, code: 'zip_unavailable' }
    expect(await run(files(2))).toBe(true)
    expect(zipRuns()[0]).toMatchObject({ phase: 'failed', error: 'zip_unavailable' })
  })

  it('goes preparing → downloading bytes → done and counts what the server packed', async () => {
    await run([...files(4), doc('d', { kind: 'folder', title: 'Docs' })])
    const id = zipRuns()[0]!.id
    expect(zipRuns()[0]!.phase).toBe('building')
    bridge.push({ runId: id, phase: 'downloading', bytes: 512, totalBytes: 1024 })
    expect(zipRuns()[0]).toMatchObject({ phase: 'downloading', bytes: 512, totalBytes: 1024 })
    bridge.push({
      runId: id,
      phase: 'done',
      bytes: 1024,
      totalBytes: 1024,
      fileCount: 3,
      path: '/home/u/documents.zip',
      skipped: [{ documentId: 'f2', reason: 'not_found' }],
    })
    const r = zipRuns()[0]!
    expect(r).toMatchObject({ phase: 'done', ok: 3, total: 5, path: '/home/u/documents.zip' })
    // the title of a skipped row comes from the selection, folder first (planned), then the server's
    expect(r.lines).toEqual([
      { documentId: 'd', title: 'Docs', reason: 'not_a_file' },
      { documentId: 'f2', title: 'f2.docx', reason: 'not_found' },
    ])
  })

  it('ok falls back to sent − skipped when the server gives no file count', async () => {
    await run(files(4))
    const id = zipRuns()[0]!.id
    bridge.push({
      runId: id,
      phase: 'done',
      skipped: [{ documentId: 'f1', reason: 'too_large' }],
      path: '/x.zip',
    })
    expect(zipRuns()[0]!.ok).toBe(3)
  })

  it('an unknown skipped id still lists, untitled', async () => {
    await run(files(2))
    bridge.push({
      runId: zipRuns()[0]!.id,
      phase: 'done',
      fileCount: 2,
      skipped: [{ documentId: 'ghost', reason: 'not_found' }],
      path: '/x.zip',
    })
    expect(zipRuns()[0]!.lines).toEqual([{ documentId: 'ghost', title: '', reason: 'not_found' }])
  })

  it('progress that beats the start answer is not lost', async () => {
    let answer!: (r: { ok: true; runId: string }) => void
    bridge.nextStart = new Promise((resolve) => {
      answer = resolve
    })
    const pending = run(files(2))
    await tick()
    bridge.push({ runId: 'early', phase: 'downloading', bytes: 10, totalBytes: 100 })
    answer({ ok: true, runId: 'early' })
    await pending
    expect(zipRuns()[0]).toMatchObject({ phase: 'downloading', bytes: 10 })
  })

  it("a failed run carries main's error code", async () => {
    await run(files(2))
    bridge.push({
      runId: zipRuns()[0]!.id,
      phase: 'failed',
      error: { code: 'zip_busy', retryAfterSeconds: 30 },
    })
    expect(zipRuns()[0]).toMatchObject({ phase: 'failed', error: 'zip_busy' })
  })

  it('Cancel goes to the bridge for that run; the canceled push settles it', async () => {
    await run(files(2))
    const id = zipRuns()[0]!.id
    await cancelZipRun(id)
    expect(bridge.canceled).toEqual([id])
    bridge.push({ runId: id, phase: 'canceled' })
    expect(zipRuns()[0]!.phase).toBe('canceled')
    expect(isZipDownloadBusy()).toBe(false)
  })

  it('closing a settled run removes it; a running one stays', async () => {
    await run(files(2))
    const id = zipRuns()[0]!.id
    closeZipRun(id)
    expect(zipRuns()).toHaveLength(1)
    bridge.push({ runId: id, phase: 'done', fileCount: 2, path: '/x.zip' })
    closeZipRun(id)
    expect(zipRuns()).toEqual([])
  })
})

describe('busy', () => {
  it('is busy from the click (dialog open) until the run settles, and refuses a second one', async () => {
    let answer!: (r: { ok: true; runId: string }) => void
    bridge.nextStart = new Promise((resolve) => {
      answer = resolve
    })
    const first = run(files(2))
    await tick()
    expect(isZipDownloadBusy()).toBe(true)
    // a second press while the dialog is open does nothing
    expect(await run(files(3))).toBe(false)
    expect(bridge.starts).toHaveLength(1)
    answer({ ok: true, runId: 'r1' })
    await first
    expect(isZipDownloadBusy()).toBe(true)
    bridge.push({ runId: 'r1', phase: 'done', fileCount: 2, path: '/x.zip' })
    expect(isZipDownloadBusy()).toBe(false)
  })
})

describe('absent bridge', () => {
  it('does nothing without a bridge', async () => {
    expect(
      await runZipDownload({
        bridge: null,
        workspaceId: 'ws-1',
        screen: 'workspace',
        docs: files(2),
      }),
    ).toBe(false)
    expect(zipRuns()).toEqual([])
  })

  it('a selection of only foreign rows shows a done 0/N run with the skip lines', async () => {
    expect(await run([doc('x', { workspaceId: 'ws-2' }), doc('y', { workspaceId: 'ws-2' })])).toBe(
      true,
    )
    expect(bridge.starts).toEqual([])
    expect(bridge.files).toEqual([])
    expect(zipRuns()[0]).toMatchObject({
      phase: 'done',
      ok: 0,
      total: 2,
      lines: [
        { documentId: 'x', reason: 'other_workspace' },
        { documentId: 'y', reason: 'other_workspace' },
      ],
    })
    expect(isZipDownloadBusy()).toBe(false)
  })

  it('a selection with nothing downloadable asks nothing of main', async () => {
    expect(await run([])).toBe(false)
    expect(zipRuns()).toEqual([])
    expect(bridge.starts).toEqual([])
    expect(bridge.files).toEqual([])
  })
})
