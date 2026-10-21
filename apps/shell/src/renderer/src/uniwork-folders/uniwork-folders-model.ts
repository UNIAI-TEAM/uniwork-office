import type {
  UniworkDocActionError,
  UniworkDocSummary,
  UniworkEntryKind,
  UniworkFolderNode,
  UniworkSystemKind,
} from '../../../shared/home-api'
import type { StringKey } from '../locale'
import { isOpenable, type DocNameError } from '../uniwork-docs-model'

/**
 * FD-11 (UNI-1809) folder tree model: what UniworkFolderTree, UniworkBrowser
 * and UniworkFolderPicker show for a server tree. Pure (no React, no window
 * besides the storage passed in) so the rules are unit-tested. The server is
 * the only source of truth: nothing here is persisted except the viewer's sort
 * choice.
 */

/** the tree row of the workspace root ("UniWork"); never a document id */
export const ROOT_KEY = ''
/** the server's depth cap for documents (folders addendum §3.5) */
export const FOLDER_MAX_DEPTH = 20
/** a folder title is 1-255 runes on the server (documents: 500) */
export const FOLDER_NAME_MAX_RUNES = 255

export interface FolderInfo {
  id: string
  title: string
  parentId: string | null
  /** 1 for a folder at the workspace root */
  depth: number
  /** levels this folder occupies with its subtree (1 = no subfolders) */
  height: number
  childIds: string[]
}

export type FolderIndex = ReadonlyMap<string, FolderInfo>

export function buildFolderIndex(nodes: UniworkFolderNode[]): FolderIndex {
  const index = new Map<string, FolderInfo>()
  const visit = (node: UniworkFolderNode, parentId: string | null, depth: number): number => {
    const info: FolderInfo = {
      id: node.id,
      title: node.title,
      parentId,
      depth,
      height: 1,
      childIds: node.children.map((c) => c.id),
    }
    index.set(node.id, info)
    for (const child of node.children) {
      info.height = Math.max(info.height, 1 + visit(child, node.id, depth + 1))
    }
    return info.height
  }
  for (const node of nodes) visit(node, null, 1)
  return index
}

export interface PathPart {
  id: string
  title: string
}

/** root-first ancestors of a folder, itself included; [] for the root or an unknown id */
export function folderPath(index: FolderIndex, id: string | null): PathPart[] {
  const path: PathPart[] = []
  let at = id ? index.get(id) : undefined
  while (at) {
    path.unshift({ id: at.id, title: at.title })
    at = at.parentId ? index.get(at.parentId) : undefined
  }
  return path
}

/** the tree keys to expand so a folder's row is visible (the root first) */
export function expandKeysFor(index: FolderIndex, id: string | null): string[] {
  return [
    ROOT_KEY,
    ...folderPath(index, id)
      .slice(0, -1)
      .map((p) => p.id),
  ]
}

/** the tree keys to expand so a child inside `parentId` (null = root) is visible */
export function expandParentAndAncestorsFor(index: FolderIndex, parentId: string | null): string[] {
  if (parentId === null) return [ROOT_KEY]
  const path = folderPath(index, parentId)
  return path.length > 0 ? [ROOT_KEY, ...path.map((p) => p.id)] : [ROOT_KEY, parentId]
}

// ── Tree rows ───────────────────────────────────────────

export interface TreeRow {
  key: string
  /** null for the workspace root */
  id: string | null
  title: string
  /** aria-level: the root row is 1 */
  level: number
  hasChildren: boolean
  expanded: boolean
  setSize: number
  posInSet: number
  parentKey: string | null
  /** MYFOLDER-01: the server's marker (My Folder hides its rename / move) */
  systemKind?: UniworkSystemKind
}

/** the visible rows, depth-first; a collapsed folder hides its subtree */
export function treeRows(
  nodes: UniworkFolderNode[],
  expanded: ReadonlySet<string>,
  rootTitle: string,
): TreeRow[] {
  const rootOpen = expanded.has(ROOT_KEY)
  const rows: TreeRow[] = [
    {
      key: ROOT_KEY,
      id: null,
      title: rootTitle,
      level: 1,
      hasChildren: nodes.length > 0,
      expanded: rootOpen,
      setSize: 1,
      posInSet: 1,
      parentKey: null,
    },
  ]
  const walk = (list: UniworkFolderNode[], level: number, parentKey: string) => {
    list.forEach((node, i) => {
      const open = expanded.has(node.id)
      rows.push({
        key: node.id,
        id: node.id,
        title: node.title,
        level,
        hasChildren: node.children.length > 0,
        expanded: open,
        setSize: list.length,
        posInSet: i + 1,
        parentKey,
        ...(node.systemKind ? { systemKind: node.systemKind } : {}),
      })
      if (open) walk(node.children, level + 1, node.id)
    })
  }
  if (rootOpen) walk(nodes, 2, ROOT_KEY)
  return rows
}

