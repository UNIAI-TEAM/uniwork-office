import { describe, expect, it } from 'vitest'
import type { UniworkDocSummary, UniworkFolderNode } from '../src/shared/home-api'
import {
  FOLDER_MAX_DEPTH,
  ROOT_KEY,
  breadcrumbOf,
  buildFolderIndex,
  checkFolderName,
  contentsView,
  createRequestGate,
  expandKeysFor,
  expandParentAndAncestorsFor,
  folderActionFailure,
  folderPath,
  liveFallback,
  moveBlockOf,
  readSortMode,
  shortPath,
  treeKey,
  treeRows,
  writeSortMode,
} from '../src/renderer/src/uniwork-folders/uniwork-folders-model'

/**
 * FD-11 §6 FE unit: the folder tree model behind UniworkFolderTree,
 * UniworkBrowser and UniworkFolderPicker. Pure functions, no React.
 */

function node(
  id: string,
  title: string,
  children: UniworkFolderNode[] = [],
  parentId: string | null = null,
): UniworkFolderNode {
  return {
    id,
    parentId,
    title,
    position: 0,
    children: children.map((c) => ({ ...c, parentId: id })),
  }
}

// root ─ A ─ A1 ─ A1x
//      │    └ A2
//      └ B
const TREE = [
  node('a', 'Alpha', [node('a1', 'Alpha one', [node('a1x', 'Deep')]), node('a2', 'Alpha two')]),
  node('b', 'Beta'),
]

/** a straight chain of `n` folders f1 > f2 > ... > fn */
function chain(n: number): UniworkFolderNode[] {
  let child: UniworkFolderNode | null = null
  for (let i = n; i >= 1; i--) child = node(`f${i}`, `F${i}`, child ? [child] : [])
  return [child!]
}

function doc(id: string, title: string, extra: Partial<UniworkDocSummary> = {}): UniworkDocSummary {
  return {
    id,
    workspaceId: 'w1',
    title,
    format: 'docx',
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'file',
    parentId: null,
    ...extra,
  }
}

describe('folder index and paths', () => {
  it('records depth, parent and subtree height of every folder', () => {
    const index = buildFolderIndex(TREE)
    expect(index.get('a')).toMatchObject({ depth: 1, parentId: null, height: 3 })
    expect(index.get('a1')).toMatchObject({ depth: 2, parentId: 'a', height: 2 })
    expect(index.get('a1x')).toMatchObject({ depth: 3, parentId: 'a1', height: 1 })
    expect(index.get('b')).toMatchObject({ depth: 1, height: 1 })
  })

  it('gives the root-first path of a folder, empty for the root', () => {
    const index = buildFolderIndex(TREE)
    expect(folderPath(index, 'a1x').map((p) => p.id)).toEqual(['a', 'a1', 'a1x'])
    expect(folderPath(index, null)).toEqual([])
    expect(folderPath(index, 'gone')).toEqual([])
  })

  it('expands the root and every ancestor of a folder so it is visible', () => {
    const index = buildFolderIndex(TREE)
    expect(expandKeysFor(index, 'a1x')).toEqual([ROOT_KEY, 'a', 'a1'])
    expect(expandKeysFor(index, null)).toEqual([ROOT_KEY])
  })

  it('V1-3: expands a parent folder and all its ancestors so a newly created child under it is visible', () => {
    const index = buildFolderIndex(TREE)
    expect(expandParentAndAncestorsFor(index, 'a1')).toEqual([ROOT_KEY, 'a', 'a1'])
    expect(expandParentAndAncestorsFor(index, 'a')).toEqual([ROOT_KEY, 'a'])
    expect(expandParentAndAncestorsFor(index, null)).toEqual([ROOT_KEY])
    expect(expandParentAndAncestorsFor(index, 'unknown')).toEqual([ROOT_KEY, 'unknown'])
  })
})

