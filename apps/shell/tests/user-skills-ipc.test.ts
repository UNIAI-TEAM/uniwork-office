/**
 * The AI panel's door to installed skills: `ai:skills-list` and `ai:skill-text`
 * resolve against installed skills only (`<userData>/skills`), never a
 * renderer-supplied path, and `ai:run-cli` is not registered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handles: new Map<string, (...args: never[]) => unknown>(),
  rawHandles: new Map<string, (...args: never[]) => unknown>(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/app/userData', isPackaged: true, getAppPath: () => '/app' },
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) =>
      h.rawHandles.set(channel, handler),
  },
}))

const usable = vi.fn()
const readBody = vi.fn()
vi.mock('../src/main/imported-skills', () => ({
  usableSkills: (...a: unknown[]) => usable(...a),
  readSkillBody: (...a: unknown[]) => readBody(...a),
}))

import { registerUserSkillsIpc, type UserSkillEntry } from '../src/main/user-skills-ipc'

const fakeIpc = {
  handle: (channel: string, handler: (...args: never[]) => unknown) => {
    h.handles.set(channel, handler)
  },
}

const invoke = (channel: string, ...args: unknown[]) =>
  h.handles.get(channel)!({ sender: { id: 7 } } as never, ...args)

beforeEach(() => {
  h.handles.clear()
  h.rawHandles.clear()
  usable.mockReset().mockResolvedValue([
    {
      name: 'batch-pdf',
      description: 'd',
      path: '/app/userData/skills/batch-pdf/SKILL.md',
      relevance: { relevant: true, matched: ['pdf'] },
    },
  ])
  readBody.mockReset().mockReturnValue('the body')
  registerUserSkillsIpc(fakeIpc)
})

describe('user-skills-ipc', () => {
  it('registers only ai:skills-list and ai:skill-text on the guarded ipc (no ai:run-cli)', () => {
    expect([...h.handles.keys()].sort()).toEqual(['ai:skill-text', 'ai:skills-list'])
    expect(h.handles.has('ai:run-cli')).toBe(false)
    expect(h.rawHandles.size).toBe(0)
  })

  it('lists installed skills without paths', async () => {
    const out = (await invoke('ai:skills-list')) as UserSkillEntry[]
    expect(out).toEqual([{ name: 'batch-pdf', description: 'd', relevant: true }])
    expect(usable).toHaveBeenCalledWith('/app/userData')
  })

  it('resolves skill text by name against the installed list, never a path', async () => {
    const body = (await invoke('ai:skill-text', 'batch-pdf')) as string
    expect(body).toBe('the body')
    expect(readBody).toHaveBeenCalledWith('/app/userData/skills/batch-pdf/SKILL.md')
    await expect(invoke('ai:skill-text', 'nope')).rejects.toThrow('no installed skill named')
    await expect(invoke('ai:skill-text', '/etc/passwd')).rejects.toThrow('no installed skill named')
    await expect(invoke('ai:skill-text', '../batch-pdf')).rejects.toThrow(
      'no installed skill named',
    )
    await expect(invoke('ai:skill-text', '')).rejects.toThrow('a skill name is required')
    await expect(invoke('ai:skill-text', null)).rejects.toThrow('a skill name is required')
  })

  it('clips skill bodies above 32,000 characters', async () => {
    readBody.mockReturnValue('a'.repeat(32_050))
    const body = (await invoke('ai:skill-text', 'batch-pdf')) as string
    expect(body).toBe(`${'a'.repeat(32_000)}…(+50 chars)`)
  })
})
