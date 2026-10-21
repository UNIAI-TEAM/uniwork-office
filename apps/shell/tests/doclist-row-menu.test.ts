import { describe, expect, it, vi } from 'vitest'
import {
  buildRowMenu,
  type RowMenuActionId,
  type RowMenuItem,
} from '../src/renderer/src/doclist/row-menu'
import type { DocListScreen } from '../src/renderer/src/doclist/columns'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import type { StringKey } from '../src/renderer/src/locale'

const doc = (partial: Partial<DocumentsHomeDoc> = {}): DocumentsHomeDoc => ({
  id: 'd1',
  workspaceId: 'ws-1',
  title: 'Kế hoạch.docx',
  format: 'docx',
  updatedAt: '2026-10-21T02:00:00.000Z',
  kind: 'file',
  parentId: null,
  ...partial,
})

/** a host that can run every phase-1 action */
const ALL: RowMenuActionId[] = [
  'open',
  'offline',
  'copy-link',
  'rename',
  'move',
  'shelve',
  'unshelve',
  'trash',
  'restore',
  'details',
]

function menu(
  screen: DocListScreen,
  d: DocumentsHomeDoc,
  opts: { run?: RowMenuActionId[]; offlineLabel?: string | null } = {},
): RowMenuItem[] {
  const run: Partial<Record<RowMenuActionId, () => void>> = {}
  for (const id of opts.run ?? ALL) run[id] = vi.fn()
  return buildRowMenu({
    screen,
    doc: d,
    run,
    offlineLabel: opts.offlineLabel === undefined ? 'Dùng khi không có mạng' : opts.offlineLabel,
    label: (key: StringKey) => key,
  })
}
const ids = (items: RowMenuItem[]) => items.map((i) => i.id)

const MANAGER = doc({ canEdit: true, canManage: true, myLevel: 'manage' })

describe('row menu: item order on the shared rules (UNI-2047 A4)', () => {
  it.each<DocListScreen>(['workspace', 'recent', 'shared', 'shared-by-me'])(
    '%s: Open, offline, Copy link | Rename, Move | Shelve, Trash',
    (screen) => {
      expect(ids(menu(screen, MANAGER))).toEqual([
        'open',
        'offline',
        'copy-link',
        'rename',
        'move',
        'shelve',
        'trash',
      ])
    },
  )

  it('draws the rules groups: open+offline | link | edit | keep', () => {
    const items = menu('workspace', MANAGER)
    const groups = items.map((i) => i.group)
    // non-decreasing: a group never comes back
    expect([...groups].sort((a, b) => a - b)).toEqual(groups)
    expect(new Set(groups).size).toBeGreaterThanOrEqual(3)
    const of = (id: string) => items.find((i) => i.id === id)!.group
    expect(of('open')).toBe(of('offline'))
    expect(of('copy-link')).not.toBe(of('open'))
    expect(of('rename')).toBe(of('move'))
    expect(of('shelve')).toBe(of('trash'))
    expect(of('rename')).not.toBe(of('shelve'))
  })

  it('shelved: Open, Unshelve | Move to trash', () => {
    const items = menu('shelved', doc({ canManage: true, shelvedAt: '2026-10-20T00:00:00.000Z' }))
    expect(ids(items)).toEqual(['open', 'unshelve', 'trash'])
    expect(items[1]!.group).toBe(items[0]!.group)
    expect(items[2]!.group).toBeGreaterThan(items[1]!.group)
  })

  it('trash: Restore, Details (no permanent delete: the app has no such action yet)', () => {
    expect(ids(menu('trash', doc({ canManage: true, archived: true })))).toEqual([
      'restore',
      'details',
    ])
  })

  it('uses the shared label keys, never a screen-private wording', () => {
    const items = menu('workspace', MANAGER)
    const label = (id: string) => items.find((i) => i.id === id)!.label
    expect(label('open')).toBe('dlActOpen')
    expect(label('copy-link')).toBe('dlActCopyLink')
    expect(label('rename')).toBe('dlActRename')
    expect(label('move')).toBe('dlActMove')
    expect(label('shelve')).toBe('dlActShelve')
    expect(label('trash')).toBe('dlActTrash')
    expect(label('offline')).toBe('Dùng khi không có mạng')
    expect(menu('shelved', doc({ canManage: true }))[1]!.label).toBe('dlActUnshelve')
    const trash = menu('trash', doc({ canManage: true, archived: true }))
    expect(trash.map((i) => i.label)).toEqual(['dlActRestore', 'dlActDetails'])
  })
})

