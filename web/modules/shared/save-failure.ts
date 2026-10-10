/**
 * The text a failed save shows in a module's status bar and toast. The protocol's own message is
 * developer English ("Failed to fetch", "save timed out"), so a network or timeout failure gets the
 * frame's translated sentence; any other failure keeps the host's message.
 */
export function saveFailureText(
  error: { code: string; message: string },
  translate: (key: 'webSaveNetwork' | 'webSaveTimeout') => string,
): string {
  if (error.code === 'timeout') return translate('webSaveTimeout')
  if (error.code === 'network') return translate('webSaveNetwork')
  return error.message
}