export type TreeKeyResult =
  | { focus: string }
  | { expand: string }
  | { collapse: string }
  | { open: string }
  | { rename: string }
  | { menu: string }
  | null

/** what a key on the focused tree row does (WAI-ARIA tree view pattern) */
export function treeKey(
  rows: TreeRow[],
  focusKey: string,
  key: string,
  mods: { shift?: boolean } = {},
): TreeKeyResult {
  const at = rows.findIndex((r) => r.key === focusKey)
  const row = rows[at]
  if (!row) return rows[0] ? { focus: rows[0].key } : null
  switch (key) {
    case 'ArrowDown':
      return { focus: rows[Math.min(at + 1, rows.length - 1)]!.key }
    case 'ArrowUp':
      return { focus: rows[Math.max(at - 1, 0)]!.key }
    case 'Home':
      return { focus: rows[0]!.key }
    case 'End':
      return { focus: rows[rows.length - 1]!.key }
    case 'ArrowRight':
      if (!row.hasChildren) return null
      return row.expanded ? { focus: rows[at + 1]!.key } : { expand: row.key }
    case 'ArrowLeft':
      if (row.expanded && row.hasChildren) return { collapse: row.key }
      return row.parentKey !== null ? { focus: row.parentKey } : null
    case 'Enter':
      return { open: row.key }
    case 'F2':
      return row.id ? { rename: row.key } : null
    case 'ContextMenu':
      return { menu: row.key }
    case 'F10':
      return mods.shift ? { menu: row.key } : null
    default:
      return null
  }
}

// ── Move / placement targets ────────────────────────────

/**
 * why a folder cannot take the item: visible but aria-disabled, with this
 * reason. `root` is a picker that places into folders only (SAVE-01 first
 * save, New / Upload whose top level is My Folder).
 */
export type MoveBlock = 'current' | 'inside' | 'deep' | 'root' | null

export interface MovingItem {
  id: string
  kind: UniworkEntryKind
  parentId: string | null
}

export const MOVE_BLOCK_KEYS: Record<Exclude<MoveBlock, null>, StringKey> = {
  current: 'ufDisabledCurrent',
  inside: 'ufDisabledInside',
  deep: 'ufDisabledDeep',
  root: 'usRootBlocked',
}

/**
 * Whether `targetId` (null = the root) can take the item. `moving` null is a
 * new document being placed (New / Upload / Save a copy): only depth applies.
 */
export function moveBlockOf(
  index: FolderIndex,
  moving: MovingItem | null,
  targetId: string | null,
  maxDepth: number = FOLDER_MAX_DEPTH,
): MoveBlock {
  if (moving?.kind === 'folder' && targetId !== null) {
    if (folderPath(index, targetId).some((p) => p.id === moving.id)) return 'inside'
  }
  if (moving && targetId === moving.parentId) return 'current'
  const height = moving?.kind === 'folder' ? (index.get(moving.id)?.height ?? 1) : 1
  const targetDepth = targetId === null ? 0 : (index.get(targetId)?.depth ?? 0)
  return targetDepth + height > maxDepth ? 'deep' : null
}

// ── Breadcrumb ──────────────────────────────────────────

export type Crumb =
  { kind: 'item'; id: string | null; title: string } | { kind: 'more'; hidden: PathPart[] }

/** root > ... > leaf; more than 4 levels: root, "…" (a menu of the hidden levels), parent, leaf */
export function breadcrumbOf(path: PathPart[], rootTitle: string): Crumb[] {
  const root: Crumb = { kind: 'item', id: null, title: rootTitle }
  const items: Crumb[] = path.map((p) => ({ kind: 'item', id: p.id, title: p.title }))
  if (path.length + 1 <= 4) return [root, ...items]
  return [root, { kind: 'more', hidden: path.slice(0, -2) }, ...items.slice(-2)]
}

/**
 * a search hit's path: left-truncated to its direct parent, the full path for `title`. A file
 * directly in the root is the root's name alone: nothing follows it, so no trailing "›".
 */
