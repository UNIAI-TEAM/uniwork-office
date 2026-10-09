/**
 * The web engine's typed failure code (UNI-1016). The web bridge's engine transport
 * (web/modules/sheets/engine/transport.ts) rejects every workbook operation with an error
 * carrying this code while no engine backend is installed; the renderer then shows the styled
 * "cannot be opened on the web yet" screen (EngineUnavailableScreen.tsx) instead of a status line.
 * Never produced on the desktop.
 */
export const ENGINE_UNAVAILABLE = 'engine-unavailable'

/** true for an error object (or a message) that carries ENGINE_UNAVAILABLE */
export function isEngineUnavailableError(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === ENGINE_UNAVAILABLE) return true
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.startsWith(`${ENGINE_UNAVAILABLE}:`)
}
