// UNI-1931 (RFF-2): with a document open the native menu / browser owns Ctrl/Cmd+P; with none the
// shortcut must not vanish silently, so App swallows it and printDoc answers "open a document".

/**
 * A bare Ctrl/Cmd+P with no document that App should handle itself. A host without the print
 * capability leaves the key alone (printDoc is a no-op there, so swallowing it would say nothing).
 */
export function isNoDocumentPrintKey(
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'key'>,
  hasDoc: boolean,
  canPrint: boolean,
): boolean {
  return (
    (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === 'p' && !hasDoc && canPrint
  )
}
