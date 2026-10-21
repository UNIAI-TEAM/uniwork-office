import { describe, expect, it } from 'vitest'
import type { UniworkDocSummary, UniworkFolderNode } from '../src/shared/home-api'
import { buildFolderIndex } from '../src/renderer/src/uniwork-folders/uniwork-folders-model'
import {
  folderLeavesMyFolder,
  isInsideMyFolder,
  isWorkspaceFolder,
  myFolderSubtreeIds,
  workspaceFolderIntoMyFolder,
} from '../src/renderer/src/uniwork-folders/ws-folder'

/**
 * UNI-2066 WS-A: the pure workspace-folder rules (contract §1), ported from the
 * web's document-tree-model.ts / folder-picker-dialog.tsx. The fake tree:
 *
 *   MY (system my_folder)         WS1            WS2
 *   └ MY_A                        └ WS1_A
 *     └ MY_A1                       └ WS1_A1
 *
 * The folder index only holds folders, so an id it does not hold (a document,
 * a stale row) is never judged as a folder.
 */

function node(
  id: string,
  children: UniworkFolderNode[] = [],
  systemKind?: 'my_folder',
): UniworkFolderNode {
  return {
    id,
    parentId: null,
    title: id,
    position: 0,
    children,
    ...(systemKind ? { systemKind } : {}),
  }
}

const tree = [
  node('MY', [node('MY_A', [node('MY_A1')])], 'my_folder'),
  node('WS1', [node('WS1_A', [node('WS1_A1')])]),
  node('WS2'),
]
const index = buildFolderIndex(tree)

/** the same forest with no My Folder (the caller has not created one yet) */
const noMyFolderIndex = buildFolderIndex([node('WS1', [node('WS1_A')]), node('WS2')])

const row = (extra: Partial<UniworkDocSummary> & { id: string }): UniworkDocSummary => ({
  workspaceId: 'ws_1',
  title: extra.id,
  format: null,
  updatedAt: '',
  kind: 'folder',
  ...extra,
})

describe('buildFolderIndex keeps the My Folder marker', () => {
  it('marks only the My Folder entry, and leaves other entries without the key', () => {
    expect(index.get('MY')!.systemKind).toBe('my_folder')
    expect('systemKind' in index.get('MY_A')!).toBe(false)
    expect('systemKind' in index.get('WS1')!).toBe(false)
  })
})

describe('isInsideMyFolder', () => {
  it('is true for My Folder itself and every descendant', () => {
    for (const id of ['MY', 'MY_A', 'MY_A1']) expect(isInsideMyFolder(id, index)).toBe(true)
  })

  it('is false for folders outside it', () => {
    for (const id of ['WS1', 'WS1_A', 'WS1_A1', 'WS2']) {
      expect(isInsideMyFolder(id, index)).toBe(false)
    }
  })

  it('is false for the root, an unknown id and an empty index', () => {
    expect(isInsideMyFolder(null, index)).toBe(false)
    expect(isInsideMyFolder('', index)).toBe(false)
    expect(isInsideMyFolder('nope', index)).toBe(false)
    expect(isInsideMyFolder('MY', buildFolderIndex([]))).toBe(false)
    expect(isInsideMyFolder('WS1', noMyFolderIndex)).toBe(false)
  })
})

describe('myFolderSubtreeIds', () => {
  it('holds My Folder and everything under it, or nothing without a My Folder', () => {
    expect([...myFolderSubtreeIds(index)].sort()).toEqual(['MY', 'MY_A', 'MY_A1'])
    expect(myFolderSubtreeIds(noMyFolderIndex).size).toBe(0)
  })
})

