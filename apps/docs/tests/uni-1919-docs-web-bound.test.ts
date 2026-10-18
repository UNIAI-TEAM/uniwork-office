// UNI-1919 (w2): a docx open in the web frame IS the UniWork document, so the
// AI must see it as bound even though the web adapter keeps answering
// `uniworkState.bound: false` for working-copy semantics (web save, autosave
// and the Save button are keyed off that answer and must not change). The seam
// is `docsUniworkBoundForAi`: AiPanel feeds the docs-skill `isBound` through it
// (`bound || platform() === 'web'`, the shared rule).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createDocsSkill } from '../src/renderer/ai/docs-skill'
import {
  NO_UNIWORK_STATE,
  docsUniworkBoundForAi,
  uniworkStateFor,
  type UniworkDocState,
} from '../src/renderer/uniwork-doc-state'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'

const NUM_IDS = { bullet: null, ordered: null }
const editors = new Set<Editor>()

type DesktopStub = { desktop?: { capabilities?: unknown; createDocument?: unknown } }

afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
  delete (window as unknown as { desktop?: unknown }).desktop
  resetCapabilitiesForTest()
})

function createEditor(): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [{ type: 'text', text: 'x' }] },
      ],
    },
  })
  editors.add(editor)
  return editor
}

/** the web adapter's answer (web/docs/bridge/webapi.ts uniworkState) for an editable frame */
const WEB_EDITABLE: UniworkDocState = { path: '/f.docx', bound: false, readOnly: false }

/** build the skill the way AiPanel does: `isBound` is docsUniworkBoundForAi(bound) */
function skillFor(editor: Editor, bound: boolean) {
  return createDocsSkill(
    () => editor,
    () => NUM_IDS,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => false,
    () => docsUniworkBoundForAi(bound),
  )
}

function installWebCaps(createDocument?: unknown) {
  ;(window as unknown as DesktopStub).desktop = {
    capabilities: { platform: 'web' },
    ...(createDocument ? { createDocument } : {}),
  }
  resetCapabilitiesForTest()
}

describe('the web docs frame is UniWork-bound for the AI', () => {
  it('offers no create_document even though the adapter keeps bound: false', () => {
    installWebCaps()
    const { bound } = uniworkStateFor(WEB_EDITABLE, WEB_EDITABLE.path)
    const names = skillFor(createEditor(), bound).tools.map((t) => t.name)
    expect(names).not.toContain('create_document')
    expect(names).toContain('insert_content')
  })

  it('refuses a forced create_document call without touching the bridge', async () => {
    const createDocument = vi.fn(async () => ({ ok: true, path: '/tmp/x.docx' }))
    installWebCaps(createDocument)
    const { bound } = uniworkStateFor(WEB_EDITABLE, WEB_EDITABLE.path)
    const exec = await skillFor(createEditor(), bound).executeTool({
      id: 't1',
      name: 'create_document',
      input: { type: 'docx', title: 'Leak', content: '<p>secret</p>' },
    })
    expect(exec.isError).toBe(true)
    expect(exec.mutated).toBe(false)
    expect(exec.output).toMatch(/UniWork/)
    expect(createDocument).not.toHaveBeenCalled()
  })

  it('desktop keeps the adapter answer verbatim (unbound offers it, bound hides and refuses)', async () => {
    ;(window as unknown as DesktopStub).desktop = {}
    resetCapabilitiesForTest()
    const unbound = skillFor(createEditor(), false)
    expect(unbound.tools.map((t) => t.name)).toContain('create_document')
    const boundSkill = skillFor(createEditor(), true)
    expect(boundSkill.tools.map((t) => t.name)).not.toContain('create_document')
    const exec = await boundSkill.executeTool({
      id: 't1',
      name: 'create_document',
      input: { type: 'docx', title: 'x', content: '<p>x</p>' },
    })
    expect(exec.isError).toBe(true)
  })
})

describe('the web save path is untouched', () => {
  it('the adapter’s bound answer still flows to the save consumers unmodified', () => {
    installWebCaps()
    const state = uniworkStateFor(WEB_EDITABLE, WEB_EDITABLE.path)
    // uniworkAllowsSave()/the Save button/the autosave gate keep seeing the unbound working copy…
    expect(state).toEqual({ bound: false, readOnly: false })
    // …while the AI filter reads the same frame as bound
    expect(docsUniworkBoundForAi(state.bound)).toBe(true)
    expect(docsUniworkBoundForAi(NO_UNIWORK_STATE.bound)).toBe(true)
  })
  // skillFor rebuilds the wiring by hand, so it cannot notice AiPanel dropping
  // the shared rule (RPB-3): read the feed like the html bound test does
  it('AiPanel feeds isBound through docsUniworkBoundForAi, not the raw bound prop', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/ai/AiPanel.tsx'),
      'utf8',
    )
    const start = src.indexOf('createDocsSkill(')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, src.indexOf('createFilesSkill', start))
    expect(block).toMatch(/docsUniworkBoundForAi\(boundRef\.current/)
  })
})
