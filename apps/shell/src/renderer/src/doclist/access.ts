// What the Truy cập column says about a document, as pure functions of the
// summary fields every list row carries (visibility, share_scope, my_level,
// is_owner).
import type { DocListKey, DocListT } from './text'

export type AccessPill = 'restricted' | 'workspace' | 'shared'
export type AccessLevel = 'view' | 'comment' | 'edit' | 'manage'

/** the server's `share_scope`, as the main process parses it (UniworkDocShareScope) */
export interface ShareScopeInput {
  homeWorkspace: boolean
  /** live direct grants to people */
  users: number
  /** live direct grants to other workspaces */
  workspaces: number
  organization: boolean
  publicLink: boolean
}

export interface AccessInput {
  visibility?: 'private' | 'workspace' | 'restricted' | null
  shareScope?: ShareScopeInput | null
  /** from the server; absent reads as false, so the level line shows */
  isOwner?: boolean | null
  myLevel?: string | null
  /** a workspace administrator arrives with no level and administers the row */
  adminScope?: boolean | null
}

export const ACCESS_PILL_KEY: Record<AccessPill, DocListKey> = {
  restricted: 'dlAccessRestricted',
  workspace: 'dlAccessWorkspace',
  shared: 'dlAccessShared',
}

/**
 * The pill: Workspace when the document is visible to its workspace; else
 * Được chia sẻ when anyone beyond the owner can reach it (people, other
 * workspaces, the organization, or a live public link - a public link alone
 * counts); else Riêng tư. A missing `share_scope` is never guessed: a row
 * without one reads Riêng tư.
 */
export function accessPill(doc: Pick<AccessInput, 'visibility' | 'shareScope'>): AccessPill {
  if (doc.visibility === 'workspace') return 'workspace'
  const s = doc.shareScope
  const reachable = Boolean(
    s && (s.users > 0 || s.workspaces > 0 || s.organization || s.publicLink),
  )
  return reachable ? 'shared' : 'restricted'
}

/**
 * The viewer's level for the "Bạn: …" line. A server level this client does
 * not list reads as no line; an administrator with no level reads as manage.
 */
export function accessLevel(
  myLevel: string | null | undefined,
  adminScope?: boolean | null,
): AccessLevel | null {
  switch (myLevel) {
    case 'view':
    case 'comment':
    case 'edit':
    case 'manage':
      return myLevel
    default:
      return !myLevel && adminScope === true ? 'manage' : null
  }
}

const LEVEL_KEY: Record<AccessLevel, DocListKey> = {
  view: 'dlLevelView',
  comment: 'dlLevelComment',
  edit: 'dlLevelEdit',
  manage: 'dlLevelManage',
}

/** the line under the pill: "Chủ sở hữu" for the owner, else "Bạn: Xem|Bình luận|Sửa|Quản lý"; null when neither is known */
export function levelLine(
  doc: Pick<AccessInput, 'isOwner' | 'myLevel' | 'adminScope'>,
  t: DocListT,
): string | null {
  if (doc.isOwner === true) return t('dlAccessOwner')
  const level = accessLevel(doc.myLevel, doc.adminScope)
  return level ? t('dlAccessYou', { level: t(LEVEL_KEY[level]) }) : null
}
