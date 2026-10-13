import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentIntent } from '@uniwork/practice-core'

vi.mock('../src/renderer/src/workbench-pins', () => ({
  pinModule: vi.fn(),
  pinPillar: vi.fn(),
  readPinnedModules: () => ['desk', 'tasks', 'calendar'],
}))
vi.mock('../src/renderer/src/skill-domain-pins', () => ({
  pinSkillDomain: vi.fn(),
  writeActiveSkillDomain: vi.fn(),
}))
vi.mock('../src/renderer/src/my-ai-consent', () => ({ workbenchModuleLabel: (id: string) => id }))
vi.mock('../src/renderer/src/active-workspace', async (orig) => ({
  ...(await orig<typeof import('../src/renderer/src/active-workspace')>()),
  readActiveWorkspaceId: () => 'w2',
}))

import { applyAgentIntent } from '../src/renderer/src/agent-intent-apply'

const WORKSPACES = [
  { id: 'w1', name: 'A', orgId: 'o1', slug: 'a', orgSlug: 'acme' },
  { id: 'w2', name: 'B', orgId: 'o1', slug: 'b', orgSlug: 'acme' },
]
const addTask = (text: string) =>
  createAgentIntent({
    target: { kind: 'module', id: 'tasks' },
    action: 'add_item',
    source: 'desktop',
    summary: 'Thêm việc',
    text,
  })

let listWorkspaces: ReturnType<typeof vi.fn>
let createTask: ReturnType<typeof vi.fn>

beforeEach(() => {
  listWorkspaces = vi.fn(async () => ({ ok: true, value: WORKSPACES }))
  createTask = vi.fn(async (input: { title: string }) => ({
    ok: true,
    value: { id: 't9', title: input.title },
  }))
  vi.stubGlobal('window', {
    aiOffice: { uniworkListWorkspaces: listWorkspaces },
    uniworkWork: { createTask },
    dispatchEvent: vi.fn(),
  })
})

describe('My AI add_item → Tasks', () => {
  it('creates the task on UniWork in the active workspace, with no local Undo', async () => {
    const r = await applyAgentIntent(addTask('Gọi lại khách'), 'entrepreneur')
    expect(createTask).toHaveBeenCalledWith({
      workspaceId: 'w2',
      title: 'Gọi lại khách',
      idempotencyKey: expect.any(String),
    })
    expect(r).toMatchObject({
      ok: true,
      tabId: 'tasks',
      messageEn: 'Added to tasks: Gọi lại khách',
    })
    expect(r.undo).toBeUndefined()
  })

  it('reports a failure when the server refuses', async () => {
    createTask.mockResolvedValueOnce({ ok: false, error: 'server' })
    const r = await applyAgentIntent(addTask('X'), 'entrepreneur')
    expect(r.ok).toBe(false)
  })

  it('does not call the server without a workspace (signed out)', async () => {
    listWorkspaces.mockResolvedValueOnce({ ok: false, error: 'not_signed_in' })
    const r = await applyAgentIntent(addTask('X'), 'entrepreneur')
    expect(createTask).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
  })

  it('reports a failure, never a throw, when the bridge rejects', async () => {
    createTask.mockRejectedValueOnce(new Error('ipc closed'))
    const r = await applyAgentIntent(addTask('X'), 'entrepreneur')
    expect(r.ok).toBe(false)
    listWorkspaces.mockRejectedValueOnce(new Error('ipc closed'))
    expect((await applyAgentIntent(addTask('Y'), 'entrepreneur')).ok).toBe(false)
  })

  it('an add request for Calendar opens the tab and writes nothing', async () => {
    const r = await applyAgentIntent(
      createAgentIntent({
        target: { kind: 'module', id: 'calendar' },
        action: 'add_item',
        source: 'desktop',
        summary: 'x',
        text: 'Họp khách',
      }),
      'entrepreneur',
    )
    expect(r).toMatchObject({ ok: true, tabId: 'calendar', messageEn: 'Opened calendar.' })
    expect(createTask).not.toHaveBeenCalled()
  })
})
