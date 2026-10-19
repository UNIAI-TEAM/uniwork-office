import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFirstSaveNameBroker,
  registerFirstSaveNameAnswer,
} from '../src/main/uniwork-docs/first-save-name'
import { BLANK_DEFAULT_NAMES, isBlankDefaultTitle } from '../src/shared/blank-default-names'
import { UNIWORK_DOC_CHANNELS, type UniworkFirstSaveNameRequest } from '../src/shared/home-api'

/**
 * UNI-1959: the main half of the "Name the document" round trip - the broker
 * that pushes the ask to the shell renderer and settles on its verdict - and
 * the default-title table the restart fallback reads.
 */

const ASK: UniworkFirstSaveNameRequest = {
  requestId: 'fsn-1',
  path: 'C:/wc/d1/untitled.docx',
  documentId: 'd1',
  workspaceId: 'ws-1',
  title: 'Untitled document.docx',
  parentId: 'f-mine',
}

const LIFECYCLE_EVENTS = [
  'did-start-navigation',
  'did-navigate',
  'render-process-gone',
  'destroyed',
]

/** a WebContents stand-in: a real emitter, so listener counts mean something */
function fakeContents(id = 1, destroyed = false) {
  const emitter = new EventEmitter()
  const sent: Array<{ channel: string; payload: unknown }> = []
  const wc = {
    id,
    sent,
    isDestroyed: () => destroyed,
    send: vi.fn((channel: string, payload: unknown) => {
      sent.push({ channel, payload })
    }),
    on: (event: string, cb: (...args: unknown[]) => void) => {
      emitter.on(event, cb)
      return wc
    },
    removeListener: (event: string, cb: (...args: unknown[]) => void) => {
      emitter.removeListener(event, cb)
      return wc
    },
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
    listeners: () => LIFECYCLE_EVENTS.reduce((n, e) => n + emitter.listenerCount(e), 0),
  }
  return wc
}

/** the shell's `ipcMain.handle` for the answer channel, as main registers it */
function registered(broker: ReturnType<typeof createFirstSaveNameBroker>) {
  const handlers = new Map<string, (event: { sender: { id: number } }, raw: unknown) => unknown>()
  registerFirstSaveNameAnswer(
    { handle: (channel: string, fn: never) => void handlers.set(channel, fn) } as never,
    broker,
  )
  const handler = handlers.get(UNIWORK_DOC_CHANNELS.firstSaveNameAnswer)!
  return (senderId: number, raw: unknown) => handler({ sender: { id: senderId } }, raw)
}

