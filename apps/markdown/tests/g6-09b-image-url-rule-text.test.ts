// G6-09b (UNI-1374) N3 fix r1 (RFN-1): under UniWork AI the markdown text-writing tools
// (write_document, apply_ops insertContent / replaceBlocks / insertImage) must not land an image
// reference to a remote or data: URL the run's image_search / generate_image never returned.
// Local md-asset / relative paths and images already in the document are unaffected; BYOK keeps
// today's rules.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createImageUrlRegistry, IMAGE_URL_REFUSAL } from '@genoffice/agent-core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import type { AiDocWriter } from '../src/renderer/ai/doc-writer'
import { executeTool, markDocSeen } from '../src/renderer/ai/tools'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  vi.unstubAllGlobals()
})

function createEditor(markdown: string): Editor {
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
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  markDocSeen(editor)
  editors.push(editor)
  return editor
}

const FOUND = 'https://img.example/found.png'
const STRANGER = 'https://img.example/stranger.png'
const DATA = 'data:image/png;base64,iVBORw0KGgo='

/** the same image written in each form the markdown parser accepts */
const FORMS: Record<string, (url: string) => string> = {
  'inline ![alt](url)': (u) => `before\n\n![alt text](${u})\n\nafter`,
  'inline with title': (u) => `![alt text](${u} "a title")`,
  'reference ![alt][id]': (u) => `![alt text][pic]\n\n[pic]: ${u}`,
  'raw <img src>': (u) => `<img src="${u}" alt="alt text">`,
  'raw <img> in a paragraph': (u) => `some words <img src='${u}'> more words`,
  'angle-bracket ![alt](<url>)': (u) => `![alt text](<${u}>)`,
  'newline inside the link': (u) => `![alt text](\n${u}\n)`,
  'HTML-entity scheme (<img>)': (u) => `<img src="${u.replace('h', '&#x68;')}" alt="alt text">`,
  'uppercase <IMG SRC>': (u) => `<IMG SRC="${u}" ALT="alt text">`,
}

function setup(uniwork: boolean, initial = 'Body') {
  vi.stubGlobal('markdownApi', {
    fetchImage: vi.fn(async () => null),
    saveImage: vi.fn(),
    imageSearch: async () => ({ method: 'ok', images: [{ imageUrl: FOUND, title: 't' }] }),
    aiGenerateImage: async () => ({ url: 'https://cdn.example/g.png' }),
  })
  const imageUrls = createImageUrlRegistry({ enforce: () => uniwork })
  const editor = createEditor(initial)
  const run = (name: string, input: Record<string, unknown>, writer?: AiDocWriter) =>
    executeTool(
      editor,
      { id: 't', name, input },
      undefined,
      undefined,
      writer,
      undefined,
      imageUrls,
    )
  const writerOf = (markdown: string): AiDocWriter => ({
    write: async (_spec, onProgress) => {
      onProgress(markdown)
      return { ok: true, markdown }
    },
  })
  const md = () => editor.markdown?.serialize(editor.getJSON()) ?? ''
  return { run, writerOf, imageUrls, editor, md }
}

