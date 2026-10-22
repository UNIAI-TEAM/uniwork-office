// The "…" menu of a Documents row, built once for every screen on the shared
// rules (Rules board §3): same names, same order, items the person has no
// right to leave the menu, the delete entry comes last, red, and asks first.
// Phase 1 lists only what the app can do today plus Copy link and Details; an
// action the host cannot run has no entry, so the menu never shows a dead item.
import type { StringKey } from '../locale'
import type { FolderMenuItem } from '../uniwork-folders/FolderMenu'
import { canManageShelved, type DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import { canOfferAccessLog } from '../uniwork-doc-history/access-log-model'
import type { DocListScreen } from './columns'
import { canShareRow } from './share-gate'

export type RowMenuActionId =
  | 'open'
  | 'offline'
  | 'share'
  | 'copy-link'
  | 'star'
  | 'unstar'
  | 'new-subfolder'
  | 'rename'
  | 'move'
  | 'shelve'
  | 'unshelve'
  | 'trash'
  | 'restore'
  | 'download'
  | 'logs'
  | 'details'

export interface RowMenuItem extends FolderMenuItem {
  id: RowMenuActionId
  /** entries of one group sit together; a divider is drawn between groups */
  group: number
  /** the destructive entry: danger colors */
  danger?: true
  /** selecting it opens a confirm dialog first (the host owns the dialog) */
  confirm?: true
}

export interface RowMenuInput {
  screen: DocListScreen
  doc: DocumentsHomeDoc
  /** what the host can run on this row; an id left out has no entry */
  run: Partial<Record<RowMenuActionId, () => void>>
  /** label of the offline toggle for this row (the app's own entry); null = no entry */
  offlineLabel: string | null
  label: (key: StringKey) => string
  /**
   * UNI-2066: may the person create inside this folder row (a workspace folder takes every
   * human member, whatever the level); absent = the edit level, as rename and move read it.
   */
  canCreateInside?: boolean
}

/**
 * UNI-2068: a row the bulk Download can take: a file, in the live list or on the shelf (the
 * trash and a trashed row keep nothing to download). Pages and folders have no file.
 */
export function rowCanDownload(screen: DocListScreen, doc: DocumentsHomeDoc): boolean {
  return screen !== 'trash' && doc.archived !== true && doc.kind === 'file'
}

// groups of the live screens: open | link | edit | keep (and the delete entry)
const OPEN = 0
const LINK = 1
const EDIT = 2
const KEEP = 3

/** the entries of one row's menu, in the shared order */
export function buildRowMenu({
  screen,
  doc,
  run,
  offlineLabel,
  label,
  canCreateInside,
}: RowMenuInput): RowMenuItem[] {
  const items: RowMenuItem[] = []
  const add = (
    id: RowMenuActionId,
    text: string,
    group: number,
    flags?: { danger?: true; confirm?: true },
  ) => {
    const onSelect = run[id]
    if (onSelect) items.push({ id, label: text, group, onSelect, ...flags })
  }

  // a trashed row is the trash row wherever it is listed (a search hit)
  if (screen === 'trash' || doc.archived === true) {
    if (doc.canManage === true) add('restore', label('dlActRestore'), OPEN)
    add('details', label('dlActDetails'), OPEN)
    return items
  }

  if (screen === 'shelved') {
    if (doc.kind !== 'folder') add('open', label('dlActOpen'), OPEN)
    if (rowCanDownload(screen, doc)) add('download', label('dlActDownload'), OPEN)
    if (canManageShelved(doc)) {
      add('unshelve', label('dlActUnshelve'), OPEN)
      add('trash', label('dlActTrash'), KEEP, { danger: true, confirm: true })
    }
    return items
  }

  // a shelved search hit is read-only: the server refuses its rename / move (409 document_shelved)
  const shelved = Boolean(doc.shelvedAt)
  add('open', label('dlActOpen'), OPEN)
  // a page and a folder have no file to keep offline
  if (offlineLabel && doc.kind === 'file' && !shelved) add('offline', offlineLabel, OPEN)
  // Chia sẻ (UNI-2047 SD-C): any reader opens the dialog, the gate keeps folders, other modules'
  // documents, trashed rows and My Folder out; it sits just before Sao chép link like the web's
  if (canShareRow(doc)) add('share', label('dlActShare'), LINK)
  if (doc.kind !== 'folder') add('copy-link', label('dlActCopyLink'), LINK)
  // Tải xuống (UNI-2068): the bulk bar reads this entry for its gate; a host that gives the row
  // menu no handler leaves the visible menu as it was
  if (rowCanDownload(screen, doc)) add('download', label('dlActDownload'), LINK)
  // Nhật ký truy cập (UNI-2077): managers only, never another module's, trashed or shelved row
  if (canOfferAccessLog(doc)) add('logs', label('algMenu'), LINK)
  // Gắn sao / Bỏ gắn sao (UNI-2047 B6): only the Starred list carries the star time, so a row that
  // has one offers Bỏ gắn sao and any other row Gắn sao (idempotent on the server); a viewer may star
  if (doc.kind !== 'folder') {
    if (doc.favoritedAt) add('unstar', label('dlActUnstar'), EDIT)
    else add('star', label('dlActStar'), EDIT)
  }
  // a folder takes new content by its own rule, wider than rename / move (UNI-2066)
  if (doc.kind === 'folder' && !shelved && (canCreateInside ?? doc.canEdit === true)) {
    add('new-subfolder', label('ufNewSubfolder'), EDIT)
  }
  if (doc.canEdit !== false && !shelved) {
    if (doc.canEdit === true) add('rename', label('dlActRename'), EDIT)
    add('move', label('dlActMove'), EDIT)
  }
  if (doc.canManage === true) {
    // folder shelve is a residual of the app (files and pages only)
    if ((doc.kind === 'file' || doc.kind === 'page') && !shelved) {
      add('shelve', label('dlActShelve'), KEEP)
    }
    add('trash', label('dlActTrash'), KEEP, { danger: true, confirm: true })
  }
  return items
}
