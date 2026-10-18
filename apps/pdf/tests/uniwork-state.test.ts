import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  PLAIN_PDF_STATE,
  queryPdfUniworkState,
  usePdfUniworkState,
  type PdfUniworkSeam,
} from '../src/renderer/uniwork-state'
import type { PdfUniworkState } from '../src/shared/ipc'

describe('queryPdfUniworkState', () => {
  it('returns main’s answer for the path', async () => {
    const uniworkState = vi.fn(async () => ({ bound: true, readOnly: true }))
    await expect(queryPdfUniworkState({ uniworkState }, '/a.pdf')).resolves.toEqual({
      bound: true,
      readOnly: true,
    })
    expect(uniworkState).toHaveBeenCalledWith('/a.pdf')
  })

  it('reads a missing method (browser harness) as an unbound, editable file', async () => {
    await expect(queryPdfUniworkState({}, '/a.pdf')).resolves.toEqual(PLAIN_PDF_STATE)
    expect(PLAIN_PDF_STATE).toEqual({ bound: false, readOnly: false })
  })

  it('reads a rejected call as an unbound, editable file', async () => {
    const uniworkState = vi.fn(async () => {
      throw new Error('no handler')
    })
    await expect(queryPdfUniworkState({ uniworkState }, '/a.pdf')).resolves.toEqual(PLAIN_PDF_STATE)
  })

  it('treats a malformed answer as not bound and not read only', async () => {
    const uniworkState = vi.fn(async () => undefined as never)
    await expect(queryPdfUniworkState({ uniworkState }, '/a.pdf')).resolves.toEqual(PLAIN_PDF_STATE)
  })
})

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/spec.pdf'
const OTHER = 'C:/u/uniwork-documents/dep/user/doc2/other.pdf'

describe('usePdfUniworkState follows the lock ping', () => {
  let answer: PdfUniworkState
  let calls: number
  let unsubscribes: number
  let ping: ((path: string) => void) | null
  let latest: PdfUniworkState
  let root: Root | null
  let host: HTMLElement | null
  let api: PdfUniworkSeam

  function Probe({ p }: { p: string | null }) {
    latest = usePdfUniworkState(api, p)
    return null
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    answer = { bound: true, readOnly: true }
    calls = 0
    unsubscribes = 0
    ping = null
    latest = PLAIN_PDF_STATE
    api = {
      uniworkState: vi.fn(async () => {
        calls += 1
        return answer
      }),
      onUniworkStateChanged: vi.fn((cb: (path: string) => void) => {
        ping = cb
        return () => {
          unsubscribes += 1
        }
      }),
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    vi.unstubAllGlobals()
  })

  it('re-queries on a ping for the open path (read-only -> editable -> read-only) and ignores other paths', async () => {
    await act(async () => root!.render(createElement(Probe, { p: PATH })))
    await settle()
    expect(latest).toEqual({ bound: true, readOnly: true })
    expect(calls).toBe(1)

    answer = { bound: true, readOnly: false }
    ping?.(OTHER)
    await settle()
    expect(calls).toBe(1)
    expect(latest.readOnly).toBe(true)

    ping?.(PATH)
    await settle()
    expect(calls).toBe(2)
    expect(latest).toEqual({ bound: true, readOnly: false })

    answer = { bound: true, readOnly: true }
    ping?.(PATH)
    await settle()
    expect(calls).toBe(3)
    expect(latest).toEqual({ bound: true, readOnly: true })

    act(() => root?.unmount())
    root = null
    expect(unsubscribes).toBe(1)
  })
})
