// UNI-1919: a PDF open in the web frame IS the UniWork document, so the AI
// must see it as bound even though the web adapter keeps answering
// `uniworkState.bound: false` for working-copy semantics (web save, comments
// and the Save button are keyed off that answer and must not change). The
// seam is `pdfUniworkBoundForAi`: App.tsx feeds the skill's `uniworkBound`
// through it (`uniwork.bound || platform() === 'web'`).
import { afterEach, describe, expect, it } from 'vitest'
import type { PdfUniworkState } from '../src/shared/ipc'
import { resetForTest } from '../src/renderer/capabilities'
import { pdfUniworkBoundForAi, queryPdfUniworkState } from '../src/renderer/uniwork-state'
import { createPdfSkill } from '../src/renderer/ai/pdf-skill'
import type { PdfAiDeps } from '../src/renderer/ai/tools'

const FILE_LEVEL = [
  'insert_blank_page',
  'set_page_size',
  'crop_pages',
  'replace_pages',
  'extract_pages',
  'split_pdf',
  'split_pages',
  'merge_pages',
  'create_document',
]

/** the web adapter's answer (web/modules/pdf/webapi.ts uniworkState) for an editable frame */
const WEB_EDITABLE: PdfUniworkState = { bound: false, readOnly: false }

/** build the skill deps the way App.tsx does: `uniworkBound` is pdfUniworkBoundForAi(state) */
function makeDeps(state: PdfUniworkState, over: Record<string, unknown> = {}): PdfAiDeps {
  const target: Record<string, unknown> = {
    fileName: () => 'doc.pdf',
    pageCount: () => 2,
    readOnly: () => state.readOnly,
    imageGenAvailable: () => true,
    uniworkBound: () => pdfUniworkBoundForAi(state),
    uniworkAi: () => false,
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

function installWebCaps() {
  window.pdfApi = { capabilities: { platform: 'web' } } as never
  resetForTest()
}

afterEach(() => {
  delete (window as Record<string, unknown>).pdfApi
  resetForTest()
})

describe('the web PDF frame is UniWork-bound for the AI', () => {
  it('offers no file-level tool even though the adapter keeps bound: false', () => {
    installWebCaps()
    const skill = createPdfSkill(makeDeps(WEB_EDITABLE))
    const names = skill.tools.map((t) => t.name)
    for (const n of FILE_LEVEL) expect(names).not.toContain(n)
    expect(names).toContain('apply_ops')
    expect(skill.systemPrompt).toContain('file-level page tools are unavailable')
  })

  it('refuses a forced file-level call with the bound wording', async () => {
    installWebCaps()
    const skill = createPdfSkill(makeDeps(WEB_EDITABLE))
    for (const name of ['insert_blank_page', 'split_pdf', 'create_document']) {
      const r = await skill.executeTool({ id: 't1', name, input: {} })
      expect(r.isError).toBe(true)
      expect(r.mutated).toBeFalsy()
      expect(r.output).toMatch(/UniWork/)
    }
  })

  it('desktop keeps the adapter answer verbatim (unbound offers the tools, bound hides them)', async () => {
    window.pdfApi = { capabilities: {} } as never
    resetForTest()
    const unbound = createPdfSkill(makeDeps({ bound: false, readOnly: false }))
    expect(unbound.tools.map((t) => t.name)).toContain('split_pdf')
    const bound = createPdfSkill(makeDeps({ bound: true, readOnly: false }))
    for (const n of FILE_LEVEL) expect(bound.tools.map((t) => t.name)).not.toContain(n)
    const r = await bound.executeTool({ id: 't1', name: 'create_document', input: {} })
    expect(r.isError).toBe(true)
  })
})

describe('the web save path is untouched', () => {
  it('the adapter’s bound answer still flows to the save consumers unmodified', async () => {
    installWebCaps()
    const api = {
      uniworkState: async () => WEB_EDITABLE,
    }
    const state = await queryPdfUniworkState(api, 'doc.pdf')
    // save()/forcesBoundSave/the Save button keep seeing the unbound working copy…
    expect(state).toEqual({ bound: false, readOnly: false })
    // …while the AI filter reads the same frame as bound
    expect(pdfUniworkBoundForAi(state)).toBe(true)
  })
})