describe('row menu: hidden by permission, never dead', () => {
  it('a viewer gets Open, offline and Copy link only', () => {
    const viewer = doc({ canEdit: false, canManage: false, myLevel: 'view' })
    expect(ids(menu('workspace', viewer))).toEqual(['open', 'offline', 'copy-link'])
  })

  it('an editor (not manager) cannot shelve or trash', () => {
    const editor = doc({ canEdit: true, canManage: false, myLevel: 'edit' })
    expect(ids(menu('workspace', editor))).toEqual([
      'open',
      'offline',
      'copy-link',
      'rename',
      'move',
    ])
  })

  it('shared with me: Shelve and Trash only with the manage right', () => {
    const edit = doc({ canEdit: true, canManage: false, myLevel: 'edit' })
    expect(ids(menu('shared', edit))).not.toContain('trash')
    expect(ids(menu('shared', edit))).not.toContain('shelve')
    expect(ids(menu('shared', MANAGER))).toEqual(expect.arrayContaining(['shelve', 'trash']))
  })

  it('a page has no offline file; a folder has no copy link, shelve or offline', () => {
    expect(ids(menu('workspace', { ...MANAGER, kind: 'page' }, { offlineLabel: null }))).toEqual([
      'open',
      'copy-link',
      'rename',
      'move',
      'shelve',
      'trash',
    ])
    expect(ids(menu('workspace', { ...MANAGER, kind: 'folder' }, { offlineLabel: null }))).toEqual([
      'open',
      'rename',
      'move',
      'trash',
    ])
  })

  it('a shelved search hit in a live list is read-only: no rename, move or shelve', () => {
    const hit = { ...MANAGER, shelvedAt: '2026-10-20T00:00:00.000Z' }
    expect(ids(menu('workspace', hit))).toEqual(['open', 'copy-link', 'trash'])
  })

  it('shelved list: nobody below manage can unshelve or trash; a folder never opens', () => {
    const edit = doc({ canEdit: true, canManage: false, myLevel: 'edit', shelvedAt: 'x' })
    expect(ids(menu('shelved', edit))).toEqual(['open'])
    const folder = doc({ kind: 'folder', canManage: true, shelvedAt: 'x' })
    expect(ids(menu('shelved', folder))).toEqual(['unshelve', 'trash'])
    // the admin scope of a restricted row counts as manage, as the shelf says today
    const admin = doc({ adminScope: true, shelvedAt: 'x' })
    expect(ids(menu('shelved', admin))).toEqual(['open', 'unshelve', 'trash'])
  })

  it('trash: Restore needs manage; Details stays for a reader', () => {
    expect(ids(menu('trash', doc({ archived: true, canManage: false })))).toEqual(['details'])
  })

  it('an archived row in any list behaves as the trash row', () => {
    expect(ids(menu('workspace', doc({ archived: true, canManage: true })))).toEqual([
      'restore',
      'details',
    ])
  })

  it('no dead item: an action the host cannot run leaves no entry', () => {
    const items = menu('workspace', MANAGER, { run: ['open', 'trash'], offlineLabel: null })
    expect(ids(items)).toEqual(['open', 'trash'])
    expect(menu('workspace', MANAGER, { run: [], offlineLabel: null })).toEqual([])
  })

  it('every entry runs its own handler and nothing else', () => {
    const run: Partial<Record<RowMenuActionId, () => void>> = {}
    const spies = new Map<RowMenuActionId, ReturnType<typeof vi.fn>>()
    for (const id of ALL) {
      const spy = vi.fn()
      spies.set(id, spy)
      run[id] = spy
    }
    const items = buildRowMenu({
      screen: 'workspace',
      doc: MANAGER,
      run,
      offlineLabel: null,
      label: (k) => k,
    })
    for (const item of items) {
      item.onSelect()
      expect(spies.get(item.id as RowMenuActionId)).toHaveBeenCalledTimes(1)
    }
    const called = [...spies.entries()].filter(([, s]) => s.mock.calls.length > 0).map(([id]) => id)
    expect(called.sort()).toEqual(ids(items).sort())
  })

  it('the offline toggle runs through the host (its own handler key)', () => {
    const offline = vi.fn()
    const items = buildRowMenu({
      screen: 'workspace',
      doc: MANAGER,
      run: { open: vi.fn(), offline },
      offlineLabel: 'Bỏ ghim ngoại tuyến',
      label: (k) => k,
    })
    items.find((i) => i.id === 'offline')!.onSelect()
    expect(offline).toHaveBeenCalledTimes(1)
  })
})

describe('row menu: the destructive item is last, red, and asks first', () => {
  it.each<[DocListScreen, DocumentsHomeDoc]>([
    ['workspace', MANAGER],
    ['recent', MANAGER],
    ['shared', MANAGER],
    ['shared-by-me', MANAGER],
    ['shelved', doc({ canManage: true, shelvedAt: 'x' })],
  ])('%s: Move to trash is the last entry, danger and confirm', (screen, d) => {
    const items = menu(screen, d)
    const last = items[items.length - 1]!
    expect(last.id).toBe('trash')
    expect(last.danger).toBe(true)
    expect(last.confirm).toBe(true)
    // it never shares a group with the safe entries before it except Shelve (live lists)
    expect(items.filter((i) => i.danger)).toHaveLength(1)
  })

  it('no other entry is danger or asks for a confirm', () => {
    for (const screen of ['workspace', 'shelved', 'trash'] as const) {
      const d =
        screen === 'trash'
          ? doc({ canManage: true, archived: true })
          : { ...MANAGER, canManage: true }
      for (const item of menu(screen, d)) {
        if (item.id !== 'trash') {
          expect(item.danger).toBeUndefined()
          expect(item.confirm).toBeUndefined()
        }
      }
    }
  })

  it('a menu without the trash right has no danger entry at all', () => {
    expect(menu('workspace', doc({ canEdit: true })).some((i) => i.danger)).toBe(false)
  })
})
