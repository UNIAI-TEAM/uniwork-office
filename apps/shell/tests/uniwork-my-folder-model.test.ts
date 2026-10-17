import { describe, expect, it } from 'vitest'
import type { UniworkDocSummary, UniworkFolderNode } from '../src/shared/home-api'
import {
  MY_FOLDER_LABEL_KEY,
  contentsView,
  entryTitleOf,
  filterFolderTree,
  folderEditActionsOffered,
  folderVisibilityTagOf,
  isMyFolder,
  labelMyFolderPath,
  myFolderFirst,
  myFolderIdOf,
  treeRows,
  withMyFolderLabel,
} from '../src/renderer/src/uniwork-folders/uniwork-folders-model'

/**
 * MYFOLDER-01 / SAVE-01 §4 (AC-5): the one helper set behind "My Folder
 * everywhere" - the label comes from `systemKind`, never the stored title; the
 * row sorts first; rename/move/archive/share are not offered on it; only its
 * visibility is known to the tree.
 */

function node(
  id: string,
  title: string,
  children: UniworkFolderNode[] = [],
  extra: Partial<UniworkFolderNode> = {},
): UniworkFolderNode {
  return {
    id,
    parentId: null,
    title,
    position: 0,
    children: children.map((c) => ({ ...c, parentId: id })),
    ...extra,
  }
}

const mine = (title = 'My Folder') =>
  node('mf', title, [node('mf1', 'Drafts')], { systemKind: 'my_folder' })

function row(id: string, title: string, extra: Partial<UniworkDocSummary> = {}): UniworkDocSummary {
  return {
    id,
    workspaceId: 'w1',
    title,
    format: null,
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'folder',
    parentId: null,
    ...extra,
  }
}

describe('My Folder model (MYFOLDER-01)', () => {
  it('the label key is the uniwork-save usMyFolder key', () => {
    expect(MY_FOLDER_LABEL_KEY).toBe('usMyFolder')
  })

  it('isMyFolder reads systemKind only, never the title', () => {
    expect(isMyFolder({ systemKind: 'my_folder' })).toBe(true)
    expect(isMyFolder(node('x', 'My Folder'))).toBe(false)
    expect(isMyFolder(undefined)).toBe(false)
    expect(isMyFolder(null)).toBe(false)
  })

  it('withMyFolderLabel shows the localized label (stored title ignored) and sorts My Folder first', () => {
    const nodes = [node('a', 'Alpha'), mine('Stored name nobody sees'), node('b', 'My Folder')]
    const out = withMyFolderLabel(nodes, 'Thư mục của tôi')
    expect(out.map((n) => [n.id, n.title])).toEqual([
      ['mf', 'Thư mục của tôi'],
      ['a', 'Alpha'],
      // a user folder that happens to be named "My Folder" keeps its own title (ADD:13)
      ['b', 'My Folder'],
    ])
    // children keep their own titles and order; the input is not mutated
    expect(out[0]!.children.map((c) => c.title)).toEqual(['Drafts'])
    expect(nodes[1]!.title).toBe('Stored name nobody sees')
  })

  it('withMyFolderLabel keeps the server order when there is no My Folder', () => {
    const nodes = [node('b', 'Beta'), node('a', 'Alpha')]
    expect(withMyFolderLabel(nodes, 'X').map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('myFolderIdOf finds the marked row at any depth', () => {
    expect(myFolderIdOf([node('a', 'Alpha'), mine()])).toBe('mf')
    expect(myFolderIdOf([node('a', 'Alpha', [mine()])])).toBe('mf')
    expect(myFolderIdOf([node('a', 'My Folder')])).toBeNull()
  })

  it('labelMyFolderPath relabels My Folder by id inside a root-first path', () => {
    const path = [
      { id: 'mf', title: 'My Folder' },
      { id: 'mf1', title: 'Drafts' },
    ]
    expect(labelMyFolderPath(path, 'mf', 'Mi carpeta')).toEqual([
      { id: 'mf', title: 'Mi carpeta' },
      { id: 'mf1', title: 'Drafts' },
    ])
    expect(labelMyFolderPath(path, null, 'Mi carpeta')).toEqual(path)
  })

  it('entryTitleOf and contentsView: the label for the marked row, sorted first in every mode', () => {
    const rows = [
      row('a', 'Alpha'),
      row('d', 'Report.docx', { kind: 'file', format: 'docx' }),
      row('mf', 'Zzz stored', { systemKind: 'my_folder' }),
    ]
    expect(entryTitleOf(rows[2]!, 'My Folder')).toBe('My Folder')
    expect(entryTitleOf(rows[0]!, 'My Folder')).toBe('Alpha')
    for (const mode of ['name', 'updated', null] as const) {
      expect(contentsView(rows, mode, 'en').rows[0]!.id).toBe('mf')
    }
    expect(myFolderFirst(rows).map((r) => r.id)).toEqual(['mf', 'a', 'd'])
  })

  it('treeRows carries systemKind so the tree can hide its actions', () => {
    const rows = treeRows([mine(), node('a', 'Alpha')], new Set(['']), 'UniWork')
    expect(rows.find((r) => r.id === 'mf')?.systemKind).toBe('my_folder')
    expect(rows.find((r) => r.id === 'a')?.systemKind).toBeUndefined()
  })

  it('folderEditActionsOffered: never on My Folder (Q2), always on other rows', () => {
    expect(folderEditActionsOffered({ systemKind: 'my_folder' })).toBe(false)
    expect(folderEditActionsOffered({})).toBe(true)
  })

  it('folderVisibilityTagOf: only My Folder has a known tag (the tree carries no visibility)', () => {
    expect(folderVisibilityTagOf({ systemKind: 'my_folder' })).toBe('usPrivateTag')
    expect(folderVisibilityTagOf({})).toBeNull()
  })

  it('filterFolderTree keeps matches and their ancestors, case- and accent-insensitive', () => {
    const nodes = [
      node('a', 'Hợp đồng', [node('a1', 'Khách hàng')]),
      node('b', 'Dự án', [node('b1', 'Hop dong cu')]),
      node('c', 'Khác'),
    ]
    const out = filterFolderTree(nodes, 'hop dong')
    expect(out.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    // a matching folder keeps its subtree; a non-matching ancestor keeps only the matching path
    expect(out.nodes[0]!.children.map((c) => c.id)).toEqual(['a1'])
    expect(out.nodes[1]!.children.map((c) => c.id)).toEqual(['b1'])
    expect(out.expand.sort()).toEqual(['', 'b'].sort())
    expect(filterFolderTree(nodes, '  ').nodes).toBe(nodes)
  })
})
