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
} satisfies Record<keyof typeof zh, string>