describe('first-save-name broker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes the ask on its channel and settles on the renderer verdict', async () => {
    const broker = createFirstSaveNameBroker()
    const wc = fakeContents()
    const result = broker.request(wc as never, ASK)
    expect(wc.send).toHaveBeenCalledWith(UNIWORK_DOC_CHANNELS.firstSaveName, ASK)
    broker.answer({ requestId: 'fsn-1', answer: 'continue' }, wc)
    await expect(result).resolves.toBe('continue')
  })

  it('settles cancel on a cancel verdict', async () => {
    const broker = createFirstSaveNameBroker()
    const wc = fakeContents()
    const result = broker.request(wc as never, ASK)
    broker.answer({ requestId: 'fsn-1', answer: 'cancel' }, wc)
    await expect(result).resolves.toBe('cancel')
  })

  it('ignores an unknown id, a bad verdict and a non-object, and settles once', async () => {
    const broker = createFirstSaveNameBroker()
    const wc = fakeContents()
    const result = broker.request(wc as never, ASK)
    broker.answer({ requestId: 'other', answer: 'cancel' }, wc)
    broker.answer({ requestId: 'fsn-1', answer: 'maybe' }, wc)
    broker.answer(null, wc)
    broker.answer('fsn-1', wc)
    broker.answer({ requestId: 'fsn-1', answer: 'continue' }, wc)
    broker.answer({ requestId: 'fsn-1', answer: 'cancel' }, wc)
    await expect(result).resolves.toBe('continue')
  })

  it('BE-12: no shell window (or a send that threw) is an explicit unavailable outcome, never a verdict', async () => {
    const broker = createFirstSaveNameBroker()
    await expect(broker.request(null, ASK)).resolves.toBe('unavailable')
    await expect(broker.request(fakeContents(1, true) as never, ASK)).resolves.toBe('unavailable')
    const wc = fakeContents()
    wc.send.mockImplementation(() => {
      throw new Error('destroyed object')
    })
    await expect(broker.request(wc as never, ASK)).resolves.toBe('unavailable')
    expect(wc.listeners()).toBe(0)
  })

  it('a window closed with the dialog open settles cancel', async () => {
    const broker = createFirstSaveNameBroker()
    const wc = fakeContents()
    const result = broker.request(wc as never, ASK)
    wc.emit('destroyed')
    await expect(result).resolves.toBe('cancel')
  })

  describe('BE-3 / BE-22: the ask belongs to the renderer realm it was shown in', () => {
    it('a main-frame navigation (reload) settles cancel once', async () => {
      const broker = createFirstSaveNameBroker()
      const wc = fakeContents()
      const result = broker.request(wc as never, ASK)
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      await expect(result).resolves.toBe('cancel')
      // a late answer from the replaced realm is inert
      broker.answer({ requestId: 'fsn-1', answer: 'continue' }, wc)
    })

    it('a sub-frame or same-document navigation does not touch it', async () => {
      const broker = createFirstSaveNameBroker()
      const wc = fakeContents()
      let settled = false
      const result = broker.request(wc as never, ASK).then((v) => {
        settled = true
        return v
      })
      wc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
      await Promise.resolve()
      expect(settled).toBe(false)
      broker.answer({ requestId: 'fsn-1', answer: 'continue' }, wc)
      await expect(result).resolves.toBe('continue')
    })

    it('a render-process crash settles cancel', async () => {
      const broker = createFirstSaveNameBroker()
      const wc = fakeContents()
      const result = broker.request(wc as never, ASK)
      wc.emit('render-process-gone', { reason: 'crashed' })
      await expect(result).resolves.toBe('cancel')
    })

    it('a fresh renderer and the next Save get a fresh ask that settles on its own verdict', async () => {
      const broker = createFirstSaveNameBroker()
      const wc = fakeContents()
      const first = broker.request(wc as never, ASK)
      wc.emit('render-process-gone', { reason: 'crashed' })
      await expect(first).resolves.toBe('cancel')
      const again = broker.request(wc as never, { ...ASK, requestId: 'fsn-2' })
      expect(wc.send).toHaveBeenLastCalledWith(UNIWORK_DOC_CHANNELS.firstSaveName, {
        ...ASK,
        requestId: 'fsn-2',
      })
      broker.answer({ requestId: 'fsn-2', answer: 'continue' }, wc)
      await expect(again).resolves.toBe('continue')
    })
  })

  describe('BE-10 / BE-23: lifecycle listeners never outlive their ask', () => {
    it('every settlement route returns the listener count to the baseline', async () => {
      const broker = createFirstSaveNameBroker()
      const wc = fakeContents()
      const baseline = wc.listeners()
      const a = broker.request(wc as never, { ...ASK, requestId: 'a' })
      broker.answer({ requestId: 'a', answer: 'continue' }, wc)
      await a
      const b = broker.request(wc as never, { ...ASK, requestId: 'b' })
      broker.answer({ requestId: 'b', answer: 'cancel' }, wc)
      await b
      const c = broker.request(wc as never, { ...ASK, requestId: 'c' })
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      await c
      const d = broker.request(wc as never, { ...ASK, requestId: 'd' })
      broker.cancel('d')
      await d
      expect(wc.listeners()).toBe(baseline)
    })
  })

  describe('BE-26 / BE-14: delivery is bounded, a typing user is not', () => {
    it('no acknowledgement in time is an explicit unavailable outcome, and the renderer is told to drop it', async () => {
      vi.useFakeTimers()
      const broker = createFirstSaveNameBroker({ deliveryMs: 3000 })
      const wc = fakeContents()
      const result = broker.request(wc as never, ASK)
      await vi.advanceTimersByTimeAsync(3001)
      await expect(result).resolves.toBe('unavailable')
      expect(wc.sent.at(-1)).toEqual({
        channel: UNIWORK_DOC_CHANNELS.firstSaveNameDismiss,
        payload: { requestId: 'fsn-1' },
      })
      expect(wc.listeners()).toBe(0)
    })

    it('once the dialog acknowledged, no deadline applies however long the person takes', async () => {
      vi.useFakeTimers()
      const broker = createFirstSaveNameBroker({ deliveryMs: 3000 })
      const wc = fakeContents()
      let settled = false
      const result = broker.request(wc as never, ASK).then((v) => {
        settled = true
        return v
      })
      broker.answer({ requestId: 'fsn-1', answer: 'shown' }, wc)
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(settled).toBe(false)
      broker.answer({ requestId: 'fsn-1', answer: 'continue' }, wc)
      await expect(result).resolves.toBe('continue')
    })
  })

  describe('BE-5 / BE-15: the answer is bound to the WebContents that was asked', () => {
    it('a foreign sender answering a valid id is inert; the original settles once', async () => {
      const broker = createFirstSaveNameBroker()
      const answer = registered(broker)
      const wc = fakeContents(1)
      let settled: string | null = null
      const result = broker.request(wc as never, ASK).then((v) => {
        settled = v
        return v
      })
      await answer(2, { requestId: 'fsn-1', answer: 'continue' })
      await Promise.resolve()
      expect(settled).toBeNull()
      await answer(1, { requestId: 'fsn-1', answer: 'cancel' })
      await expect(result).resolves.toBe('cancel')
      await answer(1, { requestId: 'fsn-1', answer: 'continue' })
      expect(settled).toBe('cancel')
    })

    it('a foreign sender cannot stop the delivery clock either', async () => {
      vi.useFakeTimers()
      const broker = createFirstSaveNameBroker({ deliveryMs: 3000 })
      const answer = registered(broker)
      const wc = fakeContents(1)
      const result = broker.request(wc as never, ASK)
      await answer(2, { requestId: 'fsn-1', answer: 'shown' })
      await vi.advanceTimersByTimeAsync(3001)
      await expect(result).resolves.toBe('unavailable')
    })
  })

  describe('main-side cancel (a closed tab, a sign-out)', () => {
    it('settles cancel once and tells the renderer to drop the dialog', async () => {
      const broker = createFirstSaveNameBroker()
      const wc = fakeContents()
      const result = broker.request(wc as never, ASK)
      broker.cancel('fsn-1')
      broker.cancel('fsn-1')
      await expect(result).resolves.toBe('cancel')
      expect(
        wc.sent.filter((m) => m.channel === UNIWORK_DOC_CHANNELS.firstSaveNameDismiss),
      ).toEqual([
        { channel: UNIWORK_DOC_CHANNELS.firstSaveNameDismiss, payload: { requestId: 'fsn-1' } },
      ])
    })
  })
})

describe('blank default titles', () => {
  it('recognizes every vi and en default, trimmed and NFC', () => {
    for (const names of Object.values(BLANK_DEFAULT_NAMES)) {
      for (const title of Object.values(names)) {
        expect(isBlankDefaultTitle(title)).toBe(true)
        expect(isBlankDefaultTitle(`  ${title} `)).toBe(true)
        expect(isBlankDefaultTitle(title.normalize('NFD'))).toBe(true)
      }
    }
  })

  it('does not take an ordinary or edited name for a default', () => {
    expect(isBlankDefaultTitle('Quarterly report.docx')).toBe(false)
    expect(isBlankDefaultTitle('Untitled document 2.docx')).toBe(false)
    expect(isBlankDefaultTitle('Untitled document')).toBe(false)
    expect(isBlankDefaultTitle('')).toBe(false)
  })
})