describe.each(Object.entries(FORMS))('markdown text tools, %s, under UniWork AI', (_name, form) => {
  it('apply_ops insertContent refuses an unregistered URL and changes nothing', async () => {
    const { run, md } = setup(true)
    const before = md()
    const r = await run('apply_ops', {
      ops: [{ op: 'insertContent', after: 0, markdown: form(STRANGER) }],
    })
    expect(r.isError).toBe(true)
    expect(r.output).toContain(IMAGE_URL_REFUSAL)
    expect(r.mutated).toBeFalsy()
    expect(md()).toBe(before)
  })

  it('apply_ops replaceBlocks refuses an unregistered URL and changes nothing', async () => {
    const { run, md } = setup(true)
    const before = md()
    const r = await run('apply_ops', {
      ops: [{ op: 'replaceBlocks', target: { start: 0, end: 0 }, markdown: form(STRANGER) }],
    })
    expect(r.isError).toBe(true)
    expect(r.output).toContain(IMAGE_URL_REFUSAL)
    expect(md()).toBe(before)
  })

  it('write_document refuses an unregistered URL and changes nothing', async () => {
    const { run, writerOf, md } = setup(true)
    const before = md()
    const r = await run('write_document', { plan: 'p', afterIndex: 0 }, writerOf(form(STRANGER)))
    expect(r.isError).toBe(true)
    expect(r.output).toContain(IMAGE_URL_REFUSAL)
    expect(md()).toBe(before)
  })

  it('accepts the URL image_search returned this run', async () => {
    const { run, writerOf, md } = setup(true)
    await run('image_search', { query: 'cat' })
    const a = await run('apply_ops', {
      ops: [{ op: 'insertContent', after: 0, markdown: form(FOUND) }],
    })
    expect(a.isError).toBeFalsy()
    expect(md()).toContain(FOUND)
    const w = await run('write_document', { plan: 'p', afterIndex: 0 }, writerOf(form(FOUND)))
    expect(w.isError).toBeFalsy()
  })

  it('keeps today’s rules for BYOK', async () => {
    const { run, md } = setup(false)
    const r = await run('apply_ops', {
      ops: [{ op: 'insertContent', after: 0, markdown: form(STRANGER) }],
    })
    expect(r.isError).toBeFalsy()
    expect(md()).toContain(STRANGER)
  })
})

describe('markdown text tools under UniWork AI: other cases', () => {
  it('refuses a data: image that was not generated this run, accepts one that was', async () => {
    const { run, imageUrls } = setup(true)
    const ops = [{ op: 'insertContent', after: 0, markdown: `![d](${DATA})` }]
    const refused = await run('apply_ops', { ops })
    expect(refused.isError).toBe(true)
    expect(refused.output).toContain(IMAGE_URL_REFUSAL)
    imageUrls.register(DATA, 'generate_image')
    expect((await run('apply_ops', { ops })).isError).toBeFalsy()
  })

  it('refuses the whole batch when only one op carries an unregistered image', async () => {
    const { run, md } = setup(true)
    const before = md()
    const r = await run('apply_ops', {
      ops: [
        { op: 'insertContent', after: 0, markdown: 'plain new paragraph' },
        { op: 'insertContent', after: 0, markdown: `![x](${STRANGER})` },
      ],
    })
    expect(r.isError).toBe(true)
    expect(md()).toBe(before)
  })

  it('refuses an insertImage op with an unregistered remote src, accepts a registered one', async () => {
    const { run, imageUrls } = setup(true)
    const bad = await run('apply_ops', { ops: [{ op: 'insertImage', after: 0, src: STRANGER }] })
    expect(bad.isError).toBe(true)
    expect(bad.output).toContain(IMAGE_URL_REFUSAL)
    imageUrls.register(STRANGER, 'image_search')
    expect(
      (await run('apply_ops', { ops: [{ op: 'insertImage', after: 0, src: STRANGER }] })).isError,
    ).toBeFalsy()
  })

  it('does not touch local or relative image paths', async () => {
    const { run, md } = setup(true)
    const r = await run('apply_ops', {
      ops: [
        {
          op: 'insertContent',
          after: 0,
          markdown: '![a](assets/pic.png)\n\n![b](md-asset://x/y.png)',
        },
        { op: 'insertImage', after: 0, src: 'assets/other.png' },
      ],
    })
    expect(r.isError).toBeFalsy()
    expect(md()).toContain('assets/pic.png')
    expect(md()).toContain('assets/other.png')
  })

  it('leaves an image already in the document alone on an unrelated edit', async () => {
    const { run, md } = setup(true, `intro\n\n![old](${STRANGER})\n\noutro`)
    const edit = await run('apply_ops', {
      ops: [{ op: 'replaceBlocks', target: { start: 0, end: 0 }, markdown: 'new intro' }],
    })
    expect(edit.isError).toBeFalsy()
    expect(md()).toContain(STRANGER)
    // rewriting the block that holds it keeps it: the document already had that image
    const keep = await run('apply_ops', {
      ops: [
        {
          op: 'replaceBlocks',
          target: { start: 1, end: 1 },
          markdown: `![old caption](${STRANGER})`,
        },
      ],
    })
    expect(keep.isError).toBeFalsy()
    expect(md()).toContain(STRANGER)
  })

  it('does not refuse a text edit that only mentions a URL in prose', async () => {
    const { run } = setup(true)
    const r = await run('apply_ops', {
      ops: [{ op: 'insertContent', after: 0, markdown: `see ${STRANGER} for the picture` }],
    })
    expect(r.isError).toBeFalsy()
  })

  it('model-facing refusal carries no internal codes', async () => {
    const { run } = setup(true)
    const r = await run('apply_ops', {
      ops: [{ op: 'insertContent', after: 0, markdown: `![x](${STRANGER})` }],
    })
    expect(r.output).not.toMatch(/UNI-|G6-|N3|Q5/)
  })
})

