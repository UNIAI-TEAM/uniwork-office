// Visual round 2, S-09: a headed browser logged "requestFullscreen ... API can only be initiated by
// a user gesture" on every show start, because the show asked for full screen a second time after
// the web shell had already taken it with the click.
import { describe, expect, it, vi } from 'vitest'

import { requestShowFullscreen } from '../src/renderer/fullscreen-request'

function fakeDoc(fullscreenElement: Element | null) {
  const request = vi.fn(() => Promise.resolve())
  const doc = { fullscreenElement, documentElement: { requestFullscreen: request } }
  return { doc: doc as unknown as Document, request }
}

describe('requestShowFullscreen', () => {
  it('asks for full screen when the document is not full screen yet', () => {
    const { doc, request } = fakeDoc(null)
    requestShowFullscreen(false, doc)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not ask again when the shell already took full screen (no gesture left)', () => {
    const { doc, request } = fakeDoc({} as Element)
    requestShowFullscreen(false, doc)
    expect(request).not.toHaveBeenCalled()
  })

  it('skips HTML full screen on macOS', () => {
    const { doc, request } = fakeDoc(null)
    requestShowFullscreen(true, doc)
    expect(request).not.toHaveBeenCalled()
  })

  it('swallows a refused request and a browser without the API', async () => {
    const refused = {
      fullscreenElement: null,
      documentElement: { requestFullscreen: () => Promise.reject(new Error('refused')) },
    } as unknown as Document
    expect(() => requestShowFullscreen(false, refused)).not.toThrow()
    const bare = { fullscreenElement: null, documentElement: {} } as unknown as Document
    expect(() => requestShowFullscreen(false, bare)).not.toThrow()
    await Promise.resolve()
  })
})
