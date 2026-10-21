// What the Share dialog reads of a document: a list row (UniworkDocSummary) satisfies it as is.
import type { UniworkDocSummary } from '../../../shared/home-api'
import type { UniworkShareApi } from '../../../shared/share-api'

export type ShareDialogTarget = Pick<UniworkDocSummary, 'id' | 'workspaceId' | 'title'> &
  Partial<
    Pick<
      UniworkDocSummary,
      'workspaceName' | 'myLevel' | 'adminScope' | 'shelvedAt' | 'archived' | 'archivedAt'
    >
  > & {
    /** the selected organization's name, for the "via organization" source lines */
    organizationName?: string
  }

/** a list row as the dialog's target */
export function rowShareTarget(
  row: UniworkDocSummary,
  organizationName?: string,
): ShareDialogTarget {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    workspaceName: row.workspaceName,
    myLevel: row.myLevel,
    adminScope: row.adminScope,
    shelvedAt: row.shelvedAt,
    archived: row.archived,
    archivedAt: row.archivedAt,
    organizationName,
  }
}

/** a manager (or an administering workspace admin) edits access; everyone else reads their own */
export function canManageTarget(row: Pick<ShareDialogTarget, 'myLevel' | 'adminScope'>): boolean {
  return row.myLevel === 'manage' || row.adminScope === true
}

declare global {
  interface Window {
    /** the Share bridge (preload `uniwork-share:*` channels) */
    uniworkShare: UniworkShareApi
  }
}
