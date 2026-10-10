import type { zh } from './zh'

export const en = {
  webCancel: 'Cancel',
  webConflictTitle: 'This document was changed elsewhere',
  webConflictBody:
    'A newer version was saved while you were editing. Overwrite it with your version, or reload the latest version and discard your changes?',
  webConflictOverwrite: 'Overwrite',
  webConflictReload: 'Reload latest',
  webConflictNotSaved: 'the document was changed elsewhere',
  webFatalTitle: 'The document could not be opened',
  webFatalBody:
    'Editing and saving are disabled. Reload the page or open the document again from UniWork.',
  webNoHost: 'This editor runs inside UniWork. Open the document from UniWork.',
  webViewOnly: 'View only',
  webReloaded: 'the latest version was reloaded and your changes were discarded',
  webViewOnlyNoSave: 'this document is view-only',
  webMergeTitle: 'Merge PDFs',
  webMergeBody: '{count} PDF(s) selected. Add another PDF or merge now?',
  webMergeAdd: 'Add another PDF',
  webMergeNow: 'Merge now',
  webSaveNetwork: 'UniWork could not be reached. Check your connection and try again.',
  webSaveTimeout: 'Saving took too long. Check your connection and try again.',
  webAppOnlyHint: 'Open in the UniWork Office app to use this feature',
  webAppOnlyOpen: 'Open in app',
  webAppOnlyOcr: 'This PDF has scanned pages. Text recognition (OCR) is not available here.',
  webAppOnlyConvert: 'Converting a PDF to Word, Excel or PowerPoint is not available here.',
  webAppOnlyRedact: 'Redaction (permanently removing marked content) is not available here.',
} satisfies Record<keyof typeof zh, string>
