// The gate of the Share entries on a doclist row (the access cell button, the row menu's
// "Chia sẻ", the bulk bar) and the Access cell's button name. Pure functions of the summary
// fields every row carries; the rules are the web's `canShareRow` (row-level.ts).
import type { UniworkDocSummary } from '../../../shared/home-api'

/** what the gate reads of a row: every field optional, so any list row (or a bare id) fits */
export type ShareGateRow = Pick<
  UniworkDocSummary,
  'kind' | 'archived' | 'archivedAt' | 'systemKind' | 'ownerKind' | 'myLevel' | 'adminScope'
> & {
  /** an empty organization marks a starred row nothing has resolved; the app's rows carry none */
  organizationId?: string
}

/**
 * Whether a row offers Share: any reader opens the dialog (a manager manages, anyone else
 * sees their own level). Never for a folder (only documents are shared), a document of
 * another module (`owner_kind`: its access follows its task or meeting), a trashed row (the
 * trash view's), or My Folder (personal). A shelved row still opens, the dialog says so.
 */
export function canShareRow(row: ShareGateRow | null | undefined): boolean {
  return (
    !!row &&
    row.organizationId !== '' &&
    row.kind !== 'folder' &&
    !row.ownerKind &&
    row.archived !== true &&
    !row.archivedAt &&
    row.systemKind !== 'my_folder'
  )
}

/**
 * The name of the Access cell's button: "manage" ("Quản lý quyền truy cập «tên»") for a
 * manager or an administering workspace admin, "view" ("Xem quyền truy cập «tên»") for
 * everyone else.
 */
export function accessCellName(
  row: Pick<ShareGateRow, 'myLevel' | 'adminScope'>,
): 'manage' | 'view' {
  return row.myLevel === 'manage' || row.adminScope === true ? 'manage' : 'view'
}
