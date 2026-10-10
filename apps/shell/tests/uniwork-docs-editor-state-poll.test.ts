import { describe, expect, it, vi } from 'vitest'
import { createEditorStatePoll } from '../src/main/uniwork-docs/editor-state-poll'

describe('UniWork editor state poll', () => {
  it('asks only for bound paths and forwards answered states', async () => {
    const noteEditorDirty = vi.fn()
    const editorDirtyStates = vi.fn(async (wanted: (path: string) => boolean) =>
      [
        { path: 'a.docx', dirty: true },
        { path: 'b.xlsx', dirty: false },
        { path: 'c.pptx', dirty: null },
      ].filter((s) => wanted(s.path)),
    )
    const pass = createEditorStatePoll({
      editorDirtyStates,
      isBound: (path) => path !== 'b.xlsx',
      noteEditorDirty,
    })
    await pass()
    expect(noteEditorDirty.mock.calls).toEqual([['a.docx', true]])
  })

  it('never overlaps a pass that waits on a busy editor, and survives a failing read', async () => {
    let release!: () => void
    const editorDirtyStates = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Array<{ path: string; dirty: boolean | null }>>((resolve) => {
            release = () => resolve([{ path: 'a.md', dirty: true }])
          }),
      )
      .mockRejectedValueOnce(new Error('tab closed'))
      .mockResolvedValue([{ path: 'a.md', dirty: false }])
    const noteEditorDirty = vi.fn()
    const pass = createEditorStatePoll({ editorDirtyStates, isBound: () => true, noteEditorDirty })
    const first = pass()
    await pass()
    expect(editorDirtyStates).toHaveBeenCalledTimes(1)
    release()
    await first
    await pass()
    await pass()
    expect(noteEditorDirty.mock.calls).toEqual([
      ['a.md', true],
      ['a.md', false],
    ])
  })
})
