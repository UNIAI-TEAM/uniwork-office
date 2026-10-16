import type { zh } from './zh'

export const en = {
  webConflictTitle: 'This presentation was changed elsewhere',
  webConflictBody:
    'Your changes aren’t on UniWork yet and are kept in this browser until you sign out.',
  webConflictOverwrite: 'Overwrite…',
  webConflictReload: 'Reload latest',
  webConflictNotSaved: 'the presentation was changed elsewhere',
  webDiscardTitle: 'Discard unsaved changes?',
  webDiscardBody: 'This presentation has unsaved changes. Opening another file loses them.',
  webDiscard: 'Discard and open',
  webCancel: 'Cancel',
  webOk: 'OK',
  webFatalTitle: 'The presentation could not be opened',
  webFatalBody: 'The file could not be loaded from UniWork. Close this tab and try again.',
  webRefusedTooLarge: 'This presentation is too large or too complex to open on the web.',
  webRefusedTooComplex:
    'This presentation is too complex to open on the web ({parts} parts, limit {limit}).',
  webRefusedOutOfMemory:
    'This presentation is too large and ran out of browser memory while opening.',
  webNoHost: 'This editor runs inside UniWork. Open the presentation from UniWork.',
  webLegacyPpt:
    'This is a legacy .ppt file and cannot be opened in the browser. Save it as .pptx in PowerPoint first.',
  webEncryptedPptx: 'This presentation is password-protected and cannot be opened in the browser.',
  webCommentAuthor: 'User',
  webExternalMedia: 'Linked external media play only in the desktop app.',
  webReadOnly: 'This presentation is read-only.',
  webSaveNetwork: 'UniWork could not be reached. Check your connection and try again.',
  webSaveTimeout: 'Saving took too long. Check your connection and try again.',
  webFullscreenHint: 'Click or press any key to enter full screen',
} satisfies Record<keyof typeof zh, string>
