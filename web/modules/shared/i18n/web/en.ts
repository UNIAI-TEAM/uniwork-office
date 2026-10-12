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
  webSaveNetwork: 'UniWork could not be reached. Check your connection and try again.',
  webSaveTimeout: 'Saving took too long. Check your connection and try again.',
  webClose: 'Close',
  webSaveUnauthorized: 'Your UniWork session ended. Sign in again, then try saving again.',
  webSaveForbidden: 'You do not have permission to save this document.',
  webSaveNotFound: 'This document no longer exists or was moved.',
  webSaveTooLarge: 'The document is too large to save.',
  webSaveRateLimited: 'Too many requests. Wait a moment and try again.',
  webSaveServer: 'UniWork had a problem saving. Try again in a moment.',
  webSaveFailedGeneric: 'The document could not be saved. Try again.',

  // S5 conflict dialog and S6 new-version bar (U-02 closed catalogue; same text as the desktop sync shard)
  // S5 conflict dialog (web only)
  webConflictBodySafe:
    'Your changes aren’t on UniWork yet and are kept in this browser until you sign out.',
  uwConflictReloadWebBody:
    'The browser doesn’t keep conflict drafts. Download your version to copy from later, or discard your changes.',
  uwConflictDownloadThenReload: 'Download my version, then reload',
  uwConflictDiscardThenReload: 'Discard changes and reload',
  uwConflictMineFileSuffix: '(my version)',
  uwConflictDownloadCheck:
    'Your browser received your file. Check that it was saved, then choose Reload.',
  uwConflictSessionWeb:
    'Your session expired, so the overwrite didn’t happen. Your changes stay in this browser; sign in again and retry.',
  uwConflictTooLarge: 'Your version is over UniWork’s size limit, so it couldn’t overwrite.',
  uwConflictDownloadFailed:
    'Couldn’t download your version, so the document didn’t reload. Try again.',
  uwConflictOfflineWeb:
    'You’re offline. On the web this needs a connection; your changes stay in this browser.',

  // S5 conflict dialog: two-column table
  uwConflictColMine: 'Your version',
  uwConflictColServer: 'Version on UniWork',
  uwConflictRowVersion: 'Version',
  uwConflictRowTime: 'Time',
  uwConflictRowBy: 'Saved by',
  uwConflictMineUnsaved: 'You (not saved)',
  uwConflictBasedOn: 'based on version {n}',

  // S5 conflict dialog: step 1 extras, confirmation step and results
  uwConflictViewDiff: 'View differences',
  uwConflictNoEdit: 'You no longer have edit access to this document.',
  uwConflictOverwriteTitle: 'Overwrite with your version?',
  uwConflictOverwriteConfirm:
    'UniWork will create version {next} from your copy. Version {server} by {author} stays in the history.',
  uwConflictOverwriteGo: 'Overwrite',
  uwConflictBack: 'Back',
  uwConflictHeadMoved: 'Meanwhile UniWork got version {n}. The table is updated; choose again.',
  uwConflictReloadTitle: 'Reload latest',
  uwConflictReloadGo: 'Reload',
  uwConflictSaveCopy: 'Save as a copy…',
  uwConflictSaveCopyTitle: 'Save as a copy?',
  uwConflictSaveCopyConfirm:
    'UniWork will create a new document from your version, with the same owner and access as this document. The current document and version {server} by {author} stay as they are.',
  uwConflictSaveCopyGo: 'Create copy',
  uwConflictSaveCopyDone:
    'Your version was saved as a new document: {title}. This document hasn’t changed; you can still reload or overwrite.',
  uwConflictSaveCopyFailed: 'Couldn’t create the copy. Your changes are still safe; try again.',
  uwConflictSaveCopyOffline:
    'You’re offline. Creating a copy needs a connection; your changes are kept.',
  uwConflictReloadFailed:
    'Couldn’t load the latest version. Your document hasn’t changed; try again.',
  uwConflictOverwriteFailed: 'Couldn’t overwrite yet. Your document hasn’t changed; try again.',
  uwConflictClose: 'Close',

  // S6 new-version bar
  uwRemoteRegion: 'New version',
  uwRemoteUpdated: 'Updated to version {n}, saved by {author} at {time}.',
  uwRemoteUpdatedNoRev: 'Updated to the latest version on UniWork.',
  uwRemoteNewerDirty:
    'A newer version is on UniWork (version {n}). You have unsaved changes, so the document didn’t reload.',
  uwRemoteNewerAi:
    'A newer version is on UniWork (version {n}). UniWork AI is running, so the document didn’t reload; AI results apply only to the open copy.',
  uwRemoteNowClean:
    'You’ve undone all changes. Version {n} on UniWork is newer than the open copy.',
  uwRemoteStopAiConfirm:
    'Stop the running UniWork AI run to reload? Changes AI already made belong to the open copy.',
  uwRemoteWaitCommit: 'Waiting for the save in progress to finish; you can reload after that.',
  uwRemoteReload: 'Reload latest…',
  uwRemoteLater: 'Later',
  uwRemoteClose: 'Close',
  uwRemoteReloadFailed: 'Couldn’t load version {n}. You’re still viewing the previous version.',
  uwRemoteDeleted: 'This document was deleted on UniWork. Queued saves stopped.',
  uwAuthorFallback: 'a member',

  // S6 new-version bar (web only)
  uwRemoteRevokedWeb:
    'You no longer have access to this document. Saving stopped; unsaved changes are kept in this browser until you sign out.',
  uwRemoteOrgBlockedWeb:
    'Couldn’t save: {reason}. Unsaved changes are kept in this browser until you sign out.',

  // {reason} of uwRemoteOrgBlockedWeb
  uwReasonArchived: 'document archived',
  uwReasonSuspended: 'organization suspended',
  uwReasonDeactivated: 'your account is deactivated in this organization',
} satisfies Record<keyof typeof zh, string>
