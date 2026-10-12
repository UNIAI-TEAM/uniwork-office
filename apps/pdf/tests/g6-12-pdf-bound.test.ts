// G6-12 (UNI-1366) C-BOUND: a UniWork-bound document must not get a tool that
// writes a file outside it. create_document is hidden from the model while the
// open PDF is bound, and still refuses if a stale call arrives. A plain local
// PDF keeps today's behaviour.
import { describe, expect, it, vi } from 'vitest'
import { createPdfSkill } from '../src/renderer/ai/pdf-skill'
import { executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'

function makeDeps(bound: boolean, over: Record<string, unknown> = {}): PdfAiDeps {
  const target: Record<string, unknown> = {
    fileName: () => 'doc.pdf',
    pageCount: () => 2,
    readOnly: () => false,
    imageGenAvailable: () => true,
    uniworkBound: () => bound,
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

const CREATE = {
  id: 'c1',
  name: 'create_document',
  input: { type: 'pdf', title: 'Summary', content: '<p>Hi</p>' },
}

describe('create_document on a UniWork-bound PDF', () => {
  it('is not offered to the model while bound, other tools stay', () => {
    const names = createPdfSkill(makeDeps(true)).tools.map((t) => t.name)
    expect(names).not.toContain('create_document')
    expect(names).toContain('markup_text')
    expect(names).toContain('generate_image')
  })

  it('refuses a stale call without writing anything (skill and executor)', async () => {
    const createDocument = vi.fn(async () => ({ ok: true as const, path: '/x/Summary.pdf' }))
    const deps = makeDeps(true, { createDocument })
    const viaSkill = await createPdfSkill(deps).executeTool(CREATE)
    expect(viaSkill.isError).toBe(true)
    expect(viaSkill.mutated).toBeFalsy()
    expect(viaSkill.output).toMatch(/UniWork/)
    const direct = await executePdfTool(deps, CREATE)
    expect(direct.isError).toBe(true)
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('keeps create_document for a plain local PDF', async () => {
    const createDocument = vi.fn(async () => ({ ok: true as const, path: '/x/Summary.pdf' }))
    const deps = makeDeps(false, { createDocument })
    expect(createPdfSkill(deps).tools.map((t) => t.name)).toContain('create_document')
    const r = await createPdfSkill(deps).executeTool(CREATE)
    expect(r.isError).toBeFalsy()
    expect(createDocument).toHaveBeenCalledOnce()
  })

  it('reads a host without the bound query as a plain local PDF', () => {
    const deps = makeDeps(false, { uniworkBound: undefined })
    expect(createPdfSkill(deps).tools.map((t) => t.name)).toContain('create_document')
  })
})
