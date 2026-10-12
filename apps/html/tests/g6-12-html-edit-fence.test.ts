import { describe, expect, it } from 'vitest'
import { buildParseMap, type ParseMap } from '../src/renderer/document/parse-map'
import { compileOps, type HtmlOp } from '../src/renderer/document/ops'
import { applyPatches } from '../src/renderer/document/patch'
import { createHtmlSkillCore, type HtmlDocAccess } from '../src/renderer/ai/tools'

// G6-12 #9: a turn sent from "Ask AI" on a selected element, or a queue submission, may only
// edit those elements; the code refuses anything else and the source outside stays identical.

function fakeAccess(initial: string, fence: () => readonly number[] | null) {
  let text = initial
  let version = 1
  let map: ParseMap | null = null
  const getMap = () => {
    if (!map || map.version !== version) map = buildParseMap(text, version, map)
    return map
  }
  const access: HtmlDocAccess = {
    getText: () => text,
    getVersion: () => version,
    getMap,
    getLastManualVersion: () => 0,
    getFilePath: () => '/tmp/page.html',
    getSelectedSid: () => null,
    getEditFence: fence,
    applyOps: (ops: HtmlOp[]) => {
      const compiled = compileOps(text, getMap(), ops)
      if (compiled.errors.length) return { ok: false, errors: compiled.errors }
      text = applyPatches(text, compiled.patches)
      version++
      return { ok: true, ranges: compiled.patches.map((p) => [p.from, p.from] as [number, number]) }
    },
    replaceAll: (html) => {
      text = html
      version++
    },
    writePage: async () => ({ ok: true, html: '<p>new page</p>' }),
  }
  return {
    access,
    get text() {
      return text
    },
  }
}

const DOC = `<!doctype html>
<html>
<body>
<h1 id="t">Quarterly</h1>
<p id="a">Alpha text.</p>
<p id="b">Beta text.</p>
<p id="c">Gamma text.</p>
</body>
</html>`

function sidOf(access: HtmlDocAccess, id: string): number {
  const text = access.getText()
  for (const e of access.getMap().bySid.values()) {
    if (text.slice(e.startTag[0], e.startTag[1]).includes(`id="${id}"`)) return e.sid
  }
  throw new Error(`no element #${id}`)
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 't1', name, input })

async function run(access: HtmlDocAccess, name: string, input: Record<string, unknown>) {
  const core = createHtmlSkillCore(access)
  core.buildContext()
  return await core.executeTool(call(name, input))
}

describe('html selection edit fence', () => {
  it('an edit of the fenced element applies', async () => {
    let fence: number[] | null = null
    const doc = fakeAccess(DOC, () => fence)
    fence = [sidOf(doc.access, 'b')]
    const r = await run(doc.access, 'apply_ops', {
      ops: [{ op: 'set_text', sid: fence[0], text: 'Beta edited.' }],
    })
    expect(r.isError).toBeFalsy()
    expect(doc.text).toContain('Beta edited.')
  })

  it('an edit of another element is refused and the source stays identical', async () => {
    let fence: number[] | null = null
    const doc = fakeAccess(DOC, () => fence)
    fence = [sidOf(doc.access, 'b')]
    const r = await run(doc.access, 'apply_ops', {
      ops: [
        { op: 'set_text', sid: fence[0], text: 'Beta edited.' },
        { op: 'set_text', sid: sidOf(doc.access, 'a'), text: 'Alpha edited.' },
      ],
    })
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/outside the (selected element|selection)/i)
    expect(doc.text).toBe(DOC)
  })

  it('a str_replace that lands outside the fence is refused', async () => {
    let fence: number[] | null = null
    const doc = fakeAccess(DOC, () => fence)
    fence = [sidOf(doc.access, 'b')]
    const r = await run(doc.access, 'apply_ops', {
      ops: [{ op: 'str_replace', old: 'Gamma text.', new: 'Gamma edited.' }],
    })
    expect(r.isError).toBe(true)
    expect(doc.text).toBe(DOC)
  })

  it('whole-page writers are refused while fenced', async () => {
    let fence: number[] | null = null
    const doc = fakeAccess(DOC, () => fence)
    fence = [sidOf(doc.access, 'b')]
    const r = await run(doc.access, 'write_document', { plan: 'a new page' })
    expect(r.isError).toBe(true)
    expect(doc.text).toBe(DOC)
  })

  it('queued targets: each target is editable, the element between them is not', async () => {
    let fence: number[] | null = null
    const doc = fakeAccess(DOC, () => fence)
    const a = sidOf(doc.access, 'a')
    const b = sidOf(doc.access, 'b')
    const c = sidOf(doc.access, 'c')
    fence = [a, c]
    const ok = await run(doc.access, 'apply_ops', {
      ops: [
        { op: 'set_text', sid: a, text: 'Alpha edited.' },
        { op: 'set_text', sid: c, text: 'Gamma edited.' },
      ],
    })
    expect(ok.isError).toBeFalsy()
    const before = doc.text
    const gap = await run(doc.access, 'apply_ops', {
      ops: [{ op: 'set_text', sid: b, text: 'Beta edited.' }],
    })
    expect(gap.isError).toBe(true)
    expect(doc.text).toBe(before)
  })

  it('no fence: any element stays editable', async () => {
    const doc = fakeAccess(DOC, () => null)
    const r = await run(doc.access, 'apply_ops', {
      ops: [{ op: 'set_text', sid: sidOf(doc.access, 'a'), text: 'Alpha edited.' }],
    })
    expect(r.isError).toBeFalsy()
    expect(doc.text).toContain('Alpha edited.')
  })
})
