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
  webViewOnlyNotSaved: 'This document is view only and cannot be saved',
  webNotUtf8: 'This file is not UTF-8 text. It opens view only so saving cannot change its bytes',
} satisfies Record<keyof typeof zh, string>
