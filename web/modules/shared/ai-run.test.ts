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
})