describe('isWorkspaceFolder', () => {
  it('is true for a tree node outside My Folder, at any depth', () => {
    for (const id of ['WS1', 'WS1_A', 'WS1_A1', 'WS2']) {
      expect(isWorkspaceFolder({ id }, index)).toBe(true)
    }
  })

  it('is false for My Folder and its sub-folders', () => {
    expect(isWorkspaceFolder({ id: 'MY', systemKind: 'my_folder' }, index)).toBe(false)
    expect(isWorkspaceFolder({ id: 'MY_A' }, index)).toBe(false)
    expect(isWorkspaceFolder({ id: 'MY_A1' }, index)).toBe(false)
  })

  it('is false for a row that is not a folder', () => {
    expect(
      isWorkspaceFolder(row({ id: 'WS1', kind: 'file', visibility: 'workspace' }), index),
    ).toBe(false)
    expect(isWorkspaceFolder(row({ id: 'WS1', kind: 'page' }), index)).toBe(false)
  })

  it('judges a row the index holds by its ancestry, whatever its visibility says', () => {
    expect(isWorkspaceFolder(row({ id: 'WS1_A', visibility: 'private' }), index)).toBe(true)
    expect(isWorkspaceFolder(row({ id: 'MY_A', visibility: 'workspace' }), index)).toBe(false)
  })

  it('judges a row the index does not hold by its own visibility and systemKind', () => {
    expect(isWorkspaceFolder(row({ id: 'late', visibility: 'workspace' }), index)).toBe(true)
    expect(isWorkspaceFolder(row({ id: 'late', visibility: 'restricted' }), index)).toBe(false)
    expect(isWorkspaceFolder(row({ id: 'late', visibility: 'private' }), index)).toBe(false)
    expect(
      isWorkspaceFolder(
        row({ id: 'late', visibility: 'workspace', systemKind: 'my_folder' }),
        index,
      ),
    ).toBe(false)
  })

  it('does not guess for a node the index does not hold and a row without visibility', () => {
    expect(isWorkspaceFolder({ id: 'late' }, index)).toBe(false)
    expect(isWorkspaceFolder(row({ id: 'late' }), index)).toBe(false)
    expect(isWorkspaceFolder(null, index)).toBe(false)
    expect(isWorkspaceFolder(undefined, index)).toBe(false)
  })

  it('treats every known folder as a workspace folder when there is no My Folder', () => {
    expect(isWorkspaceFolder({ id: 'WS1_A' }, noMyFolderIndex)).toBe(true)
  })
})

describe('folderLeavesMyFolder', () => {
  it('is true for a folder inside My Folder moved to the root or to a workspace folder', () => {
    expect(folderLeavesMyFolder(['MY_A'], null, index)).toBe(true)
    expect(folderLeavesMyFolder(['MY_A'], 'WS1', index)).toBe(true)
    expect(folderLeavesMyFolder(['MY_A1'], 'WS1_A', index)).toBe(true)
  })

  it('is false while the target stays inside My Folder (root of it included)', () => {
    expect(folderLeavesMyFolder(['MY_A1'], 'MY', index)).toBe(false)
    expect(folderLeavesMyFolder(['MY_A1'], 'MY_A', index)).toBe(false)
  })

  it('is false for My Folder itself, which never moves out as a folder to confirm', () => {
    expect(folderLeavesMyFolder(['MY'], null, index)).toBe(false)
  })

  it('is false for workspace folders and for ids the index does not hold (documents)', () => {
    expect(folderLeavesMyFolder(['WS1_A'], 'WS2', index)).toBe(false)
    expect(folderLeavesMyFolder(['doc_1'], null, index)).toBe(false)
    expect(folderLeavesMyFolder([], null, index)).toBe(false)
  })

  it('is true when any one of several ids leaves', () => {
    expect(folderLeavesMyFolder(['doc_1', 'WS1_A', 'MY_A'], 'WS2', index)).toBe(true)
  })

  it('is false without a My Folder', () => {
    expect(folderLeavesMyFolder(['WS1_A'], null, noMyFolderIndex)).toBe(false)
  })
})

describe('workspaceFolderIntoMyFolder', () => {
  it('is true for a workspace folder into My Folder or any folder under it', () => {
    expect(workspaceFolderIntoMyFolder(['WS1'], 'MY', index)).toBe(true)
    expect(workspaceFolderIntoMyFolder(['WS1_A'], 'MY_A', index)).toBe(true)
    expect(workspaceFolderIntoMyFolder(['WS2'], 'MY_A1', index)).toBe(true)
  })

  it('is false to the root and to any workspace folder', () => {
    expect(workspaceFolderIntoMyFolder(['WS1'], null, index)).toBe(false)
    expect(workspaceFolderIntoMyFolder(['WS1'], 'WS2', index)).toBe(false)
  })

  it('is false for a folder that already lives in My Folder', () => {
    expect(workspaceFolderIntoMyFolder(['MY_A1'], 'MY', index)).toBe(false)
    expect(workspaceFolderIntoMyFolder(['MY_A'], 'MY_A1', index)).toBe(false)
  })

  it('does not judge documents or unknown ids, but one workspace folder in the set decides', () => {
    expect(workspaceFolderIntoMyFolder(['doc_1'], 'MY', index)).toBe(false)
    expect(workspaceFolderIntoMyFolder(['nope'], 'MY', index)).toBe(false)
    expect(workspaceFolderIntoMyFolder(['doc_1', 'WS1'], 'MY', index)).toBe(true)
    expect(workspaceFolderIntoMyFolder([], 'MY', index)).toBe(false)
  })

  it('is false for an unknown target and without a My Folder', () => {
    expect(workspaceFolderIntoMyFolder(['WS1'], 'nope', index)).toBe(false)
    expect(workspaceFolderIntoMyFolder(['WS1_A'], 'WS2', noMyFolderIndex)).toBe(false)
  })
})
