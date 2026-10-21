import { describe, expect, it } from 'vitest'
import { createSequentialRunner } from '../src/main/uniwork-docs/folder-upload/sequential-runner'
import type { FolderUploadRunProgress } from '../src/main/uniwork-docs/folder-upload/runner-port'
import type { AppFolderUploadPlan } from '../src/main/uniwork-docs/folder-upload/scan'
import type { UniworkDocActionResult, UniworkUploadDocInput } from '../src/shared/home-api'

/**
 * UNI-2052 FU-C (contract Q1 A): a server without the folder_upload block still
 * takes several files, one after the other through the existing single-upload
 * path, behind the same runner port and with the same progress shape.
 */

const plan = (names: string[]): AppFolderUploadPlan => ({
  rootName: null,
  rootTitle: null,
  folders: [],
  files: names.map((name, index) => ({
    path: name,
    filename: name,
    folderPath: '',
    size: 10 * (index + 1),
    index,
  })),
  skipped: [],
  totals: { files: names.length, bytes: names.reduce((sum, _n, i) => sum + 10 * (i + 1), 0) },
  refusal: null,
})

type Outcome = { ok: true } | { ok: false; error: string; retryable?: boolean }

function harness(outcomes: Record<string, Outcome[]> = {}) {
  const uploads: UniworkUploadDocInput[] = []
  const cancelled: string[] = []
  const gates: Array<() => void> = []
  let hold = false
  const events: FolderUploadRunProgress[] = []
  const runner = createSequentialRunner({
    uploadOne: async (input): Promise<UniworkDocActionResult<never>> => {
      uploads.push(input)
      if (hold) await new Promise<void>((resolve) => gates.push(resolve))
      const name = input.path.split('/').pop() ?? ''
      const next = outcomes[name]?.shift() ?? { ok: true }
      if (next.ok) return { ok: true, value: {} as never }
      return {
        ok: false,
        error: next.error as never,
        ...(next.retryable ? { retryable: true } : {}),
      }
    },
    cancelOne: (uploadId) => void cancelled.push(uploadId),
    newUploadId: (() => {
      let n = 0
      return () => `u${++n}`
    })(),
  })
  const start = (names: string[]) =>
    runner.start(plan(names), {
      runId: 'run1',
      workspaceId: 'w',
      parentId: 'f1',
      shareWithWorkspace: true,
      filePath: (index) => `/abs/${names[index]}`,
      onProgress: (p) => events.push(p),
    })
  return {
    runner,
    start,
    uploads,
    cancelled,
    events,
    hold: () => void (hold = true),
    release: () => gates.shift()?.(),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSequentialRunner', () => {
  it('uploads the files in order, one at a time, into the target folder', async () => {
    const h = harness()
    h.hold()
    expect(h.start(['a.docx', 'b.docx', 'c.docx'])).toEqual({ runId: 'run1' })
    await settle()
    // only the first is in flight until it settles
    expect(h.uploads.map((u) => u.path)).toEqual(['/abs/a.docx'])
    h.release()
    await settle()
    expect(h.uploads.map((u) => u.path)).toEqual(['/abs/a.docx', '/abs/b.docx'])
    h.release()
    await settle()
    h.release()
    await settle()
    expect(h.uploads.map((u) => [u.workspaceId, u.folderId])).toEqual([
      ['w', 'f1'],
      ['w', 'f1'],
      ['w', 'f1'],
    ])
    expect(new Set(h.uploads.map((u) => u.uploadId)).size).toBe(3)
  })

  it('reports uploading progress after each file, then done with the bytes sent', async () => {
    const h = harness()
    h.start(['a.docx', 'b.docx'])
    await settle()
    expect(h.events.map((e) => [e.phase, e.done, e.failed])).toEqual([
      ['uploading', 0, 0],
      ['uploading', 1, 0],
      ['done', 2, 0],
    ])
    expect(h.events.at(-1)).toMatchObject({ total: 2, sentBytes: 30, totalBytes: 30 })
    expect(h.events.at(-1)?.failures).toBeUndefined()
  })

  it('records a failed file with its code and whether it is worth retrying, and goes on', async () => {
    const h = harness({
      'a.docx': [{ ok: false, error: 'network' }],
      'b.docx': [{ ok: false, error: 'too_large' }],
    })
    h.start(['a.docx', 'b.docx', 'c.docx'])
    await settle()
    const last = h.events.at(-1)
    expect(last).toMatchObject({ phase: 'done', done: 1, failed: 2 })
    expect(last?.failures).toEqual([
      { path: 'a.docx', code: 'network', retryable: true },
      { path: 'b.docx', code: 'too_large', retryable: false },
    ])
  })

  it('treats a throttle (retryable flag) as retryable', async () => {
    const h = harness({ 'a.docx': [{ ok: false, error: 'server_error', retryable: true }] })
    h.start(['a.docx'])
    await settle()
    expect(h.events.at(-1)?.failures).toEqual([
      { path: 'a.docx', code: 'server_error', retryable: true },
    ])
  })

  it('cancel aborts the file in flight, uploads no more, and ends canceled without a failure for it', async () => {
    const h = harness({ 'a.docx': [{ ok: false, error: 'upload_cancelled' }] })
    h.hold()
    h.start(['a.docx', 'b.docx'])
    await settle()
    h.runner.cancel('run1')
    expect(h.cancelled).toEqual([h.uploads[0].uploadId])
    h.release()
    await settle()
    expect(h.uploads).toHaveLength(1)
    expect(h.events.at(-1)).toMatchObject({ phase: 'canceled', done: 0, failed: 0 })
  })

  it('retry runs only the retryable failures again, and counts them done when they pass', async () => {
    const h = harness({
      'a.docx': [{ ok: false, error: 'network' }],
      'b.docx': [{ ok: false, error: 'unsupported_format' }],
    })
    h.start(['a.docx', 'b.docx', 'c.docx'])
    await settle()
    expect(h.uploads).toHaveLength(3)
    h.runner.retry('run1')
    await settle()
    expect(h.uploads.slice(3).map((u) => u.path)).toEqual(['/abs/a.docx'])
    expect(h.events.at(-1)).toMatchObject({ phase: 'done', done: 2, failed: 1 })
    expect(h.events.at(-1)?.failures).toEqual([
      { path: 'b.docx', code: 'unsupported_format', retryable: false },
    ])
  })

  it('retry and cancel of an unknown or dismissed run do nothing', async () => {
    const h = harness({ 'a.docx': [{ ok: false, error: 'network' }] })
    h.start(['a.docx'])
    await settle()
    h.runner.dismiss('run1')
    h.runner.retry('run1')
    h.runner.cancel('run1')
    h.runner.retry('nope')
    await settle()
    expect(h.uploads).toHaveLength(1)
  })
})
