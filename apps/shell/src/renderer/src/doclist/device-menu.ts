// The "…" menus of the device list (local files and sub-folders), as the
// shared row menu's items. Order and dividers follow the shared rules with the
// machine's own entries in their place: Mở · offline · Hiện trong thư mục ·
// Sao chép đường dẫn │ Di chuyển │ Đổi tên · Nhân đôi │ Chuyển nhóm │ Bỏ khỏi
// danh sách / Bỏ sao · Xóa tệp (last, red). An entry the row cannot do is not
// there; the caller decides what it can do and passes the handlers.
import type { TFunc } from '../locale'
import type { FolderMenuItem } from '../uniwork-folders/FolderMenu'

export interface DeviceFileMenuInput {
  /** which list the row is in: the global lists, or a folder's contents */
  context: 'global' | 'folder'
  view: 'recent' | 'starred'
  starred: boolean
  /** the offline toggle's label for a UniWork working copy; null = no such entry */
  offlineLabel: string | null
  /** a local file (not a UniWork copy): Hiện trong thư mục / Sao chép đường dẫn */
  showLocation: boolean
  /** the app manages the file's place (false for a UniWork working copy): projects */
  fileActions: boolean
  canMove: boolean
  /** rename / duplicate / delete are allowed on this file */
  editable: boolean
  missing: boolean
  /** projects the file can move to, in project mode */
  otherProjects: readonly { id: string; label: string }[]
  /** no selection is open: removing and deleting act on this one row */
  canDelete: boolean
}

export interface DeviceFileHandlers {
  open: () => void
  toggleOffline: () => void
  reveal: () => void
  copyPath: () => void
  move: () => void
  moveToProject: (projectId: string) => void
  rename: () => void
  duplicate: () => void
  group: () => void
  removeFromList: () => void
  unstar: () => void
  deleteFiles: () => void
}

export interface DeviceFolderHandlers {
  openFolder: () => void
  renameFolder: () => void
  moveFolder: () => void
  revealFolder: () => void
  deleteFolder: () => void
}

export type DeviceMenuHandlers = DeviceFileHandlers & DeviceFolderHandlers

export function deviceFileMenu(
  input: DeviceFileMenuInput,
  on: DeviceFileHandlers,
  t: TFunc,
): FolderMenuItem[] {
  const items: FolderMenuItem[] = [
    { id: 'open', label: t('dlActOpen'), onSelect: on.open, group: 0 },
  ]
  if (input.offlineLabel) {
    items.push({ id: 'offline', label: input.offlineLabel, onSelect: on.toggleOffline, group: 0 })
  }
  if (input.showLocation) {
    items.push(
      { id: 'reveal', label: t('revealInFolder'), onSelect: on.reveal, group: 0 },
      { id: 'copy-path', label: t('copyPath'), onSelect: on.copyPath, group: 0 },
    )
  }
  if (input.canMove && input.editable && !input.missing) {
    items.push({ id: 'move', label: t('moveToFolder'), onSelect: on.move, group: 1 })
  }
  if (input.fileActions) {
    for (const project of input.otherProjects) {
      items.push({
        id: `project:${project.id}`,
        label: `${t('moveToProject')} › ${project.label}`,
        onSelect: () => on.moveToProject(project.id),
        group: 2,
      })
    }
  }
  if (input.editable) {
    items.push(
      { id: 'rename', label: t('dlActRename'), onSelect: on.rename, group: 3 },
      { id: 'duplicate', label: t('dlActDuplicate'), onSelect: on.duplicate, group: 3 },
    )
  }
  if (input.starred) {
    items.push({ id: 'group', label: t('moveToGroup'), onSelect: on.group, group: 4 })
  }
  if (input.canDelete) {
    // in the Starred view "remove from list" must unstar: dropping the recents entry kept the star
    if (input.context === 'global') {
      items.push(
        input.view === 'starred'
          ? { id: 'unstar', label: t('unstar'), onSelect: on.unstar, group: 5 }
          : { id: 'remove', label: t('removeFromList'), onSelect: on.removeFromList, group: 5 },
      )
    }
    if (input.editable) {
      items.push({
        id: 'delete',
        label: t('deleteFiles'),
        onSelect: on.deleteFiles,
        group: 5,
        danger: true,
      })
    }
  }
  return items
}

export function deviceFolderMenu(
  input: { editable: boolean },
  on: DeviceFolderHandlers,
  t: TFunc,
): FolderMenuItem[] {
  const items: FolderMenuItem[] = [
    { id: 'open', label: t('open'), onSelect: on.openFolder, group: 0 },
  ]
  if (input.editable) {
    items.push(
      { id: 'rename', label: t('rename'), onSelect: on.renameFolder, group: 0 },
      { id: 'move', label: t('moveToFolder'), onSelect: on.moveFolder, group: 0 },
    )
  }
  items.push({ id: 'reveal', label: t('revealInFolder'), onSelect: on.revealFolder, group: 0 })
  if (input.editable) {
    items.push({
      id: 'delete',
      label: t('deleteFolder'),
      onSelect: on.deleteFolder,
      group: 1,
      danger: true,
    })
  }
  return items
}