describe('markdown text tools under UniWork AI: spellings that are not image references', () => {
  it('accepts a fenced block, inline code and an escaped bang that only mention an image', async () => {
    const { run, md } = setup(true)
    const r = await run('apply_ops', {
      ops: [
        {
          op: 'insertContent',
          after: 0,
          markdown: [
            'Write `![a](' + STRANGER + ')` to embed a picture.',
            '',
            '```md',
            `![a](${STRANGER})`,
            `<img src="${STRANGER}">`,
            '```',
            '',
            `an escaped one: \\![a](${STRANGER})`,
          ].join('\n'),
        },
      ],
    })
    expect(r.isError).toBeFalsy()
    expect(md()).toContain(STRANGER)
  })

  it('an entity-spelled scheme in markdown link syntax stays literal text, so no remote image lands', async () => {
    const { run, editor } = setup(true)
    const r = await run('apply_ops', {
      ops: [
        { op: 'insertContent', after: 0, markdown: `![a](${STRANGER.replace('h', '&#104;')})` },
      ],
    })
    expect(r.isError).toBeFalsy()
    const srcs: string[] = []
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') srcs.push(String(n.attrs.src))
    })
    expect(srcs.filter((src) => /^(?:https?:|data:|\/\/)/i.test(src.trim()))).toEqual([])
  })

  it('an <img srcset> never lands a remote image: refused or not kept, the document holds no such image', async () => {
    const { run, editor } = setup(true)
    await run('apply_ops', {
      ops: [
        {
          op: 'insertContent',
          after: 0,
          markdown: `<img srcset="${STRANGER} 2x" alt="a">\n\n<img src="${FOUND}" srcset="${STRANGER} 2x">`,
        },
      ],
    })
    const srcs: string[] = []
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') srcs.push(String(n.attrs.src))
    })
    expect(srcs).not.toContain(STRANGER)
    expect(JSON.stringify(editor.getJSON())).not.toContain(STRANGER)
  })
})

describe('write_document truncated fallback under UniWork AI', () => {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 400))

  /** a writer whose first tick renders `landing`, then the kept final text stops mid-placeholder so it no longer parses */
  function brokenTailWriter(landing: string): AiDocWriter {
    return {
      write: async (_spec, onProgress) => {
        onProgress(landing)
        await pause()
        const markdown = `${landing}\n\nand then {{na`
        onProgress(markdown)
        return { ok: true, markdown, truncated: true }
      },
    }
  }

  it('refuses when the prefix that lands carries an unregistered remote image', async () => {
    const { run, md } = setup(true, 'Body {{secret}}')
    const before = md()
    const r = await run(
      'write_document',
      { plan: 'p', afterIndex: 0 },
      brokenTailWriter(`{{secret}}\n\n![x](${STRANGER})`),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain(IMAGE_URL_REFUSAL)
    expect(md()).toBe(before)
  })

  it('lands the prefix when its image is registered', async () => {
    const { run, md } = setup(true, 'Body {{secret}}')
    await run('image_search', { query: 'cat' })
    const r = await run(
      'write_document',
      { plan: 'p', afterIndex: 0 },
      brokenTailWriter(`{{secret}}\n\n![x](${FOUND})`),
    )
    expect(r.isError).toBeFalsy()
    expect(md()).toContain(FOUND)
  })
})
