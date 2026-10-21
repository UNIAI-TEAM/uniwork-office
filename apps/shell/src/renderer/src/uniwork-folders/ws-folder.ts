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

const subtreeMemo = new WeakMap<FolderIndex, ReadonlySet<string>>()

/**
 * My Folder and every folder under it; empty when the index holds no My Folder. Memoized per
 * index: the picker asks once per visible row on every render, and an index is never mutated
 * after `buildFolderIndex`.
 */
export function myFolderSubtreeIds(index: FolderIndex): ReadonlySet<string> {
  const memo = subtreeMemo.get(index)
  if (memo) return memo
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
  subtreeMemo.set(index, mine)
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

/** The workspace roles of a person (not a viewer, guest or agent): they add content to a workspace folder. */
export function isHumanMemberRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'member'
}

/**
 * Whether a folder created under `parentId` (null = the workspace root) shows its name to the
 * whole workspace: the root and a workspace folder do, My Folder and everything under it do not.
 * A parent the index does not hold is judged from `parentRow` (the row the dialog was opened
 * from); without either it is not a workspace folder (no guess, so no note). Ported from the
 * web's `newFolderIsWorkspaceVisible`.
 */
export function newFolderIsWorkspaceVisible(
  parentId: string | null,
  index: FolderIndex,
  parentRow?: WorkspaceFolderCandidate,
): boolean {
  if (parentId === null) return true
  return isWorkspaceFolder({ ...parentRow, id: parentId, kind: parentRow?.kind ?? 'folder' }, index)
}

/**
 * May the person create inside this folder: at the edit level (`canEdit` true, or not known yet,
 * as the other folder menus read it), or as a human workspace member in a workspace folder even
 * at the view level. Rename / move / trash do not take this rule: they follow the level. The role
 * comes from the workspace list (`myRole`); an unknown role never widens the level. Ported from
 * the web's `canCreateInsideFolder`.
 */
export function canCreateInsideFolder(
  entry: WorkspaceFolderCandidate & { canEdit?: boolean },
  index: FolderIndex,
  role: string | null | undefined,
): boolean {
  if (entry.kind !== undefined && entry.kind !== 'folder') return false
  if (entry.canEdit !== false) return true
  return isHumanMemberRole(role) && isWorkspaceFolder(entry, index)
}