export function shortPath(path: PathPart[], rootTitle: string): { short: string; full: string } {
  const full = [rootTitle, ...path.map((p) => p.title)].join(' › ')
  if (path.length === 0) return { short: full, full }
  if (path.length === 1) return { short: `${full} ›`, full }
  return { short: `… › ${path[path.length - 1]!.title} ›`, full }
}

// ── Contents ────────────────────────────────────────────

export type SortMode = 'name' | 'updated'

export function isFolderEntry(doc: UniworkDocSummary): boolean {
  return doc.kind === 'folder'
}

/**
 * A row the app shows: folders and pages (UniNote, opened on the web: UNI-1953)
 * always; files it can open. Other formats are hidden and counted (the FD-14
 * rule, applied per folder).
 */
export function isShownEntry(doc: UniworkDocSummary): boolean {
  if (isFolderEntry(doc)) return true
  if (doc.kind === 'page') return true
  return isOpenable(doc)
}

/**
 * The rows of a folder or a search: shown entries, My Folder first, folders, then sorted
 * by name (UI collator) or newest update; `mode` null keeps the server order.
 */
export function contentsView(
  items: UniworkDocSummary[],
  mode: SortMode | null,
  locale: string,
): { rows: UniworkDocSummary[]; hiddenCount: number } {
  const shown = items.filter(isShownEntry)
  const hiddenCount = items.length - shown.length
  if (mode === null) return { rows: myFolderFirst(shown), hiddenCount }
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  const byKind = (d: UniworkDocSummary) => (isMyFolder(d) ? -1 : isFolderEntry(d) ? 0 : 1)
  const rows = [...shown].sort((a, b) => {
    const kind = byKind(a) - byKind(b)
    if (kind !== 0) return kind
    if (mode === 'updated') {
      const diff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      if (diff) return diff
    }
    return collator.compare(a.title, b.title)
  })
  return { rows, hiddenCount }
}

export const SORT_STORAGE_KEY = 'uniwork.folders.sort'

type SortStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): SortStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** the viewer's remembered sort; storage may be missing or throw */
export function readSortMode(storage: SortStorage | null = defaultStorage()): SortMode {
  try {
    return storage?.getItem(SORT_STORAGE_KEY) === 'updated' ? 'updated' : 'name'
  } catch {
    return 'name'
  }
}

export function writeSortMode(
  mode: SortMode,
  storage: SortStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(SORT_STORAGE_KEY, mode)
  } catch {
    // a per-viewer convenience: losing it is fine
  }
}

// ── Refresh ─────────────────────────────────────────────

/**
 * The folder to show after the tree was re-read. `openPath` is the open
 * folder's root-first id path; a folder no longer in the tree (archived, moved
 * away, no access) falls back to its nearest live ancestor, else the root.
 */
export function liveFallback(
  index: FolderIndex,
  openPath: string[],
): { folderId: string | null; gone: boolean } {
  if (openPath.length === 0) return { folderId: null, gone: false }
  for (let i = openPath.length - 1; i >= 0; i--) {
    if (index.has(openPath[i]!)) {
      return { folderId: openPath[i]!, gone: i !== openPath.length - 1 }
    }
  }
  return { folderId: null, gone: true }
}

/** a request counter: an answer for an older request is dropped */
export function createRequestGate(): { next: () => number; isCurrent: (id: number) => boolean } {
  let latest = 0
  return {
    next: () => ++latest,
    isCurrent: (id) => id === latest,
  }
}

// ── Names and failures ──────────────────────────────────

export type FolderNameError = Extract<DocNameError, 'name_empty' | 'name_too_long'>

/** the server's folder name rule: NFC, trimmed, 1-255 runes */
export function checkFolderName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: FolderNameError } {
  const name = raw.normalize('NFC').trim()
  if (!name) return { ok: false, error: 'name_empty' }
  if (Array.from(name).length > FOLDER_NAME_MAX_RUNES) return { ok: false, error: 'name_too_long' }
  return { ok: true, name }
}

/** a folder name field's error copy (the document field says 500, a folder 255) */
export const FOLDER_NAME_ERROR_KEYS: Record<DocNameError, StringKey> = {
  name_empty: 'ufNameEmpty',
  name_too_long: 'ufNameTooLong',
  folder_name_taken: 'ufNameTaken',
}

export type FolderActionFailure =
  { field: DocNameError } | { key: StringKey; params?: Record<string, string | number> }

