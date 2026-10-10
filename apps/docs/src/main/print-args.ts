/**
 * Pure validators for the PDF print/export IPC args (docs:print-pdf-buffer,
 * docs:print, docs:save-merged-pdf). Renderer-supplied numbers reach Chromium
 * printToPDF verbatim, so they are range-checked here; the handlers stay thin.
 * Electron-free so unit tests can import this module directly.
 */

/** printable page dimension in twips: 0.1in (Word's floor) .. 50in */
export function validPrintDim(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 144 && v <= 72000
}

/** print scale factor: 0.1 .. 5 (undefined = Chromium default) */
export function validPrintScale(scale: unknown): boolean {
  return (
    scale === undefined ||
    (typeof scale === 'number' && Number.isFinite(scale) && scale >= 0.1 && scale <= 5)
  )
}

/** combined geometry guard shared by the printToPDF IPC handlers (docs:export-pdf,
 * docs:print-pdf-buffer): page width/height in twips plus optional scale */
export function validPrintGeometry(
  pageWidthTwips: unknown,
  pageHeightTwips: unknown,
  scale?: unknown,
): boolean {
  return validPrintDim(pageWidthTwips) && validPrintDim(pageHeightTwips) && validPrintScale(scale)
}

/** finite positive scale for the printToPDF/print option objects (Infinity fails `> 0` checks) */
export function printScaleOption(scale: unknown): { scale: number } | Record<string, never> {
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 && scale !== 1
    ? { scale }
    : {}
}

/**
 * True when the machine reports no printers at all (a fresh Linux VM without
 * CUPS, macOS "No printers available"). Chromium's print() then neither shows
 * a dialog nor calls back, so docs:print asks first and the renderer offers
 * Save as PDF instead. A failed query reads as "unknown", not "none": print()
 * is still allowed to try.
 */
export async function hasNoPrinter(sender: {
  getPrintersAsync?: () => Promise<unknown[]>
}): Promise<boolean> {
  if (typeof sender.getPrintersAsync !== 'function') return false
  try {
    return (await sender.getPrintersAsync()).length === 0
  } catch {
    return false
  }
}

/**
 * The file an "Export as PDF" save dialog result lands on. A name the user typed with the
 * document's own `.docx` extension (the dialog opens on `<name>.pdf`, and typing the docx name
 * is natural) becomes `.pdf` instead of `<name>.docx.pdf`; any other name without `.pdf` gets
 * the extension. The result is never the open `.docx` itself.
 */
export function pdfExportPath(picked: string): string {
  if (/\.pdf$/i.test(picked)) return picked
  if (/\.docx$/i.test(picked)) return picked.replace(/\.docx$/i, '.pdf')
  return `${picked}.pdf`
}
