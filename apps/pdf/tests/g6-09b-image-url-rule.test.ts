// G6-09b (UNI-1374) N3: under UniWork AI the pdf insert_image / replace_image tools accept only an
// image URL this run's image_search / generate_image returned (signed policy Q5). BYOK keeps
// today's rules (the registry still records). The SSRF guard + byte cap behind fetchImage are
// untouched (g6-12-pdf-fetch-guard.test.ts).
import { describe, expect, it, vi } from 'vitest'
import { createImageUrlRegistry, IMAGE_URL_REFUSAL } from '@genoffice/agent-core'
import { createPdfSkill } from '../src/renderer/ai/pdf-skill'
import { executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'

const FOUND = 'https://img.example/found.png'
const GENERATED = 'file:///store/generated/g1.png'
const STRANGER = 'https://img.example/stranger.png'

function makeDeps(opts: { uniwork: boolean; images?: readonly string[]; generated?: string }) {
  const fetchImage = vi.fn(async () => ({ png: 'AAAA', width: 200, height: 100 }))
  const insertImage = vi.fn()
  const replaceImage = vi.fn()
  const imageUrls = createImageUrlRegistry({ enforce: () => opts.uniwork })
  const target: Record<string, unknown> = {
    readOnly: () => false,
    pageCount: () => 1,
    pageGeom: () => ({ pw: 600, ph: 800, rot: 0 }),
    listImages: async () => [{ pageIndex: 0, rect: [10, 10, 110, 110], aboveText: true }],
    isImageClaimed: () => false,
    isDeleted: () => false,
    gotoPage: vi.fn(() => true),
    searchImages: async () => ({
      method: 'ok',
      images: (opts.images ?? [FOUND]).map((imageUrl) => ({ imageUrl, title: 't' })),
    }),
    generateImage: async () => ({ url: opts.generated ?? GENERATED }),
    uniworkAi: () => opts.uniwork,
    imageUrls,
    fetchImage,
    insertImage,
    replaceImage,
  }
  const deps = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      return () => {
        throw new Error(`unexpected deps call: ${prop}`)
      }
    },
  }) as unknown as PdfAiDeps
  return { deps, fetchImage, insertImage, replaceImage, imageUrls }
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 'c1', name, input })
const insert = (url: string) => call('insert_image', { page: 1, url })
const replace = (url: string) => call('replace_image', { page: 1, image_number: 1, url })

describe('pdf image URL rule under UniWork AI', () => {
  it.each([
    ['insert_image', insert],
    ['replace_image', replace],
  ] as const)('%s refuses an unregistered URL and fetches nothing', async (_n, make) => {
    const { deps, fetchImage, insertImage, replaceImage } = makeDeps({ uniwork: true })
    const r = await executePdfTool(deps, make(STRANGER))
    expect(r.isError).toBe(true)
    expect(r.output).toBe(IMAGE_URL_REFUSAL)
    expect(r.output).toContain('image_search')
    expect(fetchImage).not.toHaveBeenCalled()
    expect(insertImage).not.toHaveBeenCalled()
    expect(replaceImage).not.toHaveBeenCalled()
  })

  it.each([
    ['insert_image', insert],
    ['replace_image', replace],
  ] as const)('%s accepts a URL image_search returned this run', async (_n, make) => {
    const { deps, fetchImage } = makeDeps({ uniwork: true })
    await executePdfTool(deps, call('image_search', { query: 'cat' }))
    const r = await executePdfTool(deps, make(FOUND))
    expect(r.isError).toBeFalsy()
    expect(fetchImage).toHaveBeenCalledWith(FOUND)
  })

  it('insert_image accepts the URL generate_image returned this run', async () => {
    const { deps, fetchImage, insertImage } = makeDeps({ uniwork: true })
    await executePdfTool(deps, call('generate_image', { prompt: 'a fox' }))
    const r = await executePdfTool(deps, insert(GENERATED))
    expect(r.isError).toBeFalsy()
    expect(fetchImage).toHaveBeenCalledWith(GENERATED)
    expect(insertImage).toHaveBeenCalled()
  })

  it('refuses a URL image_search returned in a PREVIOUS run', async () => {
    const { deps, fetchImage, imageUrls } = makeDeps({ uniwork: true })
    await executePdfTool(deps, call('image_search', { query: 'cat' }))
    imageUrls.beginRun() // the next user request
    const r = await executePdfTool(deps, insert(FOUND))
    expect(r.isError).toBe(true)
    expect(r.output).toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('does not let a registered URL vouch for a different one', async () => {
    const { deps, fetchImage } = makeDeps({ uniwork: true })
    await executePdfTool(deps, call('image_search', { query: 'cat' }))
    for (const url of [`${FOUND}?x=1`, 'https://img.example/found.pn', FOUND.toUpperCase()]) {
      const r = await executePdfTool(deps, insert(url))
      expect(r.isError, url).toBe(true)
    }
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('keeps the shape errors first (a non-URL is still "invalid url")', async () => {
    const { deps } = makeDeps({ uniwork: true })
    const r = await executePdfTool(deps, insert('/etc/passwd'))
    expect(r.isError).toBe(true)
    expect(r.output).toContain('invalid url')
  })

  it('begins a new run from the skill context (one buildContext per loop.run)', async () => {
    const { deps, imageUrls } = makeDeps({ uniwork: true })
    Object.assign(deps, {
      fileName: () => 'a.pdf',
      currentPage: () => 1,
      outline: () => null,
      metadata: () => ({}),
      annotationSummary: () => '',
      pendingSummary: () => '',
      selection: () => null,
    })
    const skill = createPdfSkill(deps)
    await executePdfTool(deps, call('image_search', { query: 'cat' }))
    expect(imageUrls.isAllowed(FOUND)).toBe(true)
    skill.buildContext?.()
    expect(imageUrls.isAllowed(FOUND)).toBe(false)
  })
})

describe('pdf image URL rule for BYOK', () => {
  it.each([
    ['insert_image', insert],
    ['replace_image', replace],
  ] as const)("%s keeps today's rules: an unregistered URL is fetched", async (_n, make) => {
    const { deps, fetchImage } = makeDeps({ uniwork: false })
    const r = await executePdfTool(deps, make(STRANGER))
    expect(r.isError).toBeFalsy()
    expect(fetchImage).toHaveBeenCalledWith(STRANGER)
  })

  it('still records what image_search returned', async () => {
    const { deps, imageUrls } = makeDeps({ uniwork: false })
    await executePdfTool(deps, call('image_search', { query: 'cat' }))
    expect(imageUrls.isAllowed(FOUND)).toBe(true)
  })

  it('runs without any registry (hosts that pass none)', async () => {
    const { deps, fetchImage } = makeDeps({ uniwork: true })
    Object.assign(deps, { imageUrls: undefined })
    const r = await executePdfTool(deps, insert(STRANGER))
    expect(r.isError).toBeFalsy()
    expect(fetchImage).toHaveBeenCalled()
  })
})