describe('tree rows (role=tree)', () => {
  it('shows only the root row while it is collapsed', () => {
    const rows = treeRows(TREE, new Set(), 'UniWork')
    expect(rows.map((r) => r.key)).toEqual([ROOT_KEY])
    expect(rows[0]).toMatchObject({
      level: 1,
      hasChildren: true,
      expanded: false,
      title: 'UniWork',
    })
  })

  it('lists expanded folders depth-first with level, set size and position', () => {
    const rows = treeRows(TREE, new Set([ROOT_KEY, 'a']), 'UniWork')
    expect(rows.map((r) => r.key)).toEqual([ROOT_KEY, 'a', 'a1', 'a2', 'b'])
    expect(rows.find((r) => r.key === 'a1')).toMatchObject({
      level: 3,
      setSize: 2,
      posInSet: 1,
      hasChildren: true,
      expanded: false,
      parentKey: 'a',
    })
    expect(rows.find((r) => r.key === 'b')).toMatchObject({
      level: 2,
      setSize: 2,
      posInSet: 2,
      parentKey: ROOT_KEY,
    })
  })

  it('collapsing a folder hides its whole subtree', () => {
    const rows = treeRows(TREE, new Set([ROOT_KEY, 'a1']), 'UniWork')
    expect(rows.map((r) => r.key)).toEqual([ROOT_KEY, 'a', 'b'])
  })
})

describe('tree keyboard', () => {
  const rows = treeRows(TREE, new Set([ROOT_KEY, 'a']), 'UniWork')

  it('moves with ArrowUp / ArrowDown and stops at the ends', () => {
    expect(treeKey(rows, 'a1', 'ArrowDown')).toEqual({ focus: 'a2' })
    expect(treeKey(rows, 'a1', 'ArrowUp')).toEqual({ focus: 'a' })
    expect(treeKey(rows, 'b', 'ArrowDown')).toEqual({ focus: 'b' })
    expect(treeKey(rows, ROOT_KEY, 'ArrowUp')).toEqual({ focus: ROOT_KEY })
  })

  it('Home / End go to the first / last visible row', () => {
    expect(treeKey(rows, 'a2', 'Home')).toEqual({ focus: ROOT_KEY })
    expect(treeKey(rows, 'a', 'End')).toEqual({ focus: 'b' })
  })

  it('ArrowRight expands a closed folder, then enters its first child', () => {
    expect(treeKey(rows, 'a1', 'ArrowRight')).toEqual({ expand: 'a1' })
    expect(treeKey(rows, 'a', 'ArrowRight')).toEqual({ focus: 'a1' })
    // a leaf has nothing to open
    expect(treeKey(rows, 'b', 'ArrowRight')).toBeNull()
  })

  it('ArrowLeft collapses an open folder, else goes to the parent', () => {
    expect(treeKey(rows, 'a', 'ArrowLeft')).toEqual({ collapse: 'a' })
    expect(treeKey(rows, 'a2', 'ArrowLeft')).toEqual({ focus: 'a' })
    expect(treeKey(rows, 'b', 'ArrowLeft')).toEqual({ focus: ROOT_KEY })
  })

  it('Enter opens, F2 renames, Shift+F10 / ContextMenu opens the menu', () => {
    expect(treeKey(rows, 'a1', 'Enter')).toEqual({ open: 'a1' })
    expect(treeKey(rows, 'a1', 'F2')).toEqual({ rename: 'a1' })
    expect(treeKey(rows, 'a1', 'F10', { shift: true })).toEqual({ menu: 'a1' })
    expect(treeKey(rows, 'a1', 'ContextMenu')).toEqual({ menu: 'a1' })
    // the workspace root cannot be renamed
    expect(treeKey(rows, ROOT_KEY, 'F2')).toBeNull()
    expect(treeKey(rows, 'a1', 'x')).toBeNull()
  })
})

