import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDocBytes } from '../../../apps/docs/src/renderer/doc-bytes'
import {
  DOC_HANDOFF_SCHEME,
  DOC_HANDOFF_TTL_MS,
  mintDocHandoff,
  pendingDocHandoffs,
} from './doc-handoff'

const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9])

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('doc handoff (web OpenFileResult.dataUrl)', () => {
  it('hands the bytes to fetchDocBytes without fetch() (the frame CSP refuses blob:/data:)', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('refused by connect-src')))
    vi.stubGlobal('fetch', fetchSpy)
    const url = mintDocHandoff(DOCX.slice().buffer)
    expect(url.startsWith(DOC_HANDOFF_SCHEME)).toBe(true)
    expect(url).not.toMatch(/^(blob|data):/)
    expect(await fetchDocBytes(url)).toEqual(DOCX)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is one-shot: a second read of the same handle fails', async () => {
    const url = mintDocHandoff(DOCX.slice().buffer)
    await fetchDocBytes(url)
    await expect(fetchDocBytes(url)).rejects.toThrow(/handoff expired/)
  })

  it('drops an unclaimed handle after the TTL', async () => {
    vi.useFakeTimers()
    const before = pendingDocHandoffs()
    const url = mintDocHandoff(DOCX.slice().buffer)
    expect(pendingDocHandoffs()).toBe(before + 1)
    vi.advanceTimersByTime(DOC_HANDOFF_TTL_MS)
    expect(pendingDocHandoffs()).toBe(before)
    await expect(fetchDocBytes(url)).rejects.toThrow(/handoff expired/)
  })

  it('leaves other URLs to fetch() (desktop handoff path unchanged)', async () => {
    mintDocHandoff(DOCX.slice().buffer)
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([7, 8])))
    vi.stubGlobal('fetch', fetchSpy)
    expect(await fetchDocBytes('genoffice-docx-media://handoff/abc')).toEqual(
      new Uint8Array([7, 8]),
    )
    expect(fetchSpy).toHaveBeenCalledWith('genoffice-docx-media://handoff/abc')
  })
})
