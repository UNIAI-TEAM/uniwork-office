// UNI-2326 (ADR 0052): the whole-page writers (plan_page, write_document) run on the UniWork AI
// writer route on the web frame and on the desktop, and the owner dropped C-BOUND for HTML: a page
// bound to a UniWork document gets them like any page. Only a view-only page still reads only.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetForTest } from '../src/renderer/capabilities'
import { createDocumentSkill } from '../src/renderer/ai/html-skill'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { createHtmlSkill, type HtmlDocAccess } from '../src/renderer/ai/tools'

const DOC = '<!doctype html>\n<html><body><h1>Quarterly</h1><p>Revenue</p></body></html>'
const WRITERS = ['plan_page', 'write_document']

function fakeAccess(doc = DOC) {
  const map = buildParseMap(doc, 1, null)
  const writePage = vi.fn(async () => ({ status: 'empty' as const, error: 'test' }))
  const access: HtmlDocAccess = {
    getText: () => doc,
    getVersion: () => 1,
    getMap: () => map,
    getLastManualVersion: () => 0,
    getFilePath: () => '/tmp/page.html',
    getSelectedSid: () => null,
    applyOps: () => ({ ok: true, ranges: [] }),
    replaceAll: () => {},
    writePage,
  }
  return { access, writePage }
}

const HOSTS = [
  ['the desktop', () => undefined],
  [
    'the web frame (every page there is UniWork-bound)',
    () => {
      ;(window as unknown as { htmlApi?: unknown }).htmlApi = {
        capabilities: { platform: 'web' },
      }
    },
  ],
] as const

afterEach(() => {
  delete (window as unknown as { htmlApi?: unknown }).htmlApi
  resetForTest()
})

describe.each(HOSTS)('the whole-page writers on %s', (_host, install) => {
  it('are offered with no note that says they are unavailable', () => {
    install()
    resetForTest()
    const skill = createDocumentSkill(fakeAccess().access)
    expect(skill.tools.map((t) => t.name)).toEqual(expect.arrayContaining(WRITERS))
    expect(skill.systemPrompt).not.toMatch(/are (not available here|unavailable on it)/)
    expect(skill.systemPrompt).not.toContain('never replace the whole document')
  })

  it('a write_document call on a blank page reaches the page writer instead of a refusal', async () => {
    install()
    resetForTest()
    const { access, writePage } = fakeAccess('')
    const exec = await createDocumentSkill(access).executeTool({
      id: 't1',
      name: 'write_document',
      input: { title: 'Q3', plan: 'intro, numbers' },
    })
    expect(writePage).toHaveBeenCalledTimes(1)
    expect(exec.output).not.toMatch(/UniWork document|not available here/)
  })

  it('the empty-document hint names the writers', () => {
    install()
    resetForTest()
    const ctx = createDocumentSkill(fakeAccess('').access).buildContext()
    expect(ctx).toContain(
      'The document is empty: plan_page (mode new) or write_document creates it.',
    )
  })
})

describe('a view-only page still reads only', () => {
  it('offers no writer, refuses a forced one with the view-only wording, and its hint names none', async () => {
    const { access, writePage } = fakeAccess()
    const skill = createHtmlSkill(access, 'base', () => true)
    for (const n of WRITERS) expect(skill.tools.map((t) => t.name)).not.toContain(n)
    expect(skill.systemPrompt).toContain('this document is view-only')
    const exec = await skill.executeTool({ id: 't1', name: 'plan_page', input: { mode: 'new' } })
    expect(exec.isError).toBe(true)
    expect(exec.output).toContain('view-only')
    expect(writePage).not.toHaveBeenCalled()
    const hint = createHtmlSkill(fakeAccess('').access, 'base', () => true)
      .buildContext()
      .split('\n')
      .find((l) => l.startsWith('The document is empty'))
    expect(hint).toBe('The document is empty.')
  })
})
