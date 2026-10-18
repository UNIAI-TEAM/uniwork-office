import { createCapabilityReader } from '@genoffice/ui/capabilities'

/**
 * Platform capabilities (GO-B4 / UNI-1014). Electron sets no object, so every entry is on; the web
 * frame (web/modules/pdf/install.ts) installs `window.pdfApi.capabilities` before the renderer runs
 * and turns off what has no web equivalent. Hidden entries are declared with `cap(key)` where they
 * are rendered, never with a platform check.
 *
 * | key              | hides when false                                                        |
 * |------------------|-------------------------------------------------------------------------|
 * | edit             | every editing entry (view-only: the host withholds the save grant)      |
 * | ai               | AI panel, AI ribbon buttons, ask-AI popover                             |
 * | imageGeneration  | the AI tool generate_image (also needs a live way to generate)         |
 * | autoSave         | the 30 s / blur autosave timer (no autosave on the web, CONTRACT C10)   |
 * | autoRename       | content-derived rename after the first save                             |
 * | convertOffice    | PDF -> Word / Excel / PowerPoint (web: the entry stays, its menu says   |
 * |                  | "use the app")                                                          |
 * | ocr              | the OCR text layer of scanned pages (web: a "use the app" notice)       |
 * | pdfTextEdit      | edit text / insert text (pdfium + fonts)                                |
 * | pdfImageEdit     | edit image mode (pdfium)                                                |
 * | pdfAnnotDelete   | deleting annotations already saved in the file (pdfium)                 |
 * | insertPages      | import / replace pages from another PDF (host file picker)              |
 * | savedSignatures  | the reusable signature library                                          |
 * | certSign         | certificate (digital) signing and the signatures panel: reads the file  |
 * |                  | on disk and writes a signed copy next to it (node:crypto, pdf-lib)      |
 * | redaction        | the Redact tool (applies into a working copy of the file)               |
 * | saveStatus       | the ribbon-row Saving / Unsaved / Saved / Save failed text (the web     |
 * |                  | host header owns the save state)                                        |
 * | viewOnlyChip     | the ribbon-row "View only" text (one host banner owns it on the web)    |
 * | desktopOpen      | (web) the "Open in app" action of the "use the app" messages; granted   |
 * |                  | by the host only while its own launch action is available               |
 */
export type PdfCapability =
  | 'edit'
  | 'save'
  | 'saveAs'
  | 'print'
  | 'exportPdf'
  | 'exportHtml'
  | 'ai'
  | 'imageGeneration'
  | 'autoSave'
  | 'autoRename'
  | 'convertOffice'
  | 'ocr'
  | 'pdfTextEdit'
  | 'pdfImageEdit'
  | 'pdfAnnotDelete'
  | 'insertPages'
  | 'savedSignatures'
  | 'certSign'
  | 'redaction'
  | 'saveStatus'
  | 'viewOnlyChip'
  | 'desktopOpen'

export const { cap, platform, resetForTest } = createCapabilityReader<PdfCapability>(
  () => window.pdfApi?.capabilities,
)

/** the "Open in app" action exists: web frame only, and only on the host's explicit grant (an unset
    key reads as on in `cap()`, so this tests the value) */
export function appOpenAvailable(): boolean {
  return platform() === 'web' && window.pdfApi?.capabilities?.desktopOpen === true
}
