// @vitest-environment jsdom
/**
 * UNI-2276 (plan 5): generate_deck / regenerate_slide on the web Slides frame. The frame builds
 * a page the AI wrote as a JSON spec into a one-slide pptx it keeps in memory, and lands it in
 * the open document through the session core the desktop uses too
 * (src/session/generated-pages.ts). Nothing is drafted: the pages stay unsaved in the document.
 * Remote pictures are skipped (the frame CSP allows no fetch outside its origin): the page still
 * lands and names them in imageFailures.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGeneratedPageStore, sessionDirty, sessions } from '../src/session'
import { createMockPort } from '../../../web/docs/bridge/testing/mock-port'
import { SLIDES_WEB_CAPABILITIES } from '../../../web/modules/slides/capabilities'
import { WEB_CLIENT_ID, createWebSlidesApi } from '../../../web/modules/slides/web-slides-api'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = new Uint8Array(
  readFileSync(join(here, '..', '..', '..', 'web', 'fixtures', 'sample.pptx')),
)
const FIT = 1280

function spec(text: string, extra: unknown[] = []): string {
  return JSON.stringify({
    background: '#102030',
    elements: [
      {
        type: 'text',
        x: 80,
        y: 80,
        w: 800,
        h: 60,
        paragraphs: [{ runs: [{ text, sizePt: 24 }] }],
      },
      ...extra,
    ],
  })
}

async function frame(capabilities: Record<string, unknown> = { save: true, saveAs: true }) {
  const mock = createMockPort()
  const file = mock.seed('deck.pptx', FIXTURE)
  const { slidesApi: api } = createWebSlidesApi({
    client: mock.port,
    capabilities: { ...SLIDES_WEB_CAPABILITIES, ...capabilities },
  })
  mock.init({ documentId: file.fileId })
  const opened = await api.consumePendingOpen(FIT)
  if (!opened) throw new Error('the frame did not open the document')
  return { api, count: opened.slides.length, path: sessions.get(WEB_CLIENT_ID)!.path }
}

type Api = Awaited<ReturnType<typeof frame>>['api']

async function page(api: Api, text: string): Promise<string> {
  const r = await api.localGeneratePage({ specJson: spec(text) })
  if (!r.ok || !r.marker) throw new Error(`page generation failed: ${r.error}`)
  return r.marker
}

/** a page's laid-out text (one-word texts: the layout splits glyph spans at spaces) */
const slideText = (slide: unknown) => JSON.stringify(slide)

afterEach(() => {
  vi.restoreAllMocks()
  sessions.clear()
})

describe('createGeneratedPageStore', () => {
  it('keeps a page redeemable after a landing (the retry round lands a marker again) and drops the oldest past its cap', () => {
    const store = createGeneratedPageStore()
    const first = store.put(new Uint8Array([1]))
    expect(store.take(first)).toEqual(new Uint8Array([1]))
    expect(store.take(first)).toEqual(new Uint8Array([1]))
    expect(store.take('localpptx:never-issued')).toBeNull()
    for (let i = 0; i < 256; i++) store.put(new Uint8Array([2]))
    expect(store.take(first)).toBeNull()
  })
})

describe('web frame: localGeneratePage', () => {
  it('builds a valid spec into a page and answers its marker', async () => {
    const { api } = await frame()
    const r = await api.localGeneratePage({ specJson: spec('Quarterly results') })
    expect(r.ok).toBe(true)
    expect(r.marker).toMatch(/^localpptx:/)
    expect(r.imageFailures).toBeUndefined()
  })

  it('refuses a spec that is not one', async () => {
    const { api } = await frame()
    const r = await api.localGeneratePage({ specJson: 'no json here' })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('skips a remote picture without fetching it: the page lands, imageFailures names it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { api, count } = await frame()
    const url = 'https://images.example.com/photo.jpg'
    const r = await api.localGeneratePage({
      specJson: spec('PhotoPage', [{ type: 'image', url, x: 660, y: 80, w: 540, h: 560 }]),
    })
    expect(r.ok).toBe(true)
    expect(r.imageFailures).toEqual([url])
    expect(fetchSpy).not.toHaveBeenCalled()
    const landed = await api.landGeneratedPages([r.marker!], FIT, 'append')
    expect('error' in landed).toBe(false)
    if ('error' in landed) return
    expect(landed.slides).toHaveLength(count + 1)
    expect(slideText(landed.slides[count])).toContain('PhotoPage')
  })
})

describe('web frame: landGeneratedPages', () => {
  it('append adds the page after the deck and reports where it started', async () => {
    const { api, count, path } = await frame()
    const marker = await page(api, 'AppendedPage')
    const r = await api.landGeneratedPages([marker], FIT, 'append')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.slides).toHaveLength(count + 1)
    expect(r.appendedFrom).toBe(count)
    expect(slideText(r.slides[count])).toContain('AppendedPage')
    // no draft: the panel takes no path change and the document stays the same, unsaved
    expect(r.path).toBe('')
    const session = sessions.get(WEB_CLIENT_ID)!
    expect(session.path).toBe(path)
    expect(sessionDirty(session)).toBe(true)
  })

  it('replace_at redoes one page in place', async () => {
    const { api, count } = await frame()
    const marker = await page(api, 'RedonePage')
    const r = await api.landGeneratedPages([marker], FIT, 'replace_at', 1)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.slides).toHaveLength(count)
    expect(r.replacedIndex).toBe(1)
    expect(slideText(r.slides[1])).toContain('RedonePage')
  })

  it('insert_at puts one page at its index and shifts the rest', async () => {
    const { api, count } = await frame()
    const marker = await page(api, 'InsertedPage')
    const r = await api.landGeneratedPages([marker], FIT, 'insert_at', 2)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.slides).toHaveLength(count + 1)
    expect(r.insertedIndex).toBe(2)
    expect(slideText(r.slides[2])).toContain('InsertedPage')
  })

  it('replace makes the pages the new deck of the same document, unsaved', async () => {
    const { api, path } = await frame()
    const before = sessions.get(WEB_CLIENT_ID)
    const markers = [await page(api, 'FirstNewPage'), await page(api, 'SecondNewPage')]
    const r = await api.landGeneratedPages(markers, FIT, 'replace')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.slides).toHaveLength(2)
    expect(r.path).toBe('')
    const now = sessions.get(WEB_CLIENT_ID)!
    expect(now).not.toBe(before)
    expect(now.path).toBe(path)
    expect(sessionDirty(now)).toBe(true)
    expect(slideText(r.slides[1])).toContain('SecondNewPage')
  })

  it('refuses a marker the frame did not issue and leaves the deck alone', async () => {
    const { api, count } = await frame()
    const forged = 'localpptx:00000000-0000-4000-8000-000000000000'
    const at = await api.landGeneratedPages([forged], FIT, 'replace_at', 0)
    expect(at).toHaveProperty('error')
    const appended = await api.landGeneratedPages([forged], FIT, 'append')
    expect(appended).toHaveProperty('error')
    expect(sessions.get(WEB_CLIENT_ID)!.opened.deck.slides).toHaveLength(count)
  })

  it('a view-only frame never lands a page', async () => {
    const { api, count } = await frame({ save: false })
    const marker = await page(api, 'Not for a view-only deck')
    const r = await api.landGeneratedPages([marker], FIT, 'append')
    expect(r).toHaveProperty('error')
    expect(sessions.get(WEB_CLIENT_ID)!.opened.deck.slides).toHaveLength(count)
  })
})
