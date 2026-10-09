import { afterEach, describe, expect, it, vi } from 'vitest'

// Same UI-only mocks as save-serialization.test.ts: file-actions pulls the konva
// export chain, which needs a native canvas the unit env does not have.
vi.mock('../src/renderer/export-render', () => ({ renderSlidesToPngBase64: vi.fn() }))
vi.mock('../src/renderer/components/toast-bus', () => ({ showToast: vi.fn() }))
vi.mock('../src/renderer/i18n/locale', () => ({ t: (k: string) => k }))

import { save } from '../src/renderer/file-actions'
import type { ActionCtx } from '../src/renderer/action-context'

function ctx(): ActionCtx {
  return {
    editingActiveRef: { current: false },
    flushNotes: () => Promise.resolve(),
    slides: [],
    current: 0,
    setSlides: () => {},
    setSelectedIds: () => {},
    setEnteredGroupId: () => {},
    setEditing: () => {},
    setEditingCell: () => {},
    setDirty: () => {},
    setPath: () => {},
    setStatus: () => {},
    path: '/test/deck.pptx',
  } as unknown as ActionCtx
}

describe('slides save origin (UniWork seam)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("tags an explicit save 'user' and an AutoSave pass 'auto'", async () => {
    const ipcSave = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', { slidesApi: { save: ipcSave } })
    await save(() => ctx())
    await save(() => ctx(), true, 'auto')
    expect(ipcSave.mock.calls).toEqual([['user'], ['auto']])
  })
})
