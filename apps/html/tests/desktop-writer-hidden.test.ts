// UNI-2309 (Q-B8): the page writer (plan_page) and write_document run only where the host reaches
// the UniWork AI writer route (the web frame). The desktop runner refuses one-shot requests, so
// there the skill neither offers them nor runs a forced call, and the prompt says so (the panel's
// blank-page intent bar is covered in uni-1919-html-bound-forward.test.ts).
import { describe, expect, it, vi } from 'vitest'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { createDocumentSkill } from '../src/renderer/ai/html-skill'
import type { HtmlDocAccess } from '../src/renderer/ai/tools'

const NOTE =
  'Note: plan_page and write_document are not available here. Edit the open page with the editing tools; do not offer to generate a new page in one go.'
const WRITERS = ['plan_page', 'write_document']
const DOC = '<!doctype html>\n<html><body><h1>Quarterly</h1><p>Revenue</p></body></html>'

function access(route: (() => boolean) | undefined) {
  const map = buildParseMap(DOC, 1, null)
  const replaceAll = vi.fn()
  const writePage = vi.fn()
  const a: HtmlDocAccess = {
    getText: () => DOC,
    getVersion: () => 1,
    getMap: () => map,
    getLastManualVersion: () => 0,
    getFilePath: () => '/tmp/page.html',
    getSelectedSid: () => null,
    applyOps: () => ({ ok: true, ranges: [] }),
    replaceAll,
    writePage,
    ...(route ? { uniworkWriterRoute: route } : {}),
  }
  return { access: a, replaceAll, writePage }
}

describe('the whole-page writers follow the UniWork AI writer route', () => {
  it('without the route: neither is offered, a forced call is refused, and the prompt says so', async () => {
    const { access: a, replaceAll, writePage } = access(() => false)
    const skill = createDocumentSkill(a)
    const names = skill.tools.map((t) => t.name)
    for (const n of WRITERS) expect(names).not.toContain(n)
    expect(names).toContain('apply_ops')
    expect(skill.systemPrompt).toContain(NOTE)
    for (const name of WRITERS) {
      const exec = await skill.executeTool({
        id: 't1',
        name,
        input: { mode: 'new', plan: 'x', title: 'x' },
      })
      expect(exec.isError, name).toBe(true)
      expect(exec.output, name).toContain('not available here')
    }
    expect(writePage).not.toHaveBeenCalled()
    expect(replaceAll).not.toHaveBeenCalled()
  })

  it('with the route, or none set: both are offered, and no note', () => {
    for (const route of [() => true, undefined]) {
      const skill = createDocumentSkill(access(route).access)
      expect(skill.tools.map((t) => t.name)).toEqual(expect.arrayContaining(WRITERS))
      expect(skill.systemPrompt).not.toContain(NOTE)
    }
  })
})
