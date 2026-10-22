// The pure rules of the Access log sheet: who may read it, who is offered the menu entry, and how a
// log row is named. The gates are the web's (document-actions-menu.tsx: canManage && !owned &&
// !archived && !shelved; access-log-sheet.tsx: manage level or admin scope).
import type { UniworkDocSummary } from '../../../shared/home-api'
import type { DocAccessLog, DocAccessLogAction } from '../../../shared/doc-history-api'
import type { StringKey } from '../locale'

/** what the gates read of a row: every field optional, so any list row (or a bare target) fits */
export type AccessLogGateRow = Pick<UniworkDocSummary, 'myLevel' | 'adminScope'> &
  Partial<Pick<UniworkDocSummary, 'ownerKind' | 'archived' | 'archivedAt' | 'shelvedAt'>>

/** the server's rule: a manager (or an administering workspace admin) reads the log */
export function canReadAccessLog(row: Pick<AccessLogGateRow, 'myLevel' | 'adminScope'>): boolean {
  return row.myLevel === 'manage' || row.adminScope === true
}

/**
 * Whether the row menu offers the entry: a reader of the log, on a document of this module (a
 * document of another module follows its task or meeting), that is neither trashed nor shelved.
 */
export function canOfferAccessLog(row: AccessLogGateRow): boolean {
  return (
    canReadAccessLog(row) &&
    !row.ownerKind &&
    row.archived !== true &&
    !row.archivedAt &&
    !row.shelvedAt
  )
}

/** the action filter's options, in the web's order; '' is every action */
export const ACCESS_LOG_FILTERS: readonly ('' | DocAccessLogAction)[] = [
  '',
  'view',
  'download',
  'export',
  'link_view',
]

/**
 * Who did it: the resolved name when the server has one; otherwise the kind, never the id (an
 * unnamed human id is not shown as a person).
 */
export function accessLogActor(log: DocAccessLog): { name: string } | { key: StringKey } {
  if (log.actor?.display_name) return { name: log.actor.display_name }
  switch (log.actor_kind) {
    case 'anonymous':
      return { key: 'algActorAnonymous' }
    case 'system':
      return { key: 'algActorSystem' }
    default:
      return { key: 'algActorUnknown' }
  }
}

/** an action the app does not know (a newer server) reads "Other" */
export function accessLogActionKey(action: string): StringKey {
  switch (action) {
    case 'view':
      return 'algActionView'
    case 'download':
      return 'algActionDownload'
    case 'export':
      return 'algActionExport'
    case 'link_view':
      return 'algActionLinkView'
    default:
      return 'algActionUnknown'
  }
}

/** the way in; null = a value the app does not know, printed as the server sent it */
export function accessLogViaKey(via: string): StringKey | null {
  switch (via) {
    case 'member':
      return 'shrViaMember'
    case 'share':
      return 'shrViaShare'
    case 'link':
      return 'shrViaLink'
    case 'ai_context':
      return 'shrViaAiContext'
    case 'break_glass':
      return 'shrBgViaBreakGlass'
    default:
      return null
  }
}
