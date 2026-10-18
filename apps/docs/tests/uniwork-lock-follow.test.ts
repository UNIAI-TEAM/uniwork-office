/**
 * EL-1(b) fix6 / VEL-1+VEL-2: the desktop edit lock flips a bound document's
 * read-only answer while it stays open. The renderer seam must follow the
 * shell's `uniwork:doc-state-changed` ping (useUniworkDocState re-queries) and
 * an explicit Save on a read-only bound copy asks the shell to explain
 * (uniworkReadOnlySave) instead of silently doing nothing. Autosave, Save As
 * and unbound read-only files keep today's behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  NO_UNIWORK_STATE,
  uniworkExplainReadOnlySave,
  useUniworkDocState,
  type UniworkDocState,
} from '../src/renderer/uniwork-doc-state'

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/report.docx'
const OTHER = 'C:/u/uniwork-documents/dep/user/doc2/minutes.docx'

interface Answer {
  bound: boolean
  readOnly: boolean
}

let answer: Answer
let uniworkStateCalls: number
let ping: ((path: string) => void) | null
let unsubscribes: number
let root: Root | null
let host: HTMLElement | null
let latest: UniworkDocState

function Probe({ path }: { path: string | null }) {
  latest = useUniworkDocState(path)
  return null
}

/** flush the microtask the state query resolves on (no wall-clock wait) */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mount(path: string | null): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(Probe, { path }))
  })
  await settle()
}

async function firePing(path: string): Promise<void> {
  ping?.(path)
  await settle()
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  answer = { bound: true, readOnly: true }
  uniworkStateCalls = 0
  ping = null
  unsubscribes = 0
  latest = NO_UNIWORK_STATE
  Object.assign(window, {
    desktop: {
      uniworkState: vi.fn(async () => {
        uniworkStateCalls += 1
        return answer
      }),
      onUniworkStateChanged: vi.fn((cb: (path: string) => void) => {
        ping = cb
        return () => {
          unsubscribes += 1
        }
      }),
    },
  })
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.unstubAllGlobals()
  Object.assign(window, { desktop: undefined })
})

describe('useUniworkDocState follows the lock ping', () => {
  it('re-queries and flips read-only -> editable -> read-only when the ping names the open path', async () => {
    await mount(PATH)
    expect(latest).toEqual({ path: PATH, bound: true, readOnly: true })
    expect(uniworkStateCalls).toBe(1)

    answer = { bound: true, readOnly: false }
    await firePing(PATH)
    expect(uniworkStateCalls).toBe(2)
    expect(latest).toEqual({ path: PATH, bound: true, readOnly: false })

    answer = { bound: true, readOnly: true }
    await firePing(PATH)
    expect(uniworkStateCalls).toBe(3)
    expect(latest).toEqual({ path: PATH, bound: true, readOnly: true })
  })

  it('ignores a ping for another path', async () => {
    await mount(PATH)
    answer = { bound: true, readOnly: false }
    await firePing(OTHER)
    expect(uniworkStateCalls).toBe(1)
    expect(latest.readOnly).toBe(true)
  })

  it('stays quiet without the seam (an old shell or browser harness keeps the open-time answer)', async () => {
    Object.assign(window, {
      desktop: {
        uniworkState: vi.fn(async () => {
          uniworkStateCalls += 1
          return answer
        }),
      },
    })
    await mount(PATH)
    expect(latest).toEqual({ path: PATH, bound: true, readOnly: true })
    expect(uniworkStateCalls).toBe(1)
  })

  it('unsubscribes when the component unmounts', async () => {
    await mount(PATH)
    expect(ping).not.toBeNull()
    act(() => root?.unmount())
    expect(unsubscribes).toBe(1)
  })

  it('a path change drops the old subscription and re-queries for the new path', async () => {
    await mount(PATH)
    const firstPing = ping
    await act(async () => {
      root!.render(createElement(Probe, { path: OTHER }))
    })
    await settle()
    expect(unsubscribes).toBe(1)
    expect(ping).not.toBe(firstPing)
    expect(latest.path).toBe(OTHER)
    await firePing(OTHER)
    expect(latest.path).toBe(OTHER)
  })
})

describe('uniworkExplainReadOnlySave', () => {
  const boundView = { bound: true, readOnly: true }
  const boundEdit = { bound: true, readOnly: false }
  const localView = { bound: false, readOnly: true }

  function api() {
    return { uniworkReadOnlySave: vi.fn(async () => undefined) }
  }

  it('fires once for an explicit Save on a read-only bound document', () => {
    const a = api()
    uniworkExplainReadOnlySave(a, boundView, false, false, PATH)
    expect(a.uniworkReadOnlySave).toHaveBeenCalledTimes(1)
    expect(a.uniworkReadOnlySave).toHaveBeenCalledWith(PATH)
  })

  it.each([
    ['an editable bound document', boundEdit],
    ['an unbound read-only file', localView],
  ])('does nothing for %s', (_label, state) => {
    const a = api()
    uniworkExplainReadOnlySave(a, state, false, false, PATH)
    expect(a.uniworkReadOnlySave).not.toHaveBeenCalled()
  })

  it.each([
    ['autosave', false, true],
    ['Save As', true, false],
  ])('does nothing for %s even on a read-only bound document', (_label, saveAs, auto) => {
    const a = api()
    uniworkExplainReadOnlySave(a, boundView, saveAs, auto, PATH)
    expect(a.uniworkReadOnlySave).not.toHaveBeenCalled()
  })

  it('is a no-op when the seam is absent', () => {
    expect(() => uniworkExplainReadOnlySave({}, boundView, false, false, PATH)).not.toThrow()
    expect(() => uniworkExplainReadOnlySave(undefined, boundView, false, false, PATH)).not.toThrow()
  })
})
