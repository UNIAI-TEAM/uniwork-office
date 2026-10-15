// G6-09b (UNI-1374) N3: under UniWork AI the docs insert_image / insert_picture / set_watermark
// tools accept only an image URL this run's image_search / generate_image returned (signed policy
// Q5). BYOK keeps today's rules (the registry still records). The fetch guard is untouched.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createImageUrlRegistry, IMAGE_URL_REFUSAL } from '@genoffice/agent-core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createDocsSkill } from '../src/renderer/ai/docs-skill'
import { executeTool, type AiDocExtras } from '../src/renderer/ai/tools'

const editors = new Set<Editor>()
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
})

function createEditor(): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [{ type: 'text', text: 'x' }],
        },
      ],
    },
  })
  editors.add(editor)
  return editor
}

const NUM_IDS = { bullet: null, ordered: null }
const FOUND = 'https://img.example/found.png'
const GENERATED = 'https://cdn.example/generated/g1.png'
const STRANGER = 'https://img.example/stranger.png'

function setup(uniwork: boolean) {
  const fetchImage = vi.fn(async (_url: string) => null)
  const desktop = {
    fetchImage,
    imageSearch: async () => ({ method: 'ok', images: [{ imageUrl: FOUND, title: 't' }] }),
    aiGenerateImage: async () => ({ url: GENERATED }),
  }
  const imageUrls = createImageUrlRegistry({ enforce: () => uniwork })
  const watermarkSet = vi.fn(() => null)
  const extras = { watermark: { set: watermarkSet } } as unknown as AiDocExtras
  const editor = createEditor()
  const run = async (name: string, input: Record<string, unknown>) => {
    const w = window as unknown as { desktop?: unknown }
    const saved = w.desktop
    w.desktop = desktop
    try {
      return await executeTool(
        editor,
        { id: 't', name, input },
        NUM_IDS,
        undefined,
        undefined,
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        extras,
        undefined,
        undefined,
        imageUrls,
      )
    } finally {
      w.desktop = saved
    }
  }
  return { run, fetchImage, imageUrls, watermarkSet }
}

const TOOLS: ReadonlyArray<readonly [string, (url: string) => Record<string, unknown>]> = [
  ['insert_image', (url) => ({ url })],
  ['insert_picture', (url) => ({ url })],
  ['set_watermark', (image) => ({ image })],
]

describe('docs image URL rule under UniWork AI', () => {
  it.each(TOOLS)('%s refuses an unregistered URL and fetches nothing', async (name, input) => {
    const { run, fetchImage, watermarkSet } = setup(true)
    const r = await run(name, input(STRANGER))
    expect(r.isError).toBe(true)
    expect(r.mutated).toBeFalsy()
    expect(r.output).toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).not.toHaveBeenCalled()
    expect(watermarkSet).not.toHaveBeenCalled()
  })

  it.each(TOOLS)('%s refuses an unregistered data: URL', async (name, input) => {
    const { run, fetchImage } = setup(true)
    // set_watermark and insert_picture take data: URLs today; insert_image never did
    const r = await run(name, input('data:image/png;base64,iVBORw0KGgo='))
    expect(r.isError).toBe(true)
    if (name !== 'insert_image') expect(r.output).toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it.each(TOOLS)('%s accepts a URL image_search returned this run', async (name, input) => {
    const { run, fetchImage } = setup(true)
    await run('image_search', { query: 'cat' })
    const r = await run(name, input(FOUND))
    expect(r.output).not.toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).toHaveBeenCalledWith(FOUND)
  })

  it.each(TOOLS)('%s accepts a URL generate_image returned this run', async (name, input) => {
    const { run, fetchImage, imageUrls } = setup(true)
    await run('generate_image', { prompt: 'a fox' })
    expect(imageUrls.isAllowed(GENERATED)).toBe(true)
    fetchImage.mockClear()
    const r = await run(name, input(GENERATED))
    expect(r.output).not.toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).toHaveBeenCalledWith(GENERATED)
  })

  it('accepts an image the user attached to the chat (registered at run start)', async () => {
    const imageUrls = createImageUrlRegistry({
      enforce: () => true,
      attachments: () => ['/chat/logo.png'],
    })
    imageUrls.beginRun()
    expect(imageUrls.isAllowed('/chat/logo.png')).toBe(true)
  })

  it.each(TOOLS)('%s refuses a URL from a PREVIOUS run', async (name, input) => {
    const { run, fetchImage, imageUrls } = setup(true)
    await run('image_search', { query: 'cat' })
    imageUrls.beginRun()
    const r = await run(name, input(FOUND))
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

  it('begins a new run from the skill context (one buildContext per loop.run)', async () => {
    const imageUrls = createImageUrlRegistry({ enforce: () => true })
    const editor = createEditor()
    const skill = createDocsSkill(
      () => editor,
      () => NUM_IDS,
      ...Array<undefined>(13),
      imageUrls,
    )
    imageUrls.register(FOUND, 'image_search')
    skill.buildContext?.()
    expect(imageUrls.isAllowed(FOUND)).toBe(false)
  })
})

describe('docs image URL rule for BYOK', () => {
  it.each(TOOLS)("%s keeps today's rules: an unregistered URL is fetched", async (name, input) => {
    const { run, fetchImage } = setup(false)
    const r = await run(name, input(STRANGER))
    expect(r.output).not.toBe(IMAGE_URL_REFUSAL)
    expect(fetchImage).toHaveBeenCalledWith(STRANGER)
  })

  it('still records what image_search returned', async () => {
    const { run, imageUrls } = setup(false)
    await run('image_search', { query: 'cat' })
    expect(imageUrls.isAllowed(FOUND)).toBe(true)
  })
})
