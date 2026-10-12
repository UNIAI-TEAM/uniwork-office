// G6-12 #5: a run's rollback restores the side state the five side-state tools
// change (comments, header/footer, style table, page setup, watermark), not only
// the ProseMirror document.
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureRunSnapshot,
  createAiSideState,
  restoreRunSnapshot,
} from '../src/renderer/ai/run-snapshot'
import { RUNS, call, createEditor, destroyEditors, fixture } from './helpers/g6-12-side-fixture'

afterEach(destroyEditors)

function wired() {
  const f = fixture()
  const side = createAiSideState(
    {
      comments: f.comments,
      header: f.header,
      styles: f.styles,
      watermark: f.watermark,
      sections: f.sections,
    },
    () => f.docKey.current,
  )
  return { ...f, side }
}

describe('run rollback restores the side state', () => {
  it('puts back comments, header, styles, page setup and watermark with the document', async () => {
    const f = wired()
    const editor = createEditor('Before')
    const before = {
      comments: f.comments.value,
      header: f.header.value,
      styles: f.styles.value,
      watermark: f.watermark.value,
      sections: f.sections.value,
    }
    const snap = captureRunSnapshot(editor, f.side)
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' after')
    for (const [name, input] of RUNS) {
      const exec = await call(editor, name, input, f.access)
      expect(exec.isError, exec.output).toBeFalsy()
    }
    expect(f.comments.value[0]!.done).toBe(true)
    expect(f.header.value).toEqual({ header: 'AI header' })
    expect(Object.keys(f.styles.value)).toEqual(['Callout'])
    expect(f.watermark.value).not.toBeNull()
    expect(f.sections.value[0]!.settings.pageWidth).not.toBe(before.sections[0]!.settings.pageWidth)

    const outcome = restoreRunSnapshot(editor, snap, f.side)
    expect(outcome.sideRestored).toBe(true)
    expect(editor.state.doc.textContent).toBe('Before')
    expect(f.comments.value).toBe(before.comments)
    expect(f.header.value).toBe(before.header)
    expect(f.styles.value).toBe(before.styles)
    expect(f.watermark.value).toBe(before.watermark)
    expect(f.sections.value).toBe(before.sections)
  })

  it('leaves the side state alone once the document was saved or reloaded since the run', async () => {
    const f = wired()
    const editor = createEditor('Before')
    const snap = captureRunSnapshot(editor, f.side)
    await call(editor, 'set_watermark', { text: 'DRAFT' }, f.access)
    const after = f.watermark.value
    f.docKey.current = {} // a save re-reads the file: the pre-run side state no longer applies
    const outcome = restoreRunSnapshot(editor, snap, f.side)
    expect(outcome.sideRestored).toBe(false)
    expect(f.watermark.value).toBe(after)
    expect(editor.state.doc.textContent).toBe('Before')
  })

  it('restores only the document when no side state is wired', () => {
    const editor = createEditor('Before')
    const snap = captureRunSnapshot(editor)
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' after')
    expect(restoreRunSnapshot(editor, snap).sideRestored).toBe(false)
    expect(editor.state.doc.textContent).toBe('Before')
  })
})
