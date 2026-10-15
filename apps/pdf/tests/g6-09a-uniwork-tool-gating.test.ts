// G6-09a (UNI-1374) N1: PDF tool gating under UniWork AI (capability-gated edit tools) and
// for a UniWork-bound document (the file-level tools that save / rewrite the file). BYOK
// turns on a plain file keep everything. Every predicate is live (re-read per `tools` read).
import { describe, expect, it } from 'vitest'
import { createPdfSkill } from '../src/renderer/ai/pdf-skill'
import type { PdfAiDeps } from '../src/renderer/ai/tools'

const TEXT_EDIT = ['edit_text', 'edit_block', 'move_text_block', 'insert_text']
const IMAGE_EDIT = [
  'transform_image',
  'rotate_image',
  'replace_image',
  'flip_image',
  'set_image_opacity',
  'crop_image',
  'remove_image_background',
  'delete_image',
]
const FILE_LEVEL = [
  'insert_blank_page',
  'set_page_size',
  'crop_pages',
  'replace_pages',
  'extract_pages',
  'split_pdf',
  'split_pages',
  'merge_pages',
]

function makeDeps(over: Record<string, unknown> = {}): PdfAiDeps {
  const target: Record<string, unknown> = {
    fileName: () => 'doc.pdf',
    pageCount: () => 3,
    currentPage: () => 1,
    readOnly: () => false,
    imageGenAvailable: () => true,
    uniworkBound: () => false,
    uniworkAi: () => false,
    capability: () => true,
    ...over,
  }
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      return () => {
        throw new Error(`unexpected deps call: ${prop}`)
      }
    },
  }) as unknown as PdfAiDeps
}

const names = (deps: PdfAiDeps) => createPdfSkill(deps).tools.map((t) => t.name)

describe('pdf text / image edit tools by capability under UniWork AI', () => {
  it('hides the text-edit tools when pdfTextEdit is off', () => {
    const got = names(
      makeDeps({ uniworkAi: () => true, capability: (k: string) => k !== 'pdfTextEdit' }),
    )
    for (const n of TEXT_EDIT) expect(got).not.toContain(n)
    for (const n of IMAGE_EDIT) expect(got).toContain(n)
  })

  it('hides the image-edit tools when pdfImageEdit is off', () => {
    const got = names(
      makeDeps({ uniworkAi: () => true, capability: (k: string) => k !== 'pdfImageEdit' }),
    )
    for (const n of IMAGE_EDIT) expect(got).not.toContain(n)
    for (const n of TEXT_EDIT) expect(got).toContain(n)
  })

  it('keeps them when the capability is on', () => {
    const got = names(makeDeps({ uniworkAi: () => true, capability: () => true }))
    for (const n of [...TEXT_EDIT, ...IMAGE_EDIT]) expect(got).toContain(n)
  })

  it('a BYOK turn keeps them even with the capability off (unchanged behaviour)', () => {
    const got = names(makeDeps({ uniworkAi: () => false, capability: () => false }))
    for (const n of [...TEXT_EDIT, ...IMAGE_EDIT]) expect(got).toContain(n)
  })

  it('reads the provider and the capability live', () => {
    let uniwork = false
    let on = false
    const skill = createPdfSkill(makeDeps({ uniworkAi: () => uniwork, capability: () => on }))
    expect(skill.tools.map((t) => t.name)).toContain('edit_text')
    uniwork = true
    expect(skill.tools.map((t) => t.name)).not.toContain('edit_text')
    on = true
    expect(skill.tools.map((t) => t.name)).toContain('edit_text')
  })
})

describe('pdf file-level tools on a UniWork-bound document', () => {
  it('hides the eight file-level tools next to create_document', () => {
    const got = names(makeDeps({ uniworkBound: () => true }))
    for (const n of [...FILE_LEVEL, 'create_document']) expect(got).not.toContain(n)
    // pending, undoable edits stay
    expect(got).toContain('apply_ops')
    expect(got).toContain('read_pages')
  })

  it('keeps them on a plain local file', () => {
    const got = names(makeDeps({ uniworkBound: () => false }))
    for (const n of FILE_LEVEL) expect(got).toContain(n)
  })

  it('reads bound live', () => {
    let bound = false
    const skill = createPdfSkill(makeDeps({ uniworkBound: () => bound }))
    expect(skill.tools.map((t) => t.name)).toContain('split_pdf')
    bound = true
    expect(skill.tools.map((t) => t.name)).not.toContain('split_pdf')
  })

  it('the system prompt says the file-level tools are unavailable, live with bound', () => {
    let bound = true
    const skill = createPdfSkill(makeDeps({ uniworkBound: () => bound }))
    expect(skill.systemPrompt).toContain('file-level page tools are unavailable')
    bound = false
    expect(skill.systemPrompt).not.toContain('file-level page tools are unavailable')
  })
})

