// The tracker moved to agent-core (packages/agent-core/tests/ai-run-tracker.test.ts); the web
// module keeps the import path and the frame's one tracker.
import { createAiRunTracker as shared } from '@genoffice/agent-core'
import { describe, expect, it } from 'vitest'
import { createAiRunTracker, frameAiRun } from './ai-run'

describe('web ai-run re-export', () => {
  it('is the agent-core tracker, and the frame has one idle tracker of it', () => {
    expect(createAiRunTracker).toBe(shared)
    expect(frameAiRun.running()).toBe(false)
  })

  it('setRunId puts the server run id into the aiRun payloads of the frame tracker', () => {
    const sent: Array<{ state: string; run_id?: string }> = []
    const t = createAiRunTracker({ report: (p) => sent.push(p), graceMs: 0 })
    t.begin('s1')
    t.setRunId('srv-run')
    t.end('s1')
    expect(sent.at(-1)).toEqual({ state: 'idle', run_id: 'srv-run' })
    expect(sent.map((p) => p.state)).toEqual(['running', 'running', 'idle'])
  })
})
