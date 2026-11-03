// G6-09b (UNI-1374) N3: the slides image tools. Under UniWork AI insert_web_image / replace_image are
// not offered at all (G6-09a) and executeTool refuses them, so no URL can reach them; the registry
// still records what image_search / generate_image returned (so the rule is one place for every app).
// BYOK keeps today's rules: it does NOT enforce, an unregistered URL is inserted as before.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageUrlRegistry } from '@genoffice/agent-core'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'

afterEach(() => vi.unstubAllGlobals())

const FOUND = 'https://img.example/found.png'
const GENERATED = 'file:///store/generated/g1.png'
const STRANGER = 'https://img.example/stranger.png'

function setup(uniwork: boolean, pictureTools = false) {
  const imageUrls = createImageUrlRegistry({ enforce: () => uniwork })
  const insertImageUrl = vi.fn(async (_args: unknown) => ({ slide: {}, sourceId: 's1' }))
  vi.stubGlobal('slidesApi', {
    imageSearch: async () => ({ method: 'ok', images: [{ imageUrl: FOUND, title: 't' }] }),
    generateImage: async () => ({ url: GENERATED }),
    insertImageUrl,
  })
  const access = {
    getSlides: () => [{ nodes: [] }],
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 1280,
    uniworkAi: () => uniwork,
    pictureTools: () => pictureTools,
    imageUrls,
  } as unknown as DeckAccess
  const skill = createSlidesSkill(access)
  const run = (name: string, input: Record<string, unknown>) =>
    skill.executeTool({ id: 'c', name, input })
  return { skill, run, imageUrls, insertImageUrl }
}

const insert = (url: string) => ({ slideIndex: 0, url, x: 0, y: 0, w: 100, h: 100 })

describe('slides image URL rule under UniWork AI', () => {
  it('records the URLs image_search and generate_image return', async () => {
    const { run, imageUrls } = setup(true)
    await run('image_search', { query: 'cat' })
    await run('generate_image', { prompt: 'a fox' })
    expect(imageUrls.isAllowed(FOUND)).toBe(true)
    expect(imageUrls.isAllowed(GENERATED)).toBe(true)
  })

  it('still refuses insert_web_image / replace_image outright, registered URL or not', async () => {
    const { run, insertImageUrl } = setup(true)
    await run('image_search', { query: 'cat' })
    for (const url of [FOUND, STRANGER]) {
      const r = await run('insert_web_image', insert(url))
      expect(r.isError).toBe(true)
      expect(r.output).toContain('insert_web_image is unavailable')
    }
    expect(insertImageUrl).not.toHaveBeenCalled()
  })

  it('begins a new run from the skill context (one buildContext per loop.run)', async () => {
    const { skill, run, imageUrls } = setup(true)
    await run('image_search', { query: 'cat' })
    skill.buildContext?.()
    expect(imageUrls.isAllowed(FOUND)).toBe(false)
  })
})

describe('slides image URL rule for BYOK', () => {
  it("keeps today's rules: insert_web_image takes an unregistered URL", async () => {
    const { run, insertImageUrl } = setup(false)
    const r = await run('insert_web_image', insert(STRANGER))
    expect(r.isError).toBeFalsy()
    expect(insertImageUrl).toHaveBeenCalledTimes(1)
  })

  it('still records what image_search returned', async () => {
    const { run, imageUrls } = setup(false)
    await run('image_search', { query: 'cat' })
    expect(imageUrls.isAllowed(FOUND)).toBe(true)
  })
})

// ADR 0054 (UniWork repo): on the desktop app (pictureTools) a UniWork AI turn gets the picture tools
// back, and they take only a URL this run's image_search / generate_image returned.
describe('slides picture tools on the desktop under UniWork AI', () => {
  it('offers insert_web_image, replace_image and save_style_template where the host has them', () => {
    const { skill } = setup(true, true)
    const names = skill.tools.map((tool) => tool.name)
    for (const n of ['insert_web_image', 'replace_image', 'save_style_template']) expect(names).toContain(n)
    expect(skill.systemPrompt).not.toContain('are not available here')
  })

  it('inserts a URL the run found or generated', async () => {
    const { run, insertImageUrl } = setup(true, true)
    await run('image_search', { query: 'cat' })
    await run('generate_image', { prompt: 'a fox' })
    for (const url of [FOUND, GENERATED]) expect((await run('insert_web_image', insert(url))).isError).toBeFalsy()
    expect(insertImageUrl).toHaveBeenCalledTimes(2)
  })

  it('refuses a URL the run did not return, before any download', async () => {
    const { run, insertImageUrl } = setup(true, true)
    await run('image_search', { query: 'cat' })
    const r = await run('insert_web_image', insert(STRANGER))
    expect(r.isError).toBe(true)
    expect(r.output).toContain('This image URL was not accepted')
    const replaced = await run('replace_image', { slideIndex: 0, sourceId: 'p1', url: STRANGER })
    expect(replaced.isError).toBe(true)
    expect(insertImageUrl).not.toHaveBeenCalled()
  })
})
