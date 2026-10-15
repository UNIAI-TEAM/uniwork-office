/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type { UniworkWorkApi } from '../src/shared/uniwork-work-api'
import { draftFromForm } from '../src/renderer/src/form-draft'

let newDoc: ReturnType<typeof vi.fn>

beforeEach(() => {
  newDoc = vi.fn(async () => undefined)
  window.aiOffice = { newDoc } as unknown as HomeApi
  // a null org skips the profile cache and asks live once; signed out here, so no merge lines
  window.uniworkWork = {
    myProfile: vi.fn(async () => ({ ok: false, error: 'offline' })),
  } as unknown as UniworkWorkApi
})

describe('draftFromForm', () => {
  it('creates a Docs file in the pack with the form title, note and template name', async () => {
    await draftFromForm(
      { id: 'f1', title: 'Leave <request>', note: 'HR', fileName: 'leave.docx' },
      'pack-1',
      null,
      false,
    )
    expect(newDoc).toHaveBeenCalledTimes(1)
    const opts = newDoc.mock.calls[0]![0] as {
      projectId: string
      aiContent: { title: string; html: string }
    }
    expect(opts.projectId).toBe('pack-1')
    expect(opts.aiContent.title).toBe('Leave <request>')
    expect(opts.aiContent.html).toContain('<h1>Leave &lt;request&gt;</h1>')
    expect(opts.aiContent.html).toContain('Source template')
    expect(opts.aiContent.html).toContain('leave.docx')
  })
})
