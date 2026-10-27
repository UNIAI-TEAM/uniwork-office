// What the Google Drive list remembers per UniWork account: whether it groups by folder. It lives
// in the Workbench store (one bucket per account) under the allowed `uniwork.wb.` prefix. A store
// that cannot be read or written leaves the default (on), so the list always renders.
import { wbStoreRead, wbStoreWrite } from '../workbench-store-client'

export const DRIVE_GROUP_BY_FOLDER_KEY = 'uniwork.wb.drive.groupByFolder'

/** the stored choice; anything that is not a boolean reads as the default (on) */
export function readDriveGroupByFolder(): boolean {
  try {
    const value = wbStoreRead<unknown>(DRIVE_GROUP_BY_FOLDER_KEY, true)
    return typeof value === 'boolean' ? value : true
  } catch {
    return true
  }
}

export function writeDriveGroupByFolder(on: boolean): void {
  try {
    wbStoreWrite(DRIVE_GROUP_BY_FOLDER_KEY, on)
  } catch {
    /* an unwritable store keeps nothing; the choice still holds for the session */
  }
}
