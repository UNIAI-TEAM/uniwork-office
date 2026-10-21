/**
 * @vitest-environment jsdom
 */
/**
 * UNI-2067 NA: window.uniworkWork.notificationDocuments crossing the shell
 * preload. Main answers a result envelope; the preload narrows the page to the
 * documented fields and turns any other shape into the module's malformed
 * code ({ok:false, error:'server'}), never a throw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_WORK_CHANNELS } from '../src/shared/uniwork-work-api'
import type { UniworkWorkApi } from '../src/shared/uniwork-work-api'

async function loadBridge(reply: unknown) {
  vi.resetModules()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: () => undefined,
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return reply
      },
      send: () => undefined,
      removeListener: () => undefined,
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  return { work: exposed.uniworkWork as UniworkWorkApi, invoked }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
})

const DOC = {
  id: 'd_1',
  title: 'Budget',
  kind: 'docx',
  trashed: false,
  shelved: false,
  deleted: false,
}

describe('window.uniworkWork.notificationDocuments (preload)', () => {
  it('invokes its own channel with the id and the query', async () => {
    const { work, invoked } = await loadBridge({
      ok: true,
      value: { documents: [DOC], next_cursor: null },
    })
    await work.notificationDocuments('n_9', { cursor: 'c', limit: 10 })
    expect(
      invoked.filter((c) => c.channel === UNIWORK_WORK_CHANNELS.notificationDocuments),
    ).toEqual([
      {
        channel: UNIWORK_WORK_CHANNELS.notificationDocuments,
        args: ['n_9', { cursor: 'c', limit: 10 }],
      },
    ])
  })

  it('passes a good page through', async () => {
    const value = { documents: [DOC], next_cursor: 'ndc1.x.y' }
    const { work } = await loadBridge({ ok: true, value })
    expect(await work.notificationDocuments('n_9')).toEqual({ ok: true, value })
  })

  it('narrows the page to the documented fields', async () => {
    const { work } = await loadBridge({
      ok: true,
      value: { documents: [{ ...DOC, extra: 'x' }], next_cursor: null, token: 't' },
    })
    expect(await work.notificationDocuments('n_9')).toEqual({
      ok: true,
      value: { documents: [DOC], next_cursor: null },
    })
  })

  it('passes a failure envelope through', async () => {
    const { work } = await loadBridge({ ok: false, error: 'forbidden' })
    expect(await work.notificationDocuments('n_9')).toEqual({ ok: false, error: 'forbidden' })
  })

  it('a bad shape becomes the malformed code', async () => {
    const bad: unknown[] = [
      undefined,
      null,
      'x',
      { ok: true },
      { ok: true, value: null },
      { ok: true, value: {} },
      { ok: true, value: { documents: {}, next_cursor: null } },
      { ok: true, value: { documents: [DOC], next_cursor: 7 } },
      { ok: true, value: { documents: [null], next_cursor: null } },
      { ok: true, value: { documents: [{ ...DOC, deleted: 'no' }], next_cursor: null } },
      { ok: true, value: { documents: [{ ...DOC, id: 4 }], next_cursor: null } },
    ]
    for (const reply of bad) {
      const { work } = await loadBridge(reply)
      expect(await work.notificationDocuments('n_9')).toEqual({ ok: false, error: 'server' })
    }
  })
})
