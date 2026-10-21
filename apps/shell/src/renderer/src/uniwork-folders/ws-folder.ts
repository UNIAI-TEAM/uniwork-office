import type { UniworkEntryKind, UniworkSystemKind } from '../../../shared/home-api'
import type { FolderIndex } from './uniwork-folders-model'

/**
 * UNI-2066: the workspace-folder rules, as pure functions over the folder index.
 *
 * A folder outside the caller's My Folder subtree is a workspace folder: every
 * member sees it, while the documents inside keep their own access. The tree
 * carries no `visibility`, so the rule is ancestry - a folder that is not My
 * Folder and does not sit under it. A list row may add `visibility` /
 * `systemKind` for a folder the index does not hold yet. Ported from the web's
 * `document-tree-model.ts` (`workspaceFolderIntoMyFolder`, `folderLeavesMyFolder`)
 * and `core/types/document.ts` (`isWorkspaceFolder`).
 *
 * The index holds folders only: an id it does not hold (a document, a stale
 * row) is never judged as a folder, and a target it does not hold is never
 * inside My Folder.
 */

/** What `isWorkspaceFolder` reads off a tree node or a list row. */
export interface WorkspaceFolderCandidate {
  id: string
  /** absent on a tree node (every node is a folder) */
  kind?: UniworkEntryKind
  systemKind?: UniworkSystemKind
  visibility?: 'private' | 'workspace' | 'restricted'
}

/** My Folder and every folder under it; empty when the index holds no My Folder. */
export function myFolderSubtreeIds(index: FolderIndex): ReadonlySet<string> {
  const mine = new Set<string>()
  for (const info of index.values()) {
    if (info.systemKind === 'my_folder') {
      const stack = [info.id]
      while (stack.length > 0) {
        const id = stack.pop()!
        if (mine.has(id)) continue
        mine.add(id)
        stack.push(...(index.get(id)?.childIds ?? []))
      }
    }
  }
  return mine
}

/** Whether `id` is My Folder or one of its descendants; the root (null) and unknown ids are not. */
export function isInsideMyFolder(id: string | null, index: FolderIndex): boolean {
  return id !== null && myFolderSubtreeIds(index).has(id)
}

/**
 * Whether the entry is a workspace folder. A folder the index holds is decided by
 * ancestry alone (outside My Folder = workspace); one it does not hold falls back
 * to the row's own `visibility: 'workspace'`, and without that it is not judged
 * (no guess, so no workspace note and no lock).
 */
export function isWorkspaceFolder(
  entry: WorkspaceFolderCandidate | null | undefined,
  index: FolderIndex,
): boolean {
  if (!entry || (entry.kind !== undefined && entry.kind !== 'folder')) return false
  if (entry.systemKind === 'my_folder') return false
  if (index.has(entry.id)) return !isInsideMyFolder(entry.id, index)
  return entry.visibility === 'workspace'
}

/**
 * Moving a folder from inside My Folder to a place outside it (`target` null = the
 * workspace root) turns it, and its sub-folders, into workspace folders, so the person
 * confirms first. True when any of `ids` is a folder under My Folder (not My Folder
 * itself) and the target is outside the subtree. Documents move freely: only folders count.
 */
export function folderLeavesMyFolder(
  ids: readonly string[],
  target: string | null,
  index: FolderIndex,
): boolean {
  const mine = myFolderSubtreeIds(index)
  if (target !== null && mine.has(target)) return false
  return ids.some((id) => mine.has(id) && index.get(id)?.systemKind !== 'my_folder')
}

/**
 * A workspace folder never lands in My Folder or under it (the server answers the same
 * move 422 `folder_into_my_folder`). True when any of `ids` is a folder outside the My
 * Folder subtree and `target` is My Folder or one of its descendants. An id the index
 * does not hold is not judged here.
 */
export function workspaceFolderIntoMyFolder(
  ids: readonly string[],
  target: string | null,
  index: FolderIndex,
): boolean {
  if (target === null) return false
  const mine = myFolderSubtreeIds(index)
  if (!mine.has(target)) return false
  return ids.some((id) => index.has(id) && !mine.has(id))
}
