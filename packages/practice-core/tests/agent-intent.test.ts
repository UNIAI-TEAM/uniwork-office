import { describe, expect, it } from 'vitest'
import {
  listAgentRoutableTabs,
  moduleSupportsAddItem,
  parseAgentIntentTarget,
  resolveAgentIntentFromText,
  tabIdForTarget,
} from '../src/agent-intent.js'

describe('agent-intent catalog', () => {
  it('lists routable tabs including modules and pillars', () => {
    const tabs = listAgentRoutableTabs()
    expect(tabs.some((t) => t.id === 'desk' && t.kind === 'module')).toBe(true)
    expect(tabs.some((t) => t.id === 'skills' && t.kind === 'pillar')).toBe(true)
    expect(tabs.find((t) => t.id === 'tasks')?.actions).toContain('add_item')
  })

  it('resolves Vietnamese NL to health / tasks', () => {
    const health = resolveAgentIntentFromText('Mở tab sức khoẻ giúp tôi')
    expect(health?.target).toEqual({ kind: 'module', id: 'health' })
    expect(health?.action).toBe('open')

    const task = resolveAgentIntentFromText('Thêm công việc mua sữa')
    expect(task?.target).toEqual({ kind: 'module', id: 'tasks' })
    expect(task?.action).toBe('add_item')
  })

  it('returns null for free-form chat without a Workbench cue', () => {
    expect(resolveAgentIntentFromText('Xin chào, giúp mình với')).toBeNull()
    expect(resolveAgentIntentFromText('Hôm nay trời đẹp quá')).toBeNull()
  })

  it('parses tab targets and skill domains', () => {
    expect(parseAgentIntentTarget('calendar')).toEqual({ kind: 'module', id: 'calendar' })
    expect(parseAgentIntentTarget('knowledge')).toEqual({ kind: 'pillar', id: 'knowledge' })
    expect(parseAgentIntentTarget(null, 'education')).toEqual({
      kind: 'skill-domain',
      id: 'education',
    })
    expect(tabIdForTarget({ kind: 'skill-domain', id: 'legal' })).toBe('skills')
    expect(moduleSupportsAddItem('notes')).toBe(true)
    expect(moduleSupportsAddItem('assistant')).toBe(false)
  })
})