describe('move targets (disabled with a reason)', () => {
  const index = buildFolderIndex(TREE)
  const movingA = { id: 'a', kind: 'folder' as const, parentId: null }

  it('the current location is disabled', () => {
    expect(moveBlockOf(index, movingA, null)).toBe('current')
    expect(moveBlockOf(index, { id: 'd1', kind: 'file', parentId: 'b' }, 'b')).toBe('current')
  })

  it('a folder cannot go into itself or any descendant', () => {
    expect(moveBlockOf(index, movingA, 'a')).toBe('inside')
    expect(moveBlockOf(index, movingA, 'a1')).toBe('inside')
    expect(moveBlockOf(index, movingA, 'a1x')).toBe('inside')
    expect(moveBlockOf(index, movingA, 'b')).toBeNull()
    // a file has no subtree
    expect(moveBlockOf(index, { id: 'd1', kind: 'file', parentId: null }, 'a1x')).toBeNull()
  })

  it('a target that would push the moved subtree past depth 20 is too deep', () => {
    const deep = buildFolderIndex([...chain(FOLDER_MAX_DEPTH), node('x', 'X', [node('x1', 'X1')])])
    const movingX = { id: 'x', kind: 'folder' as const, parentId: null }
    // x (height 2) under f18 lands at depth 19..20: allowed; under f19 its child is at 21
    expect(moveBlockOf(deep, movingX, 'f18')).toBeNull()
    expect(moveBlockOf(deep, movingX, 'f19')).toBe('deep')
    // a file under the deepest folder is at 21
    expect(moveBlockOf(deep, { id: 'd', kind: 'file', parentId: null }, 'f20')).toBe('deep')
    expect(moveBlockOf(deep, { id: 'd', kind: 'file', parentId: null }, 'f19')).toBeNull()
  })

  it('a new document (no moving item) is only refused by depth', () => {
    const deep = buildFolderIndex(chain(FOLDER_MAX_DEPTH))
    expect(moveBlockOf(deep, null, 'f20')).toBe('deep')
    expect(moveBlockOf(deep, null, null)).toBeNull()
    expect(moveBlockOf(deep, null, 'f3')).toBeNull()
  })
})

describe('breadcrumb', () => {
  const p = (...ids: string[]) => ids.map((id) => ({ id, title: id.toUpperCase() }))

  it('shows every level up to 4 (root included)', () => {
    expect(breadcrumbOf([], 'UniWork')).toEqual([{ kind: 'item', id: null, title: 'UniWork' }])
    expect(
      breadcrumbOf(p('a', 'b', 'c'), 'UniWork').map((c) => (c.kind === 'item' ? c.title : '…')),
    ).toEqual(['UniWork', 'A', 'B', 'C'])
  })

  it('collapses more than 4 levels to root, …, parent, leaf', () => {
    const crumbs = breadcrumbOf(p('a', 'b', 'c', 'd', 'e'), 'UniWork')
    expect(crumbs).toEqual([
      { kind: 'item', id: null, title: 'UniWork' },
      { kind: 'more', hidden: p('a', 'b', 'c') },
      { kind: 'item', id: 'd', title: 'D' },
      { kind: 'item', id: 'e', title: 'E' },
    ])
  })
})

describe('contents view', () => {
  const items = [
    doc('f2', 'beta', { kind: 'folder', format: null, updatedAt: '2026-10-04T00:00:00Z' }),
    doc('d1', 'zeta.docx', { updatedAt: '2026-10-03T00:00:00Z' }),
    doc('p1', 'Notes', { kind: 'page', format: null }),
    doc('d2', 'Alpha.xlsx', { format: 'xlsx', updatedAt: '2026-10-05T00:00:00Z' }),
    doc('z1', 'archive.zip', { format: null }),
    doc('f1', 'Ångström', { kind: 'folder', format: null }),
  ]

  it('puts folders first, then files, by name with the UI collator', () => {
    const view = contentsView(items, 'name', 'en-US')
    expect(view.rows.map((r) => r.id)).toEqual(['f1', 'f2', 'd2', 'p1', 'd1'])
  })

  it('sorts by last update, newest first, folders still first', () => {
    const view = contentsView(items, 'updated', 'en-US')
    expect(view.rows.map((r) => r.id)).toEqual(['f2', 'f1', 'd2', 'd1', 'p1'])
  })

  it('lists pages (UniNote, UNI-1953) and hides only files the app cannot open, counting them', () => {
    expect(contentsView(items, 'name', 'en-US').hiddenCount).toBe(1)
    expect(contentsView([doc('d1', 'a.docx')], 'name', 'en-US').hiddenCount).toBe(0)
  })

  it('keeps the server order when no sort applies (search results)', () => {
    const view = contentsView(items, null, 'en-US')
    expect(view.rows.map((r) => r.id)).toEqual(['f2', 'd1', 'p1', 'd2', 'f1'])
  })
})