/** a folder action's refusal: at the name field, or one sentence for the toast */
export function folderActionFailure(
  error: UniworkDocActionError,
  max?: number,
): FolderActionFailure {
  switch (error) {
    case 'name_empty':
    case 'name_too_long':
    case 'folder_name_taken':
      return { field: error }
    case 'move_name_taken':
      return { key: 'ufMoveNameTaken' }
    case 'document_too_deep':
      return { key: 'ufTooDeep', params: { max: max ?? FOLDER_MAX_DEPTH } }
    case 'document_cycle':
      return { key: 'ufCycle' }
    case 'document_parent_kind':
      return { key: 'ufParentKind' }
    case 'folder_not_shareable':
      return { key: 'ufNotShareable' }
    case 'forbidden':
    case 'permission_revoked':
      return { key: 'ufNoPermission' }
    default:
      return { key: 'uwDocActionFailed' }
  }
}

// ── My Folder (MYFOLDER-01 / SAVE-01 §4) ────────────────

/** the localized My Folder label; the stored title is never shown (ADD:12) */
export const MY_FOLDER_LABEL_KEY = 'usMyFolder' satisfies StringKey

/** the caller's personal folder: the server's `system_kind`, never its title (ADD:13) */
export function isMyFolder(entry: { systemKind?: UniworkSystemKind } | null | undefined): boolean {
  return entry?.systemKind === 'my_folder'
}

/** My Folder rows first, every other row in its given order */
export function myFolderFirst<T extends { systemKind?: UniworkSystemKind }>(rows: T[]): T[] {
  if (!rows.some(isMyFolder)) return rows
  return [...rows.filter(isMyFolder), ...rows.filter((r) => !isMyFolder(r))]
}

/** the tree with My Folder under `label` and first among its siblings (input untouched) */
export function withMyFolderLabel(nodes: UniworkFolderNode[], label: string): UniworkFolderNode[] {
  const visit = (list: UniworkFolderNode[]): UniworkFolderNode[] =>
    myFolderFirst(
      list.map((n) => ({
        ...n,
        title: isMyFolder(n) ? label : n.title,
        children: visit(n.children),
      })),
    )
  return visit(nodes)
}

/** the id of My Folder in a tree, at any depth; null when the tree has none */
export function myFolderIdOf(nodes: UniworkFolderNode[]): string | null {
  for (const n of nodes) {
    if (isMyFolder(n)) return n.id
    const inner = myFolderIdOf(n.children)
    if (inner) return inner
  }
  return null
}

/** a root-first path with My Folder (known by id) under its label */
export function labelMyFolderPath(
  path: PathPart[],
  myFolderId: string | null,
  label: string,
): PathPart[] {
  if (!myFolderId || !path.some((p) => p.id === myFolderId)) return path
  return path.map((p) => (p.id === myFolderId ? { ...p, title: label } : p))
}

/** a contents / search row's shown title */
export function entryTitleOf(doc: UniworkDocSummary, label: string): string {
  return isMyFolder(doc) ? label : doc.title
}

/** rename / move / archive are offered on every row but My Folder (Q2) */
export function folderEditActionsOffered(entry: { systemKind?: UniworkSystemKind }): boolean {
  return !isMyFolder(entry)
}

/**
 * The visibility tag of a tree row. The tree carries no visibility (only
 * `system_kind`), so only My Folder's is known; every other row has none
 * rather than a guess.
 */
export function folderVisibilityTagOf(row: { systemKind?: UniworkSystemKind }): StringKey | null {
  return isMyFolder(row) ? 'usPrivateTag' : null
}

const foldText = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

/**
 * "Find folder": the folders whose title holds the query (case and accents
 * ignored) with their ancestors; a matching folder keeps its subtree.
 * `expand` opens the ancestors so every match is visible.
 */
export function filterFolderTree(
  nodes: UniworkFolderNode[],
  query: string,
): { nodes: UniworkFolderNode[]; expand: string[] } {
  const q = foldText(query.trim())
  if (!q) return { nodes, expand: [] }
  const expand = new Set<string>()
  const visit = (list: UniworkFolderNode[], parentKey: string): UniworkFolderNode[] =>
    list.flatMap((n) => {
      if (foldText(n.title).includes(q)) {
        expand.add(parentKey)
        return [n]
      }
      const kept = visit(n.children, n.id)
      if (kept.length === 0) return []
      expand.add(parentKey)
      return [{ ...n, children: kept }]
    })
  return { nodes: visit(nodes, ROOT_KEY), expand: [...expand] }
}
