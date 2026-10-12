/// AI turn signal from an editor renderer to the shell main process.
///
/// Every editor (docs, sheets, slides, pdf, markdown, html) reports whether an
/// AI turn is running in it, so the shell can answer "is AI working on this
/// document" per webContents (the UniWork chip and the close guard read it
/// through TabManager.editorDirtyStates). The renderer only ever sends; the
/// main process validates every payload with parseAiRunReport, since a
/// renderer is not trusted to send a well-formed one.
///
/// This file is pure (no Electron import) so main, preload and tests share it;
/// the preload installer lives in ./ai-run-bridge.

export const AI_RUN_CHANNEL = 'uniwork:ai-run'

/** the global each editor preload exposes the reporter under */
export const AI_RUN_BRIDGE_KEY = 'uniworkAiRun'

export type AiRunState = 'running' | 'idle'

export interface AiRunReport {
  state: AiRunState
  /** opaque id of the turn; lets a late 'idle' of an older turn be ignored */
  runId?: string
}

/** what a preload exposes to its renderer as window.uniworkAiRun */
export interface AiRunBridge {
  reportAiRun(report: AiRunReport): void
}

/** upper bound on a run id; anything longer is not an id we minted */
export const MAX_AI_RUN_ID_LENGTH = 128

/** a validated report, or null when the payload is malformed */
export function parseAiRunReport(payload: unknown): AiRunReport | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const { state, runId } = payload as Record<string, unknown>
  if (state !== 'running' && state !== 'idle') return null
  if (runId === undefined) return { state }
  if (typeof runId !== 'string' || runId.length === 0 || runId.length > MAX_AI_RUN_ID_LENGTH)
    return null
  return { state, runId }
}
