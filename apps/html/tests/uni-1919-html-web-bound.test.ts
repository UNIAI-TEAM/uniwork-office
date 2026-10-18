// UNI-1919 (w2, Amendment A1): an HTML page open in the web frame IS the
// UniWork document, so the AI must see it as bound even though the web adapter
// keeps answering `uniworkState.bound: false` (working-copy semantics: web
// save, autosave and the ribbon Save button are keyed off that answer and must
// not change). plan_page (modes new/redesign) and write_document REPLACE the
// whole document, so a bound page never offers them and refuses a forced call.
// The seam is `uniworkBound` on HtmlDocAccess: App feeds it the shared rule
// `uniworkBoundForAi(bound, platform())`; desktop keeps the adapter answer.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { uniworkBoundForAi } from '@genoffice/ui/capabilities'
import { platform, resetForTest } from '../src/renderer/capabilities'
import { createDocumentSkill } from '../src/renderer/ai/html-skill'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { createHtmlSkill, type HtmlDocAccess } from '../src/renderer/ai/tools'

const DOC = '<!doctype html>\n<html><body><h1>Quarterly</h1><p>Revenue</p></body></html>'

const BOUND_HIDDEN = ['plan_page', 'write_document']

/** the web adapter's answer (web/modules/html/webapi.ts uniworkState) for an editable frame */
const WEB_EDITABLE = { bound: false, readOnly: false }

function fakeAccess(bound: boolean, doc = DOC) {
  let text = doc
  const map = buildParseMap(text, 1, null)
  const access: HtmlDocAccess = {
    getText: () => text,
    getVersion: () => 1,
    getMap: () => map,
    getLastManualVersion: () => 0,
    getFilePath: () => '/tmp/page.html',
    getSelectedSid: () => null,
    applyOps: () => ({ ok: true, ranges: [] }),
    replaceAll: (html) => {
      text = html
    },
    // App.tsx feeds the shared rule here, not the raw adapter answer
    uniworkBound: () => uniworkBoundForAi(bound, platform()),
  }
  return { access, text: () => text }
}

function installWebCaps() {
  const w = window as unknown as { htmlApi?: { capabilities?: unknown } }
  w.htmlApi = { capabilities: { platform: 'web' } }
  resetForTest()
}

afterEach(() => {
  delete (window as unknown as { htmlApi?: unknown }).htmlApi
  resetForTest()
})

describe('the web HTML frame is UniWork-bound for the AI', () => {
  it('offers neither plan_page nor write_document with the adapter still bound: false', () => {
    installWebCaps()
    const names = createDocumentSkill(fakeAccess(WEB_EDITABLE.bound).access).tools.map(
      (t) => t.name,
    )
    for (const n of BOUND_HIDDEN) expect(names).not.toContain(n)
    expect(names).toContain('apply_ops')
    expect(names).toContain('get_outline')
  })

  it('refuses a forced plan_page / write_document call with a bound wording', async () => {
    installWebCaps()
    const { access, text } = fakeAccess(WEB_EDITABLE.bound)
    const skill = createDocumentSkill(access)
    for (const name of BOUND_HIDDEN) {
      const result = await skill.executeTool({
        id: 't1',
        name,
        input: { mode: 'redesign', plan: 'x' },
      })
      expect(result.isError, name).toBe(true)
      expect(result.mutated, name).toBeFalsy()
      expect(result.output, name).toMatch(/UniWork/)
    }
    expect(text()).toBe(DOC)
  })

  it('desktop keeps the adapter answer verbatim (unbound offers the tools, bound hides and refuses)', async () => {
    // no capabilities object: desktop, platform() is undefined
    const unbound = createDocumentSkill(fakeAccess(false).access)
    expect(unbound.tools.map((t) => t.name)).toEqual(expect.arrayContaining(BOUND_HIDDEN))
    const { access, text } = fakeAccess(true)
    const boundSkill = createDocumentSkill(access)
    for (const n of BOUND_HIDDEN) expect(boundSkill.tools.map((t) => t.name)).not.toContain(n)
    const result = await boundSkill.executeTool({
      id: 't1',
      name: 'plan_page',
      input: { mode: 'new' },
    })
    expect(result.isError).toBe(true)
    expect(result.output).toMatch(/UniWork/)
    expect(text()).toBe(DOC)
  })
})