describe('sort preference (per viewer, storage may fail)', () => {
  it('round-trips the choice and falls back to name', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    expect(readSortMode(storage)).toBe('name')
    writeSortMode('updated', storage)
    expect(readSortMode(storage)).toBe('updated')
    store.set([...store.keys()][0]!, 'bogus')
    expect(readSortMode(storage)).toBe('name')
  })

  it('never throws when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readSortMode(broken)).toBe('name')
    expect(() => writeSortMode('updated', broken)).not.toThrow()
  })
})

describe('fallback when the open folder vanishes', () => {
  it('stays when the folder is still there', () => {
    const index = buildFolderIndex(TREE)
    expect(liveFallback(index, ['a', 'a1'])).toEqual({ folderId: 'a1', gone: false })
    expect(liveFallback(index, [])).toEqual({ folderId: null, gone: false })
  })

  it('goes to the nearest live ancestor, else the root', () => {
    const index = buildFolderIndex([node('a', 'Alpha')])
    expect(liveFallback(index, ['a', 'a1', 'a1x'])).toEqual({ folderId: 'a', gone: true })
    expect(liveFallback(buildFolderIndex([]), ['a', 'a1'])).toEqual({ folderId: null, gone: true })
  })
})

describe('stale responses', () => {
  it('only the latest request id is current', () => {
    const gate = createRequestGate()
    const first = gate.next()
    const second = gate.next()
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })
})

describe('search path', () => {
  it('left-truncates to the direct parent; full path for the title', () => {
    const path = [
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ]
    expect(shortPath(path, 'UniWork')).toEqual({
      short: '… › Beta ›',
      full: 'UniWork › Alpha › Beta',
    })
    expect(shortPath([{ id: 'a', title: 'Alpha' }], 'UniWork')).toEqual({
      short: 'UniWork › Alpha ›',
      full: 'UniWork › Alpha',
    })
    expect(shortPath([], 'UniWork')).toEqual({ short: 'UniWork ›', full: 'UniWork' })
  })
})

describe('folder names', () => {
  it('trims and NFC-normalizes like the server, 1-255 runes', () => {
    expect(checkFolderName('  Hợp đồng  ')).toEqual({ ok: true, name: 'Hợp đồng'.normalize('NFC') })
    expect(checkFolderName('Café')).toEqual({ ok: true, name: 'Café' })
    expect(checkFolderName('   ')).toEqual({ ok: false, error: 'name_empty' })
    expect(checkFolderName('x'.repeat(255))).toMatchObject({ ok: true })
    expect(checkFolderName('x'.repeat(256))).toEqual({ ok: false, error: 'name_too_long' })
    // runes, not UTF-16 units
    expect(checkFolderName('😀'.repeat(255))).toMatchObject({ ok: true })
  })
})

describe('folder action failures', () => {
  it('keeps name errors at the field and maps the tree refusals to their copy', () => {
    expect(folderActionFailure('folder_name_taken')).toEqual({ field: 'folder_name_taken' })
    expect(folderActionFailure('name_too_long')).toEqual({ field: 'name_too_long' })
    expect(folderActionFailure('move_name_taken')).toEqual({ key: 'ufMoveNameTaken' })
    expect(folderActionFailure('document_too_deep', 20)).toEqual({
      key: 'ufTooDeep',
      params: { max: 20 },
    })
    expect(folderActionFailure('document_too_deep')).toEqual({
      key: 'ufTooDeep',
      params: { max: 20 },
    })
    expect(folderActionFailure('document_cycle')).toEqual({ key: 'ufCycle' })
    expect(folderActionFailure('document_parent_kind')).toEqual({ key: 'ufParentKind' })
    expect(folderActionFailure('forbidden')).toEqual({ key: 'ufNoPermission' })
    expect(folderActionFailure('network')).toEqual({ key: 'uwDocActionFailed' })
  })
})
