// G6-09 W1: the AI change marker stays on the blocks a run edited until the user Accepts it or
// Saves (AI track changes stays an optional setting and is off here). The marker is a screen
// affordance, never document data: the saved bytes equal those of the same document without it,
// and print/export never paint it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { Editor } from '@tiptap/core'
import JSZip from 'jszip'
import { undoDepth } from '@tiptap/pm/history'
import { parseDocx, saveDocx } from '@genoffice/docx-engine'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { t } from '../src/renderer/i18n/locale'
import { markedBlocks, mountDocsAiPanel, type DocsAiHarness } from './helpers/docs-ai-run-harness'

const BOLD_TWO = {
  name: 'apply_ops',
  input: { ops: [{ op: 'setFont', target: { blockIndexes: [0, 1] }, bold: true }] },
}

let h: DocsAiHarness | null = null
beforeEach(() => localStorage.removeItem('ai-docs-track-changes'))
afterEach(() => {
  h?.cleanup()
  h = null
})

async function runBoldTwo(): Promise<DocsAiHarness> {
  h = await mountDocsAiPanel(['first block', 'second block', 'third block'])
  await h.send('make the first two bold')
  await h.toolTurn([BOLD_TWO])
  await h.textTurn('Done.')
  return h
}

describe('docs AI change marker (track changes off)', () => {
  it('a run that edits two blocks leaves both marked after the run', async () => {
    const { editor, container } = await runBoldTwo()
    expect(editor.state.doc.child(0).firstChild?.marks.map((m) => m.type.name)).toContain('bold')
    expect(markedBlocks(editor)).toEqual([0, 1])
    expect(container.querySelector('.ai-accept-changes')).not.toBeNull()
  })

  it('Accept clears the marker and leaves the edit', async () => {
    const { editor, container } = await runBoldTwo()
    const accept = container.querySelector<HTMLButtonElement>('.ai-accept-changes')
    expect(accept?.textContent).toBe(t('aiAcceptMarked'))
    await act(async () => accept!.click())
    expect(markedBlocks(editor)).toEqual([])
    expect(editor.state.doc.child(0).firstChild?.marks.map((m) => m.type.name)).toContain('bold')
    expect(container.querySelector('.ai-accept-changes')).toBeNull()
  })

  it('a Save clears the marker without adding an undo step', async () => {
    const { editor } = await runBoldTwo()
    const depth = undoDepth(editor.state)
    // saveOnce fires this right before it snapshots the document for writing
    await act(async () => {
      window.dispatchEvent(new Event('ai-docs-commit-tables'))
    })
    expect(markedBlocks(editor)).toEqual([])
    expect(undoDepth(editor.state)).toBe(depth)
  })

  it('an autosave leaves the marker and the Accept button where they are', async () => {
    const { editor, container } = await runBoldTwo()
    const depth = undoDepth(editor.state)
    // saveOnce passes `auto` in the pre-save event detail
    await act(async () => {
      window.dispatchEvent(new CustomEvent('ai-docs-commit-tables', { detail: { auto: true } }))
    })
    expect(markedBlocks(editor)).toEqual([0, 1])
    expect(container.querySelector('.ai-accept-changes')).not.toBeNull()
    expect(undoDepth(editor.state)).toBe(depth)
    // the user's own Save is what clears it
    await act(async () => {
      window.dispatchEvent(new CustomEvent('ai-docs-commit-tables', { detail: { auto: false } }))
    })
    expect(markedBlocks(editor)).toEqual([])
    expect(container.querySelector('.ai-accept-changes')).toBeNull()
  })

  it('the next run marks only what that run edited', async () => {
    const { editor } = await runBoldTwo()
    await h!.send('and the third')
    await h!.toolTurn([
      {
        name: 'apply_ops',
        input: { ops: [{ op: 'setFont', target: { blockIndexes: [2] }, italic: true }] },
      },
    ])
    await h!.textTurn('Done.')
    // the first run's marks were not accepted: they stay, the new block joins them
    expect(markedBlocks(editor)).toEqual([0, 1, 2])
  })
})

describe('the marker is never document data', () => {
  const BODY =
    '<w:p><w:r><w:t>first block</w:t></w:r></w:p><w:p><w:r><w:t>second block</w:t></w:r></w:p>'

  async function zipParts(bytes: Uint8Array): Promise<Record<string, string>> {
    const zip = await JSZip.loadAsync(bytes)
    const out: Record<string, string> = {}
    for (const name of Object.keys(zip.files).sort()) {
      out[name] = Buffer.from(await zip.files[name]!.async('uint8array')).toString('base64')
    }
    return out
  }

  function withoutMarker(node: PmNode): PmNode {
    const attrs =
      node.attrs && 'aiChanged' in node.attrs ? { ...node.attrs, aiChanged: false } : node.attrs
    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(node.content ? { content: node.content.map(withoutMarker) } : {}),
    }
  }

  it('saved bytes of a marked document equal those of the same document without the marker', async () => {
    const parsed = await parseDocx(await buildDocx({ bodyXml: BODY }))
    const { editorExtensions } = await import('../src/renderer/editor/extensions')
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
    })
    try {
      editor.commands.setContent(blocksToPmDoc(parsed.blocks) as never)
      const { executeTool } = await import('../src/renderer/ai/tools')
      const exec = await executeTool(
        editor,
        { id: 't', name: BOLD_TWO.name, input: BOLD_TWO.input },
        { bullet: null, ordered: null },
      )
      expect(exec.isError, exec.output).toBeFalsy()
      expect(markedBlocks(editor)).toEqual([0, 1])
      const marked = editor.getJSON() as PmNode
      const a = await saveDocx(parsed, pmDocToSavePlan(marked, parsed.blocks).saveBlocks)
      const b = await saveDocx(
        parsed,
        pmDocToSavePlan(withoutMarker(marked), parsed.blocks).saveBlocks,
      )
      // every part byte-equal (the zip container itself stamps the write time on each entry)
      expect(await zipParts(a)).toEqual(await zipParts(b))
    } finally {
      editor.destroy()
    }
  })

  it('print and PDF export never paint the marker (screen-only rule)', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8')
    const at = css.indexOf('.doc-page .ai-changed {')
    expect(at).toBeGreaterThan(0)
    // the rule sits inside an @media screen block: find the innermost open block before it
    const before = css.slice(0, at)
    const screen = before.lastIndexOf('@media screen')
    expect(screen, 'inside @media screen').toBeGreaterThan(0)
    const between = before.slice(screen)
    const opens = (between.match(/{/g) ?? []).length
    const closes = (between.match(/}/g) ?? []).length
    expect(opens - closes, 'the @media screen block is still open at the rule').toBe(1)
    // colours come from tokens, legible in light and dark (both values defined)
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toMatch(/background:\s*var\(--ai-highlight\)/)
  })
})
