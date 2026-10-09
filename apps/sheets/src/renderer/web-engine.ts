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

/**
 * The web engine's size gate (UNI-1016, CONTRACT C11): a workbook with more worksheet XML than
 * the frame handles opens with this code; the host then opens the G3 editor, and until it does
 * the frame shows its "too large for the web" state.
 */
export const WEB_TOO_LARGE = 'too_large'

export function isTooLargeError(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === WEB_TOO_LARGE) return true
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.startsWith(`${WEB_TOO_LARGE}:`)
}