// RFA-1 (FE review r1): the hidden set must also be refused at execution time (a hallucinated,
// stale-history or injected call). The strict Proxy throws on any dep the refusal does not need,
// so a call that slips past the refusal fails the test instead of running.
describe('pdf executeTool refuses what `tools` hides', () => {
  const call = (name: string) => ({ id: 'c1', name, input: {} })
  const refused = async (deps: PdfAiDeps, name: string) => {
    const res = await createPdfSkill(deps).executeTool(call(name))
    expect(res.isError, name).toBe(true)
    expect(res.mutated, name).toBeFalsy()
    expect(res.output, name).toContain(`${name} is unavailable`)
  }

  it('refuses the eight file-level tools and create_document on a bound document', async () => {
    const deps = makeDeps({ uniworkBound: () => true })
    for (const n of [...FILE_LEVEL, 'create_document']) await refused(deps, n)
  })

  it('refuses text edits under UniWork AI with pdfTextEdit off', async () => {
    const deps = makeDeps({
      uniworkAi: () => true,
      capability: (k: string) => k !== 'pdfTextEdit',
    })
    for (const n of TEXT_EDIT) await refused(deps, n)
  })

  it('refuses image edits under UniWork AI with pdfImageEdit off', async () => {
    const deps = makeDeps({
      uniworkAi: () => true,
      capability: (k: string) => k !== 'pdfImageEdit',
    })
    for (const n of IMAGE_EDIT) await refused(deps, n)
  })

  it('refuses generate_image when the image model is off', async () => {
    await refused(makeDeps({ imageGenAvailable: () => false }), 'generate_image')
  })

  // the real executor needs deps the strict proxy does not provide: it may throw, but never refuse
  const outputOrError = async (skill: ReturnType<typeof createPdfSkill>, name: string) => {
    try {
      return (await skill.executeTool(call(name))).output
    } catch (err) {
      return String(err)
    }
  }

  it('does not refuse for BYOK on a plain file (capability off, not bound)', async () => {
    const skill = createPdfSkill(makeDeps({ uniworkAi: () => false, capability: () => false }))
    for (const n of ['edit_text', 'split_pdf'])
      expect(await outputOrError(skill, n), n).not.toContain(`${n} is unavailable`)
  })

  it('follows bound live', async () => {
    let bound = true
    const skill = createPdfSkill(makeDeps({ uniworkBound: () => bound }))
    expect(await outputOrError(skill, 'split_pdf')).toContain('split_pdf is unavailable')
    bound = false
    expect(await outputOrError(skill, 'split_pdf')).not.toContain('split_pdf is unavailable')
  })
})

// RFA-2: with the capability-hidden edit tools gone the model must not promise those edits.
describe('pdf system prompt notes capability-hidden edit tools', () => {
  it('names the text-edit tools when pdfTextEdit is off under UniWork AI', () => {
    const p = createPdfSkill(
      makeDeps({ uniworkAi: () => true, capability: (k: string) => k !== 'pdfTextEdit' }),
    ).systemPrompt
    expect(p).toContain('text-editing tools are unavailable')
    expect(p).not.toContain('image-editing tools are unavailable')
  })

  it('names the image-edit tools when pdfImageEdit is off under UniWork AI', () => {
    const p = createPdfSkill(
      makeDeps({ uniworkAi: () => true, capability: (k: string) => k !== 'pdfImageEdit' }),
    ).systemPrompt
    expect(p).toContain('image-editing tools are unavailable')
    expect(p).not.toContain('text-editing tools are unavailable')
  })

  it('stays silent for BYOK or when the capabilities are on, live', () => {
    let uniwork = true
    let on = true
    const skill = createPdfSkill(makeDeps({ uniworkAi: () => uniwork, capability: () => on }))
    expect(skill.systemPrompt).not.toContain('tools are unavailable')
    on = false
    expect(skill.systemPrompt).toContain('text-editing tools are unavailable')
    expect(skill.systemPrompt).toContain('image-editing tools are unavailable')
    uniwork = false
    expect(skill.systemPrompt).not.toContain('editing tools are unavailable')
  })
})
