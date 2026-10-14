import { describe, expect, it, vi } from 'vitest'
import {
  createEditorStatePoll,
  mergeEditorStates,
} from '../src/main/uniwork-docs/editor-state-poll'
import type { EditorState } from '../src/main/ai-run-registry'

const state = (
  path: string,
  dirty: boolean | null,
  aiRunning = false,
  aiEpoch = 0,
): EditorState => ({
  path,
  dirty,
  aiRunning,
  aiEpoch,
})

describe('UniWork editor state poll', () => {
  it('asks only for bound paths and forwards answered states', async () => {
    const noteEditorState = vi.fn()
    const editorDirtyStates = vi.fn(async (wanted: (path: string) => boolean) =>
      [state('a.docx', true), state('b.xlsx', false), state('c.pptx', null)].filter((s) =>
        wanted(s.path),
      ),
    )
    const pass = createEditorStatePoll({
      editorDirtyStates,
      isBound: (path) => path !== 'b.xlsx',
      saveMark: () => 7,
      noteEditorState,
    })
    await pass()
    expect(noteEditorState.mock.calls).toEqual([
      ['a.docx', { dirty: true, aiRunning: false, aiEpoch: 0 }, 7],
      ['c.pptx', { dirty: null, aiRunning: false, aiEpoch: 0 }, 7],
    ])
  })

  it('never overlaps a pass that waits on a busy editor, and survives a failing read', async () => {
    let release!: () => void
    const editorDirtyStates = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<EditorState[]>((resolve) => {
            release = () => resolve([state('a.md', true)])
          }),
      )
      .mockRejectedValueOnce(new Error('tab closed'))
      .mockResolvedValue([state('a.md', false)])
    const noteEditorState = vi.fn()
    const pass = createEditorStatePoll({
      editorDirtyStates,
      isBound: () => true,
      saveMark: () => 0,
      noteEditorState,
    })
    const first = pass()
    await pass()
    expect(editorDirtyStates).toHaveBeenCalledTimes(1)
    release()
    await first
    await pass()
    await pass()
    expect(noteEditorState.mock.calls).toEqual([
      ['a.md', { dirty: true, aiRunning: false, aiEpoch: 0 }, 0],
      ['a.md', { dirty: false, aiRunning: false, aiEpoch: 0 }, 0],
    ])
  })

  it('reads the save mark before it asks the editors', async () => {
    let mark = 1
    const order: string[] = []
    const pass = createEditorStatePoll({
      editorDirtyStates: async () => {
        order.push('ask')
        mark = 2 // a Save lands while the editors answer
        return [state('a.md', true)]
      },
      isBound: () => true,
      saveMark: () => {
        order.push('mark')
        return mark
      },
      noteEditorState: (_path, _state, m) => order.push(`note@${m}`),
    })
    await pass()
    expect(order).toEqual(['mark', 'ask', 'note@1'])
  })

  it('merges the same path from several views: dirty any, aiRunning any, aiEpoch sum', async () => {
    const noteEditorState = vi.fn()
    const pass = createEditorStatePoll({
      // a tab and a detached window of the same document, read in one pass
      editorDirtyStates: async () => [
        state('/w/a.docx', true, false, 2),
        state('/w/a.docx', null, true, 1),
      ],
      isBound: () => true,
      saveMark: () => 0,
      noteEditorState,
    })
    await pass()
    expect(noteEditorState.mock.calls).toEqual([
      ['/w/a.docx', { dirty: true, aiRunning: true, aiEpoch: 3 }, 0],
    ])
  })

  it('a path only answered null by every view stays null (the service keeps its last answer)', () => {
    expect(
      mergeEditorStates([state('a.md', null, false, 0), state('a.md', null, true, 4)]),
    ).toEqual([{ path: 'a.md', dirty: null, aiRunning: true, aiEpoch: 4 }])
    expect(
      mergeEditorStates([state('a.md', false, false, 0), state('a.md', null, false, 1)]),
    ).toEqual([{ path: 'a.md', dirty: false, aiRunning: false, aiEpoch: 1 }])
  })
})
