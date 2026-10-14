/**
 * Merge fields of a Forms draft (spec §6.6): the user's UniWork profile, never
 * a local copy. The draft is document content, so its labels stay Vietnamese.
 */
import type { WorkPerson } from '../../shared/uniwork-work-api'
import { cachedWork, settleWork } from './work-cache'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** name, unit and job title lines; none when the profile is unknown (signed out or unreachable) */
export function profileMergeHtml(profile: WorkPerson | null): string {
  if (!profile) return ''
  return [
    profile.display_name
      ? `<p><strong>Họ tên:</strong> ${escapeHtml(profile.display_name)}</p>`
      : '',
    profile.department?.name
      ? `<p><strong>Đơn vị:</strong> ${escapeHtml(profile.department.name)}</p>`
      : '',
    profile.title ? `<p><strong>Chức danh:</strong> ${escapeHtml(profile.title)}</p>` : '',
  ].join('')
}

/**
 * The profile for a draft: the Profile tab's cached answer first, else one live
 * read through settleWork. Null when neither answers; compose goes on without it.
 */
export async function profileForDraft(orgId: string | null): Promise<WorkPerson | null> {
  const cached = orgId ? cachedWork<WorkPerson>(`profile:${orgId}`) : null
  if (cached) return cached.value
  const live = await settleWork(window.uniworkWork.myProfile())
  return live.ok ? live.value : null
}
