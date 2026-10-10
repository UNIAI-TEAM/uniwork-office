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
  webDraftTitle: 'Restore unsaved changes?',
  webDraftBody:
    'This browser kept a copy of changes to this document that were not saved. Restore them or discard them?',
  webDraftOlder:
    'The copy is based on an older version of the document. Saving it replaces the newer version.',
  webDraftSavedAt: 'Copy kept at',
  webDraftKept: 'This browser keeps the copy until you sign out.',
  webDraftRestore: 'Restore',
  webDraftDiscard: 'Discard',
} satisfies Record<keyof typeof zh, string>
