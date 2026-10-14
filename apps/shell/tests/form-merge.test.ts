import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkPerson } from '../src/shared/uniwork-work-api'
import { profileForDraft, profileMergeHtml } from '../src/renderer/src/form-merge'
import { cacheWork, workCacheSlot } from '../src/renderer/src/work-cache'

const PERSON: WorkPerson = {
  user_id: 'u1',
  display_name: 'Lan <Nguyen> & Co',
  email: 'lan@example.test',
  title: 'Trưởng nhóm "A"',
  department: { id: 'd1', name: 'Kinh doanh' },
  manager: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Forms merge fields', () => {
  it('writes name, unit and job title, HTML-escaped, when the profile is known', () => {
    const html = profileMergeHtml(PERSON)
    expect(html).toContain('<p><strong>Họ tên:</strong> Lan &lt;Nguyen&gt; &amp; Co</p>')
    expect(html).toContain('<p><strong>Đơn vị:</strong> Kinh doanh</p>')
    expect(html).toContain('<p><strong>Chức danh:</strong> Trưởng nhóm &quot;A&quot;</p>')
  })

  it('writes no merge field when the profile is unknown, and skips empty ones', () => {
    expect(profileMergeHtml(null)).toBe('')
    const html = profileMergeHtml({ ...PERSON, department: null, title: '' })
    expect(html).toContain('Họ tên:')
    expect(html).not.toMatch(/Đơn vị|Chức danh/)
  })

  it('takes the Profile tab’s cached answer without asking the server', async () => {
    const myProfile = vi.fn()
    vi.stubGlobal('window', { uniworkWork: { myProfile } })
    cacheWork(workCacheSlot('profile:o1'), PERSON)
    await expect(profileForDraft('o1')).resolves.toEqual(PERSON)
    expect(myProfile).not.toHaveBeenCalled()
  })

  it('falls back to one live read, and to no profile when that fails', async () => {
    const myProfile = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: PERSON })
      .mockRejectedValueOnce(new Error('ipc closed'))
      .mockResolvedValueOnce({ ok: false, error: 'signed-out' })
    vi.stubGlobal('window', { uniworkWork: { myProfile } })
    await expect(profileForDraft('o2')).resolves.toEqual(PERSON)
    await expect(profileForDraft('o2')).resolves.toBeNull()
    await expect(profileForDraft(null)).resolves.toBeNull()
  })
})
