/**
 * Shared Ctrl/Cmd+P accelerator for the frame (UNI-1920, item B).
 *
 * Docs and the HTML module have no renderer binding for mod+P, so inside a focused frame the
 * browser's own print dialog opens and bypasses the module's print path. Markdown, Sheets,
 * Slides and PDF already bind the key to their own print action — this is NOT installed there.
 *
 * Listens for `keydown` on `target` in the CAPTURE phase: mod+P (Ctrl or ⌘) without Shift/Alt,
 * key auto-repeat ignored. `run` is the module's print path and doubles as the capability
 * gate: only when it returns true — the `print` cap is effective and a print listener mounted —
 * is the browser default suppressed, so an unhandled press keeps the browser's print dialog.
 * Returns an uninstall function.
 */
export function installPrintAccelerator(_target: Window, _run: () => boolean): () => void {
  // signature stub for the red tests; the capture-phase listener lands in the green commit
  return () => {}
}
