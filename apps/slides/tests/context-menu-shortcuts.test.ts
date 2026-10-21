import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCtxItems } from '../src/renderer/context-menu-items'
import { slidesHint } from '../src/renderer/shortcuts'
import { t } from '../src/renderer/i18n/locale'
import type { ActionCtx } from '../src/renderer/action-context'

vi.mock('../src/renderer/konva-adapter', () => ({
  isEditableText: (n: { type: string }) => n.type === 'shape' || n.type === 'text',
}))
vi.mock('../src/renderer/clipboard-actions', () => ({}))
vi.mock('../src/renderer/slide-actions', () => ({}))
vi.mock('../src/renderer/show-actions', () => ({}))
vi.mock('../src/renderer/arrange-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/arrange-actions')>()),
}))
vi.mock('../src/renderer/insert-actions', () => ({}))
vi.mock('../src/renderer/picture-edit-actions', () => ({
  canSaveAsPicture: vi.fn(() => false),
}))
vi.mock('../src/renderer/table-actions', () => ({}))
vi.mock('../src/renderer/style-actions', () => ({}))

const shape = { type: 'shape', sourceId: 's1', fill: { kind: 'none' }, stroke: {} }

function groupItems(selectedIds: string[]) {
  const ctx = {
    slides: [{}],
    sections: [],
    selectedIds,
    selectedSlides: [],
    ungroupedSets: [],
    slide: { partPath: 'ppt/slides/slide1.xml', nodes: [shape, { ...shape, sourceId: 's2' }] },
    current: 0,
    layouts: [],
    ctxMenu: { kind: 'element', x: 0, y: 0, targetId: selectedIds[0] },
    findNodeCtx: () => null,
  } as unknown as ActionCtx
  return buildCtxItems(ctx).find((i) => i?.label === t('appCtxGroup'))!.sub!
}

afterEach(() => vi.restoreAllMocks())

describe('Group submenu hints come from the table (L3)', () => {
  it('Windows: the primary chord of Group, Ungroup and Regroup', () => {
    const hints = groupItems(['s1', 's2']).map((i) => i?.hint)
    expect(hints).toEqual([
      slidesHint('slides-37', 'win'),
      slidesHint('slides-38', 'win'),
      slidesHint('slides-39', 'win'),
    ])
    expect(hints).toEqual(['Ctrl+G', 'Ctrl+Shift+G', 'Ctrl+Shift+J'])
  })

  it('macOS: the Option chords, and Regroup has a key too', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const hints = groupItems(['s1', 's2']).map((i) => i?.hint)
    expect(hints).toEqual(['⌥⌘G', '⌥⇧⌘G', '⌥⌘J'])
  })
})
