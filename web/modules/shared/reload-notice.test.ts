// @vitest-environment jsdom
// G5-03w: the notice and the reading position that cross a clean reload of a text frame.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureScroll, restoreScroll, stashReload, takeReload } from './reload-notice'
import type { ReloadNotice } from './remote-version'

const NOTICE: ReloadNotice = { revision: '12', author: 'Trần An', savedAt: 1_000 }

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  data: Map<string, string>
} {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

/** jsdom has no layout: give an element the size a scroller would have */
function scrollable(el: Element, scrollHeight: number, clientHeight: number, top = 0): void {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  el.scrollTop = top
}

describe('stash / take', () => {
  it('hands the notice over once, for the same document', () => {
    const store = memory()
    stashReload('d1', NOTICE, [{ path: [0], top: 5 }], store, 1_000)
    expect(takeReload('d2', { revision: '12' }, store, 1_500)).toBeNull()
    expect(takeReload('d1', { revision: '12' }, store, 1_500)).toEqual({
      notice: NOTICE,
      scroll: [{ path: [0], top: 5 }],
    })
    expect(takeReload('d1', { revision: '12' }, store, 1_500)).toBeNull()
  })

  it('drops a notice older than a minute, or from the future', () => {
    const store = memory()
    stashReload('d1', NOTICE, [], store, 1_000)
    expect(takeReload('d1', { revision: '12' }, store, 1_000 + 61_000)).toBeNull()
    stashReload('d1', NOTICE, [], store, 10_000)
    expect(takeReload('d1', { revision: '12' }, store, 5_000)).toBeNull()
  })

  it('a head newer than the one the reload asked for shows its own number, not the old author', () => {
    const store = memory()
    stashReload('d1', NOTICE, [], store, 1_000)
    expect(takeReload('d1', { revision: '14', modifiedAt: 9_000 }, store, 1_100)).toEqual({
      notice: { revision: '14', author: null, savedAt: 9_000 },
      scroll: [],
    })
  })

  it('an older head than the reload asked for (a stale boot) shows nothing', () => {
    const store = memory()
    stashReload('d1', NOTICE, [], store, 1_000)
    expect(takeReload('d1', { revision: '11' }, store, 1_100)).toBeNull()
  })

  it('a host without revisions still gets the notice', () => {
    const store = memory()
    stashReload('d1', { revision: null, author: null, savedAt: null }, [], store, 1_000)
    expect(takeReload('d1', { revision: null }, store, 1_100)?.notice.revision).toBeNull()
  })

  it('missing, broken or throwing storage is no notice, never an error', () => {
    expect(takeReload('d1', { revision: '1' }, null)).toBeNull()
    expect(() => stashReload('d1', NOTICE, [], null)).not.toThrow()
    const store = memory()
    store.data.set('uw-reload-notice:d1', '{not json')
    expect(takeReload('d1', { revision: '1' }, store)).toBeNull()
    const full = {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => stashReload('d1', NOTICE, [], full)).not.toThrow()
    const blocked = {
      ...full,
      getItem: () => {
        throw new Error('blocked')
      },
    }
    expect(takeReload('d1', { revision: '1' }, blocked)).toBeNull()
  })
})

describe('scroll position', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML =
      '<div id="root"><div class="a"></div><div class="b"><p></p></div></div>'
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('captures every scrolled element by its place in the page', () => {
    const b = document.querySelector('.b')!
    scrollable(b, 2000, 500, 320)
    expect(captureScroll()).toEqual([{ path: [0, 1], top: 320 }])
    scrollable(b, 2000, 500, 0)
    expect(captureScroll()).toEqual([])
  })

  it('puts it back once the renderer has drawn enough content, retrying while the page is short', () => {
    const b = document.querySelector('.b')!
    scrollable(b, 100, 100)
    restoreScroll([{ path: [0, 1], top: 320 }])
    vi.advanceTimersByTime(300)
    expect(b.scrollTop).toBe(0)
    scrollable(b, 2000, 500)
    vi.advanceTimersByTime(100)
    expect(b.scrollTop).toBe(320)
  })

  it('gives up after the tries, and never after the user has taken over', () => {
    const b = document.querySelector('.b')!
    scrollable(b, 100, 100)
    restoreScroll([{ path: [0, 1], top: 320 }], document, 3, 100)
    vi.advanceTimersByTime(1_000)
    scrollable(b, 2000, 500)
    vi.advanceTimersByTime(1_000)
    expect(b.scrollTop).toBe(0)

    const a = document.querySelector('.a')!
    scrollable(a, 100, 100)
    restoreScroll([{ path: [0, 0], top: 50 }])
    window.dispatchEvent(new Event('wheel'))
    scrollable(a, 2000, 500)
    vi.advanceTimersByTime(1_000)
    expect(a.scrollTop).toBe(0)
  })

  it('does nothing when there is nothing to restore', () => {
    expect(() => restoreScroll([])()).not.toThrow()
  })
})
