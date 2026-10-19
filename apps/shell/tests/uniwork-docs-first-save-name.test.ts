import { describe, expect, it, vi } from 'vitest'
import { createFirstSaveNameBroker } from '../src/main/uniwork-docs/first-save-name'
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

function fakeContents(destroyed = false) {
  const listeners = new Map<string, () => void>()
  return {
    sent: [] as Array<{ channel: string; payload: unknown }>,
    isDestroyed: () => destroyed,
    send: vi.fn(function (this: { sent: unknown[] }, channel: string, payload: unknown) {
      ;(this as unknown as { sent: unknown[] }).sent.push({ channel, payload })
    }),
    once: vi.fn((event: string, cb: () => void) => {
      listeners.set(event, cb)
    }),
    fire: (event: string) => listeners.get(event)?.(),
  }
}

describe('first-save-name broker', () => {
  it('pushes the ask on its channel and settles on the renderer verdict', async () => {
    const broker = createFirstSaveNameBroker()
    const wc = fakeContents()
    const result = broker.request(wc as never, ASK)
    expect(wc.send).toHaveBeenCalledWith(UNIWORK_DOC_CHANNELS.firstSaveName, ASK)
    broker.answer({ requestId: 'fsn-1', answer: 'continue' })
    await expect(result).resolves.toBe('continue')
  })

  it('settles cancel on a cancel verdict', async () => {
    const broker = createFirstSaveNameBroker()
    const result = broker.request(fakeContents() as never, ASK)
    broker.answer({ requestId: 'fsn-1', answer: 'cancel' })
    await expect(result).resolves.toBe('cancel')
  })

  it('ignores an unknown id, a bad verdict and a non-object, and settles once', async () => {
    const broker = createFirstSaveNameBroker()
    const result = broker.request(fakeContents() as never, ASK)
    broker.answer({ requestId: 'other', answer: 'cancel' })
    broker.answer({ requestId: 'fsn-1', answer: 'maybe' })
    broker.answer(null)
    broker.answer('fsn-1')
    broker.answer({ requestId: 'fsn-1', answer: 'continue' })
    broker.answer({ requestId: 'fsn-1', answer: 'cancel' })
    await expect(result).resolves.toBe('continue')
  })

  it('continues at once without a shell window (the save is never lost to a missing host)', async () => {
    const broker = createFirstSaveNameBroker()
    await expect(broker.request(null, ASK)).resolves.toBe('continue')
    await expect(broker.request(fakeContents(true) as never, ASK)).resolves.toBe('continue')
  })

  it('continues when the send throws', async () => {
    const broker = createFirstSaveNameBroker()
    const wc = fakeContents()
    wc.send.mockImplementation(() => {
      throw new Error('destroyed object')
    })
    await expect(broker.request(wc as never, ASK)).resolves.toBe('continue')
  })

  it('a window closed with the dialog open settles cancel', async () => {
    const broker = createFirstSaveNameBroker()
    const wc = fakeContents()
    const result = broker.request(wc as never, ASK)
    wc.fire('destroyed')
    await expect(result).resolves.toBe('cancel')
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
