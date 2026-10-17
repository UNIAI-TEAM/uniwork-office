import { describe, expect, it, vi } from 'vitest'
import {
  FIRST_SAVE_OPEN_WAIT_MS,
  acknowledgeFirstSaveOpen,
  requestFirstSaveOpen,
  saveTabToUniWork,
  type SaveTabToUniWorkDeps,
} from '../src/main/uniwork-docs/first-save-open'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'

/**
 * SAVE-01 r2 (S01-R1-6): File > Save to UniWork must never answer "saved" on
 * silence. The first-save-open push is acknowledged by the renderer's
 * `uniwork-doc:first-save-open-ack`, and saveTabToUniWork warns (false) for
 * every path nobody handled: no active file, a bound path whose module Save
 * refused, an unbound path whose dialog was never acknowledged, a dead shell.
 */

interface FakeContents {
  id: number
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
  sent: Array<{ channel: string; payload: unknown }>
  destroyed?: boolean
}

function fakeContents(id = 7, onSend?: (payload: { path: string }) => void): FakeContents {
  const wc: FakeContents = {
    id,
    sent: [],
    isDestroyed: () => wc.destroyed === true,
    send: (channel, payload) => {
      wc.sent.push({ channel, payload })
      if (channel === UNIWORK_DOC_CHANNELS.firstSaveOpen) {
        onSend?.(payload as { path: string })
      }
    },
  }
  return wc
}

describe('requestFirstSaveOpen', () => {
  it('answers true when the renderer acks the path it was sent', async () => {
    const wc = fakeContents(7, ({ path }) => acknowledgeFirstSaveOpen(7, path))
    const opened = await requestFirstSaveOpen(wc, '/tmp/Draft.docx', 500)
    expect(opened).toBe(true)
    expect(wc.sent).toEqual([
      { channel: UNIWORK_DOC_CHANNELS.firstSaveOpen, payload: { path: '/tmp/Draft.docx' } },
    ])
  })

  it('answers false when no ack arrives inside the wait', async () => {
    const wc = fakeContents(7)
    const opened = await requestFirstSaveOpen(wc, '/tmp/Draft.docx', 25)
    expect(opened).toBe(false)
  })

  it('answers false immediately for a destroyed contents, sending nothing', async () => {
    const wc = fakeContents(7)
    wc.destroyed = true
    expect(await requestFirstSaveOpen(wc, '/tmp/Draft.docx', 25)).toBe(false)
    expect(wc.sent).toEqual([])
  })

  it('answers false when the send itself throws', async () => {
    const wc = fakeContents(7)
    wc.send = () => {
      throw new Error('renderer frame gone')
    }
    expect(await requestFirstSaveOpen(wc, '/tmp/Draft.docx', 25)).toBe(false)
  })

  it('ignores an ack for a different path or contents and still times out', async () => {
    const wc = fakeContents(7)
    const pending = requestFirstSaveOpen(wc, '/tmp/Draft.docx', 25)
    // a stale dialog acking its own path (or another webContents') releases nothing
    acknowledgeFirstSaveOpen(7, '/tmp/Other.docx')
    acknowledgeFirstSaveOpen(9, '/tmp/Draft.docx')
    expect(await pending).toBe(false)
  })

  it('a second request for the same pair supersedes the first waiter', async () => {
    const wc = fakeContents(7)
    const first = requestFirstSaveOpen(wc, '/tmp/Draft.docx', 500)
    const second = requestFirstSaveOpen(wc, '/tmp/Draft.docx', 25)
    // the older waiter is resolved false by the newer registration
    expect(await first).toBe(false)
    // the newer one still owns the ack slot
    acknowledgeFirstSaveOpen(7, '/tmp/Draft.docx')
    expect(await second).toBe(true)
  })

  it('the default wait is the documented 10 s', () => {
    expect(FIRST_SAVE_OPEN_WAIT_MS).toBe(10_000)
  })
})

describe('saveTabToUniWork (the File > Save routing, S01-R1-6)', () => {
  function deps(over: Partial<SaveTabToUniWorkDeps> = {}) {
    const calls = { warn: 0 }
    const base: SaveTabToUniWorkDeps = {
      activeFilePath: () => '/tmp/Draft.docx',
      isBound: () => false,
      requestModuleSave: () => true,
      liveBridgeSession: () => false,
      shellContents: () => fakeContents(7, ({ path }) => acknowledgeFirstSaveOpen(7, path)),
      warn: () => {
        calls.warn += 1
      },
      saveViaBridge: async () => true,
      ...over,
    }
    return { calls, deps: base }
  }

  it('warns and answers false when no tab has a file', async () => {
    const { calls, deps: d } = deps({ activeFilePath: () => undefined })
    expect(await saveTabToUniWork(d)).toBe(false)
    expect(calls.warn).toBe(1)
  })

  it('a bound path runs the module save and answers true', async () => {
    const saves: string[] = []
    const { calls, deps: d } = deps({
      isBound: () => true,
      requestModuleSave: (path) => {
        saves.push(path)
        return true
      },
    })
    expect(await saveTabToUniWork(d)).toBe(true)
    expect(saves).toEqual(['/tmp/Draft.docx'])
    expect(calls.warn).toBe(0)
  })

  it('a bound path whose module save refused warns instead of reporting success', async () => {
    const { calls, deps: d } = deps({
      isBound: () => true,
      requestModuleSave: () => false,
    })
    expect(await saveTabToUniWork(d)).toBe(false)
    expect(calls.warn).toBe(1)
  })

  it('an unbound path is true once the renderer acknowledges the dialog', async () => {
    const wc = fakeContents(3, ({ path }) => acknowledgeFirstSaveOpen(3, path))
    const { calls, deps: d } = deps({ shellContents: () => wc })
    expect(await saveTabToUniWork(d)).toBe(true)
    expect(wc.sent).toEqual([
      { channel: UNIWORK_DOC_CHANNELS.firstSaveOpen, payload: { path: '/tmp/Draft.docx' } },
    ])
    expect(calls.warn).toBe(0)
  })

  it('an unbound path with no shell contents warns', async () => {
    const { calls, deps: d } = deps({ shellContents: () => null })
    expect(await saveTabToUniWork(d)).toBe(false)
    expect(calls.warn).toBe(1)
  })

  it('an unbound path whose dialog is never acknowledged warns after the wait', async () => {
    vi.useFakeTimers()
    try {
      const { calls, deps: d } = deps({ shellContents: () => fakeContents(3) })
      const answer = saveTabToUniWork(d)
      await vi.advanceTimersByTimeAsync(FIRST_SAVE_OPEN_WAIT_MS)
      expect(await answer).toBe(false)
      expect(calls.warn).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a live bridge session still saves through the bridge', async () => {
    const bridged: string[] = []
    const { calls, deps: d } = deps({
      liveBridgeSession: () => true,
      saveViaBridge: async (path) => {
        bridged.push(path)
        return true
      },
    })
    expect(await saveTabToUniWork(d)).toBe(true)
    expect(bridged).toEqual(['/tmp/Draft.docx'])
    expect(calls.warn).toBe(0)
  })
})
