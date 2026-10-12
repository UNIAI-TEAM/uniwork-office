import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetForTest } from '../src/renderer/capabilities'
import { createFilesSkill } from '../src/renderer/ai/files-skill'
import { HTML_WEB_CAPABILITIES } from '../../../web/modules/html/webapi'
import type { AttachmentMeta } from '../src/shared/ipc'

// G6-12 #11: on the web host read_attachment is a stub that always fails (no attachment
// store in the frame), so the model must not be offered it there; desktop keeps the tool.

const w = window as unknown as { htmlApi?: unknown }
const previousApi = w.htmlApi

afterEach(() => {
  w.htmlApi = previousApi
  resetForTest()
})

function host(api: Record<string, unknown>): void {
  w.htmlApi = api
  resetForTest()
}

const ATTACHED: AttachmentMeta[] = [
  { path: '/tmp/notes.txt', name: 'notes.txt', ext: 'txt', sizeBytes: 12 } as AttachmentMeta,
]
const names = (skill: { tools: readonly { name: string }[] }) => skill.tools.map((t) => t.name)

describe('html read_attachment per host', () => {
  it('the web frame defaults turn chat attachments off', () => {
    expect((HTML_WEB_CAPABILITIES as Record<string, unknown>).attachments).toBe(false)
  })

  it('desktop: read_attachment and its prompt are offered', () => {
    host({})
    const skill = createFilesSkill(() => ATTACHED)
    expect(names(skill)).toEqual(['read_attachment'])
    expect(skill.systemPrompt).toContain('read_attachment')
    expect(skill.buildContext?.()).toContain('notes.txt')
  })

  it('web: no tool, no prompt, no context, and a stray call is refused without a read', async () => {
    const readAttachment = vi.fn(async () => ({ ok: false, error: 'unavailable' }))
    host({ capabilities: { ...HTML_WEB_CAPABILITIES, platform: 'web' }, readAttachment })
    const skill = createFilesSkill(() => ATTACHED)
    expect(names(skill)).toEqual([])
    expect(skill.systemPrompt).toBe('')
    expect(skill.buildContext?.() ?? '').toBe('')
    const result = await skill.executeTool(
      { id: 't1', name: 'read_attachment', input: { index: 0 } },
      undefined,
    )
    expect(result.isError).toBe(true)
    expect(readAttachment).not.toHaveBeenCalled()
  })
})
