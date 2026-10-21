// Pure helpers of the Share dialog: which levels a principal may get, level ranking, the
// diacritic-folding filter, plural picking and the copy key of each refusal. No React here.
import type { ShareErrorCode, ShareLevel, SharePrincipalType } from '../../../shared/share-api'
import { SHARE_LEVELS } from '../../../shared/share-api'
import type { StringKey } from '../locale'

/** the app's `t` (or any function of the same shape) */
export type ShareT = (key: StringKey, params?: Record<string, string | number>) => string

/**
 * The levels a principal can be given: the organization and the document's home workspace
 * stop at edit (a group never manages); a person or another workspace may get any level.
 */
export function allowedLevelsForPrincipal(
  principalType: string,
  isHomeWorkspace = false,
): readonly ShareLevel[] {
  if (principalType === 'organization' || (principalType === 'workspace' && isHomeWorkspace)) {
    return ['view', 'comment', 'edit']
  }
  return SHARE_LEVELS
}

/**
 * Position of a level on the view -> manage ladder. A level the client does not list and
 * "no level" rank lowest, so on a shelved document any named level above them is a raise.
 */
export function levelRank(level: string | null | undefined): number {
  return level ? SHARE_LEVELS.indexOf(level as ShareLevel) : -1
}

/** lower-case, no diacritics, d for đ: what a typed filter matches against */
export function foldSearchText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim()
}

/** `<base>One` for a count of 1, `<base>Other` for every other count (vi and en only differ so) */
export function plural(t: ShareT, base: string, count: number): string {
  return t(`${base}${count === 1 ? 'One' : 'Other'}` as StringKey, { count })
}

/** the label of a level; a level this client does not list reads "Other level", never "View" */
export function levelLabel(t: ShareT, level: string | null | undefined): string {
  switch (level) {
    case 'view':
      return t('shrLevelView')
    case 'comment':
      return t('shrLevelComment')
    case 'edit':
      return t('shrLevelEdit')
    case 'manage':
      return t('shrLevelManage')
    default:
      return t('shrLevelOther')
  }
}

/** where a level comes from, as the web words it */
export function viaLabel(t: ShareT, via: string | null | undefined): string {
  switch (via) {
    case 'break_glass':
      return t('shrBgViaBreakGlass')
    case 'owner':
      return t('shrViaOwner')
    case 'member':
      return t('shrViaMember')
    case 'organization':
      return t('shrViaOrganization')
    case 'link':
      return t('shrViaLink')
    case 'ai_context':
      return t('shrViaAiContext')
    default:
      return t('shrViaShare')
  }
}

export type PrincipalGroup = SharePrincipalType

/**
 * The copy of a refusal every share write can meet. Transport and permission failures have no
 * sentence of their own (the caller falls back to its "could not ..." line).
 */
export function shareErrorKey(error: ShareErrorCode): StringKey | null {
  switch (error) {
    case 'document_shelved':
      return 'shrShelvedBlocked'
    case 'my_folder_locked':
      return 'shrErrMyFolderLocked'
    case 'break_glass_required':
      return 'shrBgSelfShareError'
    default:
      return null
  }
}

/** the copy of a link-creation refusal: the live-link limit, the org switch and the plan are told apart */
export function linkErrorKey(error: ShareErrorCode): StringKey | null {
  switch (error) {
    case 'document_link_limit':
      return 'shrLinkLimit'
    case 'document_links_disabled':
      return 'shrLinksOff'
    case 'forbidden':
      return 'shrLinkEntitlement'
    default:
      return shareErrorKey(error)
  }
}

/** the one line for a rejected item of an update, by the server's code */
export function rejectedReasonKey(code: string): StringKey {
  switch (code) {
    case 'principal_not_in_organization':
      return 'shrRejectedNotInOrg'
    case 'level_not_allowed':
      return 'shrRejectedLevelNotAllowed'
    case 'duplicate_principal':
      return 'shrRejectedDuplicate'
    case 'break_glass_required':
      return 'shrRejectedBreakGlass'
    default:
      return 'shrRejectedUnknown'
  }
}

/** a short date and time in the UI's locale (an unreadable stamp reads as empty) */
export function formatWhen(value: string | null | undefined, locale: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  } catch {
    return date.toISOString()
  }
}
