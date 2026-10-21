/**
 * @vitest-environment jsdom
 */
/**
 * UNI-2052 FU-C: the preload bridge of the folder / multi-file upload. Every
 * reply and push from main is narrowed before the renderer sees it (the same
 * rule as the other uniwork-doc bridges): a reply of the wrong shape becomes
 * null / [] / invalid_input, and unknown fields do not cross.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'

interface Bridge {
  uniworkBatchUploadPick(input: unknown): Promise<unknown>
  uniworkBatchUploadPreflight(input: unknown): Promise<unknown>
  uniworkBatchUploadStart(input: unknown): Promise<unknown>
  uniworkBatchUploadCancel(runId: string): Promise<void>
  uniworkBatchUploadRetry(runId: string): Promise<void>
  uniworkBatchUploadDismiss(runId: string): Promise<void>
  onUniworkBatchUploadProgress(cb: (event: unknown) => void): () => void
  getPathForFile(file: File): string
}

async function loadBridge(reply: unknown) {
  vi.resetModules()
  const handlers = new Map<string, (event: unknown, raw: unknown) => void>()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: (channel: string, cb: (event: unknown, raw: unknown) => void) => {
        handlers.set(channel, cb)
      },
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return reply
      },
      send: () => undefined,
      removeListener: (channel: string, cb: unknown) => {
        if (handlers.get(channel) === cb) handlers.delete(channel)
      },
    },
    webUtils: { getPathForFile: (file: File) => `/dropped/${file.name}` },
  }))
  await import('../src/preload/index')
  // the preload asks main for its cloud status once on load: not part of this bridge
  invoked.length = 0
  return { bridge: exposed.aiOffice as unknown as Bridge, invoked, handlers }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
})

const SDO = {
  preflightId: 'pf1',
  mode: 'folder',
  rootName: 'Case',
  rootNamePreview: 'Case (1)',
  target: { workspaceId: 'ws_1', folderId: 'fold_1', label: 'Contracts' },
  totals: { files: 2, bytes: 20 },
  skipped: [{ path: 'Case/ln.docx', reason: 'link' }],
  refusal: null,
  shareAvailable: true,
}

describe('the batch-upload bridge', () => {
  it('invokes each channel with the renderer input', async () => {
    const { bridge, invoked } = await loadBridge(undefined)
    const pick = { workspaceId: 'ws_1', folderId: null, mode: 'files' }
    await bridge.uniworkBatchUploadPick(pick)
    await bridge.uniworkBatchUploadPreflight({ workspaceId: 'ws_1', folderId: null, paths: ['/a'] })
    await bridge.uniworkBatchUploadStart({ preflightId: 'pf1', shareWithWorkspace: false })
    await bridge.uniworkBatchUploadCancel('r1')
    await bridge.uniworkBatchUploadRetry('r1')
    await bridge.uniworkBatchUploadDismiss('r1')
    expect(invoked.map((i) => i.channel)).toEqual([
      UNIWORK_DOC_CHANNELS.batchUploadPick,
      UNIWORK_DOC_CHANNELS.batchUploadPreflight,
      UNIWORK_DOC_CHANNELS.batchUploadStart,
      UNIWORK_DOC_CHANNELS.batchUploadCancel,
      UNIWORK_DOC_CHANNELS.batchUploadRetry,
      UNIWORK_DOC_CHANNELS.batchUploadDismiss,
    ])
    expect(invoked[0].args).toEqual([pick])
    expect(invoked[3].args).toEqual(['r1'])
  })

  it('does not call main for an empty run id', async () => {
    const { bridge, invoked } = await loadBridge(undefined)
    await bridge.uniworkBatchUploadCancel('')
    await bridge.uniworkBatchUploadRetry(undefined as never)
    await bridge.uniworkBatchUploadDismiss(4 as never)
    expect(invoked).toEqual([])
  })

  it('passes a well-formed preflight through and drops fields it does not know', async () => {
    const { bridge } = await loadBridge({ ...SDO, absolutePath: '/home/x', extra: 1 })
    const out = (await bridge.uniworkBatchUploadPick({})) as Record<string, unknown>
    expect(out).toEqual(SDO)
    expect(out).not.toHaveProperty('absolutePath')
  })

  it('answers null for a pick reply that is not a preflight, [] for a bad preflight list', async () => {
    for (const bad of [
      undefined,
      null,
      'x',
      3,
      {},
      { ...SDO, preflightId: '' },
      { ...SDO, mode: 'x' },
    ]) {
      const { bridge } = await loadBridge(bad)
      expect(await bridge.uniworkBatchUploadPick({})).toBeNull()
    }
    const { bridge } = await loadBridge('nope')
    expect(await bridge.uniworkBatchUploadPreflight({})).toEqual([])
  })

  it('keeps the valid preflights of a list and drops the rest', async () => {
    const { bridge } = await loadBridge([
      SDO,
      { nope: 1 },
      { ...SDO, preflightId: 'pf2', mode: 'files' },
    ])
    const out = (await bridge.uniworkBatchUploadPreflight({})) as Array<{ preflightId: string }>
    expect(out.map((s) => s.preflightId)).toEqual(['pf1', 'pf2'])
  })

  it('accepts a refusal with its numbers and a target that could not be resolved', async () => {
    const refused = {
      ...SDO,
      refusal: { code: 'too_many_files', limit: 500, actual: 612 },
      target: { workspaceId: 'ws_1', folderId: null, label: '' },
    }
    const { bridge } = await loadBridge(refused)
    const out = (await bridge.uniworkBatchUploadPick({})) as typeof refused
    expect(out.refusal).toEqual({ code: 'too_many_files', limit: 500, actual: 612 })
    expect(out.target.folderId).toBeNull()
  })

  it('narrows the start reply to ok + runId or a known error', async () => {
    expect(
      await (
        await loadBridge({ ok: true, runId: 'r1', secret: 1 })
      ).bridge.uniworkBatchUploadStart({}),
    ).toEqual({ ok: true, runId: 'r1' })
    expect(
      await (
        await loadBridge({ ok: false, error: 'unknown_preflight' })
      ).bridge.uniworkBatchUploadStart({}),
    ).toEqual({ ok: false, error: 'unknown_preflight' })
    for (const bad of [
      undefined,
      'x',
      { ok: true },
      { ok: true, runId: '' },
      { ok: false, error: 'weird' },
    ]) {
      expect(await (await loadBridge(bad)).bridge.uniworkBatchUploadStart({})).toEqual({
        ok: false,
        error: 'invalid_input',
      })
    }
  })

  it('delivers a well-formed progress push to subscribers and ignores a malformed one', async () => {
    const { bridge, handlers } = await loadBridge(undefined)
    const seen: unknown[] = []
    const off = bridge.onUniworkBatchUploadProgress((e) => seen.push(e))
    const push = handlers.get(UNIWORK_DOC_CHANNELS.batchUploadProgress)!
    push(null, {
      runId: 'r1',
      phase: 'done',
      done: 1,
      failed: 1,
      total: 2,
      sentBytes: 5,
      totalBytes: 9,
      rootTitle: 'Case (1)',
      rootFolderId: 'fold_9',
      failures: [{ path: 'Case/a.docx', code: 'network', retryable: true, leaked: '/home/x' }],
      error: { code: 'folder_uploads_busy', retryAfterSeconds: 30 },
      extra: 1,
    })
    expect(seen).toEqual([
      {
        runId: 'r1',
        phase: 'done',
        done: 1,
        failed: 1,
        total: 2,
        sentBytes: 5,
        totalBytes: 9,
        rootTitle: 'Case (1)',
        rootFolderId: 'fold_9',
        failures: [{ path: 'Case/a.docx', code: 'network', retryable: true }],
        error: { code: 'folder_uploads_busy', retryAfterSeconds: 30 },
      },
    ])
    for (const bad of [
      null,
      'x',
      { runId: '', phase: 'done', done: 0, failed: 0, total: 0, sentBytes: 0, totalBytes: 0 },
      { runId: 'r1', phase: 'sideways', done: 0, failed: 0, total: 0, sentBytes: 0, totalBytes: 0 },
      { runId: 'r1', phase: 'done', done: -1, failed: 0, total: 0, sentBytes: 0, totalBytes: 0 },
      { runId: 'r1', phase: 'done', done: 0, failed: 0, total: NaN, sentBytes: 0, totalBytes: 0 },
    ]) {
      push(null, bad)
    }
    expect(seen).toHaveLength(1)
    off()
    push(null, {
      runId: 'r2',
      phase: 'done',
      done: 0,
      failed: 0,
      total: 0,
      sentBytes: 0,
      totalBytes: 0,
    })
    expect(seen).toHaveLength(1)
  })

  it('still exposes webUtils.getPathForFile for dropped files', async () => {
    const { bridge } = await loadBridge(undefined)
    expect(bridge.getPathForFile({ name: 'a.docx' } as File)).toBe('/dropped/a.docx')
  })
})
