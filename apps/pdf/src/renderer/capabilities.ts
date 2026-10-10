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
 * | autoSave         | the 30 s / blur autosave timer (no autosave on the web, CONTRACT C10)   |
 * | autoRename       | content-derived rename after the first save                             |
 * | convertOffice    | PDF -> Word / Excel / PowerPoint                                        |
 * | ocr              | the OCR text layer of scanned pages                                     |
 * | pdfTextEdit      | edit text / insert text (pdfium + fonts)                                |
 * | pdfImageEdit     | edit image mode (pdfium)                                                |
 * | pdfAnnotDelete   | deleting annotations already saved in the file (pdfium)                 |
 * | insertPages      | import / replace pages from another PDF (host file picker)              |
 * | savedSignatures  | the reusable signature library                                          |
 * | redaction        | the Redact tool (applies into a working copy of the file)               |
 * | ribbonSaveState  | the ribbon-row Saving / Unsaved / Saved / Save failed + View only text  |
 * |                  | (the web host header owns the save state and the view-only notice)      |
 */
export type PdfCapability =
  | 'edit'
  | 'ai'
  | 'autoSave'
  | 'autoRename'
  | 'convertOffice'
  | 'ocr'
  | 'pdfTextEdit'
  | 'pdfImageEdit'
  | 'pdfAnnotDelete'
  | 'insertPages'
  | 'savedSignatures'
  | 'redaction'
  | 'ribbonSaveState'

export const { cap, platform, resetForTest } = createCapabilityReader<PdfCapability>(
  () => window.pdfApi?.capabilities,
)
