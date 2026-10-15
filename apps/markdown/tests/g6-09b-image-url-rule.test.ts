// G6-09b (UNI-1374) N3: under UniWork AI the markdown insert_image tool accepts only an image URL
// this run's image_search / generate_image returned (signed policy Q5). BYOK keeps today's rules
// (the registry still records). The fetch guard is untouched (g6-12-url-fetch-guard.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createImageUrlRegistry, IMAGE_URL_REFUSAL } from '@genoffice/agent-core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { createMarkdownSkill } from '../src/renderer/ai/markdown-skill'
import { executeTool, markDocSeen } from '../src/renderer/ai/tools'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  vi.unstubAllGlobals()
})

function createEditor(): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: {
        onOpen: () => {},
        onUpdate: () => {},
        onKeyDown: () => false,
        onClose: () => {},
      },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent('Body', { contentType: 'markdown' })
  markDocSeen(editor)
  editors.push(editor)
  return editor
}

const FOUND = 'https://img.example/found.png'
const GENERATED = 'https://cdn.example/generated/g1.png'
const STRANGER = 'https://img.example/stranger.png'

function setup(uniwork: boolean) {
  const fetchImage = vi.fn(async (_url: string) => null)
  vi.stubGlobal('markdownApi', {
    fetchImage,
    saveImage: vi.fn(),
    imageSearch: async () => ({ method: 'ok', images: [{ imageUrl: FOUND, title: 't' }] }),
    aiGenerateImage: async () => ({ url: GENERATED }),
  })
  const imageUrls = createImageUrlRegistry({ enforce: () => uniwork })
  const editor = createEditor()
  const run = (name: string, input: Record<string, unknown>) =>
    executeTool(
      editor,
      { id: 't', name, input },
      undefined,
      undefined,
      undefined,
      undefined,
      imageUrls,
    )
  return { run, fetchImage, imageUrls, editor }
}

describe('markdown image URL rule under UniWork AI', () => {
  it('insert_image refuses an unregistered URL and fetches nothing', async () => {
    const { run, fetchImage } = setup(true)
    const r = await run('insert_image', { url: STRANGER })
    expect(r.isError).toBe(true)
    expect(r.output).toBe(IMAGE_URL_REFUSAL)
    expect(r.output).toContain('image_search')
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('insert_image accepts a URL image_search returned this run', async () => {
    const { run, fetchImage } = setup(true)
    await run('image_search', { query: 'cat' })
    const r = await run('insert_image', { url: FOUND })
    expect(r.output).not.toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).toHaveBeenCalledWith(FOUND)
  })

  it('insert_image accepts the URL generate_image returned this run', async () => {
    const { run, fetchImage, imageUrls } = setup(true)
    await run('generate_image', { prompt: 'a fox' })
    expect(imageUrls.isAllowed(GENERATED)).toBe(true)
    fetchImage.mockClear()
    const r = await run('insert_image', { url: GENERATED })
    expect(r.output).not.toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).toHaveBeenCalledWith(GENERATED)
  })

  it('insert_image refuses a URL from a PREVIOUS run', async () => {
    const { run, fetchImage, imageUrls } = setup(true)
    await run('image_search', { query: 'cat' })
    imageUrls.beginRun()
    const r = await run('insert_image', { url: FOUND })
    expect(r.isError).toBe(true)
    expect(r.output).toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('keeps the shape error first for a non-URL', async () => {
    const { run } = setup(true)
    const r = await run('insert_image', { url: '/etc/passwd' })
    expect(r.isError).toBe(true)
    expect(r.output).toBe('invalid url')
  })

  it('begins a new run from the skill context (one buildContext per loop.run)', () => {
    const { imageUrls, editor } = setup(true)
    const skill = createMarkdownSkill(
      () => editor,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      imageUrls,
    )
    imageUrls.register(FOUND, 'image_search')
    skill.buildContext?.()
    expect(imageUrls.isAllowed(FOUND)).toBe(false)
  })
})

describe('markdown image URL rule for BYOK', () => {
  it("insert_image keeps today's rules: an unregistered URL is fetched", async () => {
    const { run, fetchImage } = setup(false)
    const r = await run('insert_image', { url: STRANGER })
    expect(r.output).not.toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).toHaveBeenCalledWith(STRANGER)
  })

  it('still records what image_search returned', async () => {
    const { run, imageUrls } = setup(false)
    await run('image_search', { query: 'cat' })
    expect(imageUrls.isAllowed(FOUND)).toBe(true)
  })
})
