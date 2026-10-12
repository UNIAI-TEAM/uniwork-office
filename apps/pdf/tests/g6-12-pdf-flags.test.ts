// G6-12 (UNI-1366): pdf generate_image and create_document do not change the
// open document (the first only returns a URL, the second writes a NEW file), so
// they declare mutated: false. A stray true would mark the open PDF dirty.
import { describe, expect, it, vi } from 'vitest'
import { executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'

function makeDeps(over: Record<string, unknown>): PdfAiDeps {
  const target: Record<string, unknown> = {
    fileName: () => 'doc.pdf',
    pageCount: () => 2,
    readOnly: () => false,
    uniworkBound: () => false,
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

const call = (name: string, input: Record<string, unknown>) => ({ id: 'c1', name, input })

describe('pdf generate_image declares mutated: false', () => {
  it('on a generated URL', async () => {
    const deps = makeDeps({ generateImage: async () => ({ url: 'https://img.example/a.png' }) })
    const r = await executePdfTool(deps, call('generate_image', { prompt: 'a red fox' }))
    expect(r.isError).toBeFalsy()
    expect(r.output).toContain('https://img.example/a.png')
    expect(r.mutated).toBe(false)
  })
})

describe('pdf create_document declares mutated: false', () => {
  it('for the open document when the new file is written', async () => {
    const createDocument = vi.fn(async () => ({ ok: true as const, path: '/docs/Summary.pdf' }))
    const r = await executePdfTool(
      makeDeps({ createDocument }),
      call('create_document', { type: 'pdf', title: 'Summary', content: '<p>Hi</p>' }),
    )
    expect(createDocument).toHaveBeenCalledOnce()
    expect(r.isError).toBeFalsy()
    expect(r.mutated).toBe(false)
  })
})
