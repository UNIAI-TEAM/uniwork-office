/**
 * The frame's AI turn state for the host (X-02 `aiRun`) and for the new-version bar (S6).
 * The tracker itself lives in agent-core (the desktop IPC transport uses it too); this module
 * keeps the web import path and owns the one tracker of this frame page.
 */
import { createAiRunTracker, type AiRunTracker } from '@genoffice/agent-core'

export { AI_RUN_IDLE_GRACE_MS, createAiRunTracker } from '@genoffice/agent-core'
export type { AiRunTracker, AiRunTrackerOptions } from '@genoffice/agent-core'

/** the one tracker of this frame page: the AI bridge feeds it, the S6 bar reads it */
export const frameAiRun: AiRunTracker = createAiRunTracker()
