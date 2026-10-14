/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ack,
  clearUniworkAcks,
  isAcked,
  subscribeUniworkAck,
  useUniworkDisclosureAck,
  type UniworkAckKey,
} from '../src/ai-uniwork-composer'

describe('UniWork AI disclosure acknowledgement store (G6-05u S8)', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    clearUniworkAcks()
  })

  afterEach(() => {
    localStorage.clear()
    clearUniworkAcks()
    vi.unstubAllGlobals()
  })

  it('returns false before ack and true after ack for a { account, org, document } tuple', () => {
    const key: UniworkAckKey = { account: 'acc-1', org: 'org-1', document: 'doc-1' }
    expect(isAcked(key)).toBe(false)
    ack(key)
    expect(isAcked(key)).toBe(true)
  })

  it('scopes acknowledgements per { account, org, document | "local" } and re-prompts when document, org or account changes', () => {
    const base: UniworkAckKey = { account: 'acc-1', org: 'org-1', document: 'doc-1' }
    ack(base)

    expect(isAcked(base)).toBe(true)
    expect(isAcked({ account: 'acc-1', org: 'org-1', document: 'doc-2' })).toBe(false)
    expect(isAcked({ account: 'acc-1', org: 'org-1', document: 'local' })).toBe(false)
    expect(isAcked({ account: 'acc-1', org: 'org-2', document: 'doc-1' })).toBe(false)
    expect(isAcked({ account: 'acc-2', org: 'org-1', document: 'doc-1' })).toBe(false)
  })

  it('remembers the "local" bucket across local files in the same account and organization', () => {
    const localKey: UniworkAckKey = { account: 'acc-1', org: 'org-1', document: 'local' }
    expect(isAcked(localKey)).toBe(false)
    ack(localKey)
    expect(isAcked({ account: 'acc-1', org: 'org-1', document: 'local' })).toBe(true)
    expect(isAcked({ account: 'acc-1', org: 'org-2', document: 'local' })).toBe(false)
  })

  it('persists acknowledgements in localStorage and survives corrupted storage entries', () => {
    const key: UniworkAckKey = { account: 'acc-1', org: 'org-1', document: 'doc-9' }
    ack(key)
    const raw = localStorage.getItem('uniwork.office.ai.disclosure.ack.v1')
    expect(raw).toBeTruthy()
    expect(isAcked(key)).toBe(true)

    localStorage.setItem('uniwork.office.ai.disclosure.ack.v1', '{not-valid-json')
    expect(() => isAcked(key)).not.toThrow()
  })

  it('notifies subscribers and updates useUniworkDisclosureAck when acked or cleared', () => {
    const listener = vi.fn()
    const unsub = subscribeUniworkAck(listener)
    const key: UniworkAckKey = { account: 'acc-1', org: 'org-1', document: 'doc-1' }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    let latest: { acked: boolean; ackNow: () => void } = { acked: false, ackNow: () => {} }
    function Probe({ k }: { k: UniworkAckKey | null }) {
      latest = useUniworkDisclosureAck(k)
      return createElement('span', { 'data-acked': String(latest.acked) })
    }

    act(() => root.render(createElement(Probe, { k: key })))
    expect(latest.acked).toBe(false)

    act(() => latest.ackNow())
    expect(latest.acked).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    act(() => root.render(createElement(Probe, { k: { ...key, document: 'doc-2' } })))
    expect(latest.acked).toBe(false)

    act(() => clearUniworkAcks())
    act(() => root.render(createElement(Probe, { k: key })))
    expect(latest.acked).toBe(false)

    unsub()
    act(() => root.unmount())
    host.remove()
  })

  it('works with empty account, org or document fields using documented fallback scope (RF1-17)', () => {
    const emptyAll: UniworkAckKey = { account: '', org: '', document: '' }
    expect(isAcked(emptyAll)).toBe(false)
    ack(emptyAll)
    expect(isAcked(emptyAll)).toBe(true)

    // Changing a non-empty field still scopes separately and re-prompts
    const emptyAccountOtherDoc: UniworkAckKey = { account: '  ', org: 'org-1', document: 'doc-2' }
    expect(isAcked(emptyAccountOtherDoc)).toBe(false)
    ack(emptyAccountOtherDoc)
    expect(isAcked(emptyAccountOtherDoc)).toBe(true)
    expect(isAcked({ account: '', org: 'org-1', document: 'doc-3' })).toBe(false)
  })

  it('parses localStorage once rather than on every render when unacked, and reacts to window storage events (RF1-17)', () => {
    const key: UniworkAckKey = { account: 'acc-1', org: 'org-1', document: 'doc-storage' }
    localStorage.setItem('uniwork.office.ai.disclosure.ack.v1', JSON.stringify(['other|org|doc']))

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    let latestAcked = false
    function Probe({ tick }: { tick: number }) {
      const { acked } = useUniworkDisclosureAck(key)
      latestAcked = acked
      return createElement('span', { 'data-tick': String(tick), 'data-acked': String(acked) })
    }

    act(() => root.render(createElement(Probe, { tick: 1 })))
    expect(latestAcked).toBe(false)
    const initialCalls = getItemSpy.mock.calls.length
    expect(initialCalls).toBe(1)

    // Subsequent re-renders while unacked must NOT re-read or re-parse localStorage
    act(() => root.render(createElement(Probe, { tick: 2 })))
    act(() => root.render(createElement(Probe, { tick: 3 })))
    expect(getItemSpy.mock.calls.length).toBe(1)

    // Simulate another tab acknowledging the key via a window storage event
    const nextRaw = JSON.stringify(['other|org|doc', 'acc-1|org-1|doc-storage'])
    localStorage.setItem('uniwork.office.ai.disclosure.ack.v1', nextRaw)
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'uniwork.office.ai.disclosure.ack.v1',
          newValue: nextRaw,
        }),
      )
    })
    expect(latestAcked).toBe(true)
    expect(isAcked(key)).toBe(true)

    getItemSpy.mockRestore()
    act(() => root.unmount())
    host.remove()
  })
})
