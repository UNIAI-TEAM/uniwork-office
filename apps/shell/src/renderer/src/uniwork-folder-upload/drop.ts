/**
 * UNI-2052: reading what the user dropped on the library list.
 *
 * Electron gives a dropped File no folder flag, so the entry API
 * (`webkitGetAsEntry`) says which items are folders; the absolute path comes
 * from the preload's `getPathForFile`. Both are read while the drop event is
 * still being handled (the DataTransfer empties right after).
 */

export interface DroppedItem {
  /** absolute path on disk */
  path: string
  name: string
  /** null = the host could not say (no entry API) */
  isDirectory: boolean | null
}

/** The slice of DataTransferItem this module reads, so tests can pass plain objects */
export interface DropItemLike {
  kind: string
  getAsFile(): File | null
  webkitGetAsEntry?: () => { isDirectory: boolean } | null
}

export interface DropTransferLike {
  items?: ArrayLike<DropItemLike> | null
  files?: ArrayLike<File> | null
  types?: ArrayLike<string> | null
}

/** True while a drag carries files (not text or a link): the only drags the list reacts to */
export function dragHasFiles(
  transfer: Pick<DropTransferLike, 'types'> | null | undefined,
): boolean {
  return Array.from(transfer?.types ?? []).includes('Files')
}

export function readDropped(
  transfer: DropTransferLike,
  pathOf: (file: File) => string,
): DroppedItem[] {
  const out: DroppedItem[] = []
  const add = (file: File | null, isDirectory: boolean | null) => {
    if (!file) return
    const path = pathOf(file)
    if (path) out.push({ path, name: file.name, isDirectory })
  }
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === 'file')
  if (items.length > 0) {
    for (const item of items) {
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
      add(item.getAsFile(), entry ? entry.isDirectory : null)
    }
    return out
  }
  for (const file of Array.from(transfer.files ?? [])) add(file, null)
  return out
}

/**
 * What a drop means:
 * - `single`: exactly one file and nothing else keeps today's one-file upload;
 * - `batch`: everything else goes to the pre-flight, loose files as one group
 *   first and then each folder in the order dropped (main groups them);
 * - `none`: nothing usable.
 * When any item could not be classified the whole drop is a `batch`: main
 * checks each path on disk, so a folder is never taken for a file.
 */
export type DropPlan =
  | { kind: 'none' }
  | { kind: 'single'; file: { path: string; name: string } }
  | { kind: 'batch'; paths: string[]; folders: number; files: number }

export function planDrop(items: readonly DroppedItem[]): DropPlan {
  if (items.length === 0) return { kind: 'none' }
  const only = items[0]!
  if (items.length === 1 && only.isDirectory === false) {
    return { kind: 'single', file: { path: only.path, name: only.name } }
  }
  const files = items.filter((item) => item.isDirectory === false)
  const folders = items.filter((item) => item.isDirectory === true)
  const unknown = items.filter((item) => item.isDirectory === null)
  return {
    kind: 'batch',
    // loose files first, then the folders, each group in the order dropped
    paths: [...files, ...unknown, ...folders].map((item) => item.path),
    folders: folders.length,
    files: files.length + unknown.length,
  }
}
