// UNI-1931 (RFF-2): with a document open the native menu / browser owns Ctrl/Cmd+P; with none the
// shortcut must not vanish silently, so App swallows it and printDoc answers "open a document".
// In the web frame the bridge's print accelerator (UNI-1920, capture phase on window) already runs the
// 'print' menu command for every Ctrl/Cmd+P and prevents the default; App's branch then stands down
// (`defaultPrevented`), so a press is handled by one path: the dialog (document) or the message (none).

/**
 * A bare Ctrl/Cmd+P with no document that App should handle itself, and nobody has handled yet
 * (`defaultPrevented`: the web bridge's accelerator already ran the print command). A host without the print
 * capability leaves the key alone (printDoc is a no-op there, so swallowing it would say nothing).
 */
export function isNoDocumentPrintKey(
  e: Pick<
    KeyboardEvent,
    'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'key' | 'defaultPrevented'
  >,
  hasDoc: boolean,
  canPrint: boolean,
): boolean {
  return (
    !e.defaultPrevented &&
    (e.metaKey || e.ctrlKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key === 'p' &&
    !hasDoc &&
    canPrint
  )
}