describe('a bound page steers the model away from the hidden writers', () => {
  // RPB-2: the prompt still drives the model to plan_page / write_document on a
  // bound page where both tools are gone — name them unavailable instead
  it('the system prompt carries a bound note on a bound frame', () => {
    installWebCaps()
    const bound = createDocumentSkill(fakeAccess(WEB_EDITABLE.bound).access)
    expect(bound.systemPrompt).toContain('UniWork document')
    expect(bound.systemPrompt).toContain('plan_page and write_document are unavailable')
    expect(bound.systemPrompt).toContain('apply_ops')
    expect(bound.systemPrompt).toContain('never replace the whole document')
  })

  // only desktop can be unbound: on web uniworkBoundForAi always reads bound
  it('an unbound desktop page keeps today’s prompt', () => {
    const unbound = createDocumentSkill(fakeAccess(false).access)
    expect(unbound.systemPrompt).not.toContain('plan_page and write_document are unavailable')
    expect(unbound.systemPrompt).not.toContain('never replace the whole document')
  })

  it('the empty-document hint names no hidden tool on a bound frame', () => {
    installWebCaps()
    const ctx = createDocumentSkill(fakeAccess(WEB_EDITABLE.bound, '').access).buildContext()
    expect(ctx).toContain('The document is empty')
    for (const n of BOUND_HIDDEN) expect(ctx).not.toContain(n)
  })

  it('an empty desktop page still names the page writers', () => {
    const unboundCtx = createDocumentSkill(fakeAccess(false, '').access).buildContext()
    expect(unboundCtx).toContain('plan_page (mode new)')
    expect(unboundCtx).toContain('write_document')
  })
})

describe('a read-only bound page gets only the view-only note (RPB-5)', () => {
  // read-only web frames are bound too, but apply_ops is not offered there
  it('prompt has the view-only note and no bound note when read-only and bound', () => {
    installWebCaps()
    const skill = createHtmlSkill(fakeAccess(true).access, 'base', () => true)
    expect(skill.systemPrompt).toContain('this document is view-only')
    expect(skill.systemPrompt).not.toContain('plan_page and write_document are unavailable')
    expect(skill.systemPrompt).not.toContain('apply_ops')
  })

  it('the empty-document hint does not mention apply_ops when read-only and bound', () => {
    installWebCaps()
    const ctx = createHtmlSkill(fakeAccess(true, '').access, 'base', () => true).buildContext()
    expect(ctx).toContain('The document is empty')
    expect(ctx).not.toContain('apply_ops')
  })

  it('an editable bound page is unchanged', () => {
    installWebCaps()
    const skill = createHtmlSkill(fakeAccess(true, '').access, 'base', () => false)
    expect(skill.systemPrompt).not.toContain('view-only')
    expect(skill.systemPrompt).toContain('plan_page and write_document are unavailable')
    expect(skill.buildContext()).toContain('fill it in place with apply_ops edits')
  })
})

describe('the web save path is untouched', () => {
  it('the adapter’s bound answer still reaches its consumers unmodified', () => {
    installWebCaps()
    // uniwork.bound (save()/autosave/the ribbon Save button) stays the adapter answer…
    expect(WEB_EDITABLE.bound).toBe(false)
    // …while the AI predicate of the same feed reads the frame as bound
    expect(uniworkBoundForAi(WEB_EDITABLE.bound, 'web')).toBe(true)
    expect(uniworkBoundForAi(WEB_EDITABLE.bound, undefined)).toBe(false)
  })

  // App is too heavy to mount here, so read the feed like g6-12-bound-wiring does
  it('App feeds the shared rule into the AI access, not the raw bound answer', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    const start = src.indexOf('const aiDeps')
    expect(start).toBeGreaterThan(-1)
    const access = src.slice(start, src.indexOf('getSnapshot', start))
    expect(access).toMatch(/uniworkBoundForAi\(uniworkRef\.current\.bound/)
  })
})
