import type { zh } from './zh'

export const en = {
  // S1 save pill: chips and tooltips
  uwChipQueued: 'Save queued — not on UniWork yet',
  uwChipQueuedNewer: 'Save queued · newer edits',
  uwChipPausedAdmin: 'Save queued · sending paused',
  uwChipReconciling: 'Checking the last save…',
  uwChipReconcileStuck: 'Support needed to confirm the save',
  uwChipRemoteNewer: 'Newer version on UniWork',
  uwTipQueued:
    'Your save from {time} is kept safely on this computer and will be sent when you’re online.',
  uwTipQueuedNewer: 'The save from {time} is waiting to be sent. Later edits aren’t part of it.',
  uwTipPausedAdmin: 'Your admin has paused sending. The save is kept on this computer.',
  uwTipPausedUser:
    'You paused sending. The save from {time} is kept on this computer; choose Resume sending in the sync center.',
  uwTipReconciling:
    'It’s not yet clear whether the last save reached UniWork. The app is checking and won’t create a duplicate.',
  uwTipRemoteNewer: 'You have unsaved changes, so the document didn’t reload.',
  uwTipFailed: 'This save won’t retry on its own: {reason}. Your changes stay on this computer.',
  uwTipWaitAi: 'Waiting for AI to finish its current step, then saving.',
  uwTipWaitAiLong: 'AI hasn’t finished its current step. Stop the AI run to save now.',

  // S1 / S4 actions and queue popover
  uwActViewQueue: 'View queue',
  uwActSaveAgain: 'Save again',
  uwActStopAi: 'Stop AI',
  uwActBack: 'Back',
  uwQueuePopWaiting: 'Waiting to save: from {time} (based on version {base})',
  uwQueuePopNewer: 'Newer edits since then — not sent',
  uwQueueBlockedSave: 'Your last save is still waiting. You can save again once it finishes.',
  uwQueueFull:
    'Sync storage on this computer is full, so the save wasn’t queued. Your changes are still in the open window; free up space in the sync center.',
  uwQueueOpenCenter: 'Open sync center',
  uwQueueCancel: 'Cancel save…',
  uwQueueCancelConfirm:
    'Cancel the queued save? Your changes stay on this computer; the document on UniWork doesn’t change.',
  uwQueueCancelGo: 'Cancel save',
  uwQueueCancelled: 'Queued save cancelled. Your changes stay on this computer.',

  // {reason} fragments of the blocked/failed rows (the existing uwReason* keys stay in the uniwork-documents shard)
  uwReasonSession: 'sign in again',
  uwReasonSignedOut: 'signed out',
  uwReasonForeign: 'belongs to another account',
  uwReasonArchived: 'document archived',
  uwReasonSuspended: 'organization suspended',
  uwReasonDeactivated: 'your account is deactivated in this organization',
  uwReasonLease: 'offline access expired',
  uwReasonKeystore: 'this computer’s keychain is locked',
  uwReasonClock: 'the clock was set back',
  uwReasonStoreFull: 'sync storage on this computer is full',
  uwReasonStoreNewer: 'a newer app version is needed',

  // S2 queue-row badges
  uwBadgeQueued: 'Waiting',
  uwBadgeWaitNetwork: 'Waiting for network',
  uwBadgePausedUser: 'Paused by you',
  uwBadgePausedAdmin: 'Paused by admin',
  uwBadgeSending: 'Sending',
  uwBadgeReconciling: 'Checking',
  uwBadgeReconcileStuck: 'Needs support',
  uwBadgeConflict: 'Conflict',
  uwBadgeBlocked: 'Blocked',
  uwBadgeLocked: 'Locked',
  uwBadgeRevoked: 'No access',
  uwBadgeDeleted: 'Deleted',
  uwBadgeReconnect: 'Reconnect needed',
  uwBadgeKeystore: 'Keychain locked',
  uwBadgeFailed: 'Couldn’t send',
  uwBadgeSaved: 'Saved',
  uwBadgeKeptDraft: 'Kept draft',
  uwBadgeMoved: 'Moved',
  uwBadgeArchived: 'Archived',

  // S2 queue-row details
  uwRowQueued: 'Saved {time} · based on version {base} · {size}',
  uwRowWaitNetwork: 'Will send when online',
  uwRowPausedUser: 'Will send when you choose Resume sending',
  uwRowPausedAdmin: 'Will send when your admin turns sending back on',
  uwRowUploading: 'Uploading {done} / {total}',
  uwRowCommitting: 'Creating the version',
  uwRowReconciling: 'The result of the send at {time} isn’t clear yet. Checking with UniWork.',
  uwRowReconcileStuck:
    'Reconcile attempts: {count}, no result yet. The app won’t resend; send the support code to your admin.',
  uwStuckDiscardConfirm:
    'Discard this save? If it already reached UniWork, that version stays; your copy is kept as a draft in the sync center.',
  uwRowConflict: 'Version {n} was saved by {author} at {time}',
  uwRowFailed: 'Couldn’t send: {reason}',
  uwRowBlocked: 'Can’t save: {reason}',
  uwRowCommitted: 'Version {n} · {time}',
  uwRowKeptDraft: 'Kept when you reloaded at {time}',
  uwRowMoved: 'The document moved to {workspace}',
  uwRowArchived: 'The document was archived on UniWork',

  // S2 row actions
  uwActDiscard: 'Discard',
  uwActDiscardSave: 'Discard save…',
  uwActSendNow: 'Send now',
  uwActRecheck: 'Check again',
  uwActGuide: 'Guide',
  uwActOpenToResolve: 'Open to resolve',
  uwActCopySupport: 'Copy support code',
  uwActDownloadMine: 'Download my version',
  uwActOpenDraft: 'Open draft',
  uwActDiscardDraft: 'Discard draft…',
  uwActSignInAgain: 'Sign in again',
  uwActSignIn: 'Sign in',
  uwActSwitchAccount: 'Switch account',
  uwActReconnect: 'Reconnect',
  uwActDetails: 'Details',
  uwActOpen: 'Open',
  uwDiscardDraftConfirm:
    'Discard this draft? Its changes will be removed from this computer and can’t be recovered.',

  // Sign-out prompt
  uwSignOutTitle: 'Sign out of UniWork?',
  uwSignOutBody:
    'Documents with unsaved changes or queued saves: {count}. They stay locked on this computer and only your account can open them again.',
  uwSignOutKeystore:
    'The computer’s keychain is locked, so unsaved changes exist only in open windows. Signing out now discards them; anything already kept encrypted stays. To keep them, unlock the computer first.',
  uwSignOutGo: 'Sign out',
  uwSignOutWaiting: 'Finishing the save in progress before signing out…',

  // S2 sync center
  uwSyncTitle: 'Sync center',
  uwSyncOpenFromSettings: 'Sync center',
  uwSyncOnline: 'Connected to UniWork · synced {time}',
  uwSyncOffline: 'Offline · last synced {time}',
  uwSyncOnlineNoTime: 'Connected to UniWork',
  uwSyncOfflineNoTime: 'Offline',
  uwSyncPaused: 'Sending paused — new saves will wait',
  uwSyncAdminPaused: 'Your admin has paused sending. Saves are kept on this computer.',
  uwSyncFeedOff:
    'New-version notices are paused. UniWork still checks for conflicts when you save.',
  uwSyncResynced: 'Fully resynced at {time}',
  uwSyncResyncFailed:
    'Couldn’t resync after several tries. New-version notices are paused; UniWork still checks for conflicts when you save.',
  uwSyncSignedOut: 'You’re signed out. Items kept locked on this computer: {count}.',
  uwSyncSignedOutEmpty: 'You’re signed out.',
  uwSyncSessionExpired: 'Your session expired. Sign in again to keep sending.',
  uwSyncOtherOrg: 'Saves waiting in another organization: {count}',
  uwSyncStoreBudget: 'Sync storage on this computer: {used} of {cap}',
  uwSyncStoreError: 'Couldn’t read the queue on this computer. Nothing was deleted.',
  uwSyncNow: 'Sync now',
  uwSyncPause: 'Pause sending',
  uwSyncResume: 'Resume sending',
  uwSyncNowOffline: 'Syncing needs a connection.',
  uwSyncTabAttention: 'Needs attention',
  uwSyncTabQueue: 'Waiting to save',
  uwSyncTabOffline: 'Available offline',
  uwSyncTabRecent: 'Recently saved',
  uwSyncTabCount: '{label}: {count}',
  uwSyncColDoc: 'Document',
  uwSyncColState: 'Status',
  uwSyncColDetail: 'Details',
  uwSyncColActions: 'Actions',
  uwSyncMoreActions: 'More actions for {doc}',
  uwSyncEmptyQueue: 'Nothing is waiting to save.',
  uwSyncEmptyAttention: 'Nothing needs attention.',
  uwSyncEmptyRecent: 'No recent saves.',
  uwSyncActionFailed: 'That didn’t work. Nothing was deleted; try again.',
  uwSyncRowAnnounce: '{doc}: {state}',

  // S3 offline library
  uwOfflinePin: 'Make available offline',
  uwOfflineUnpin: 'Remove offline copy',
  uwOfflineUnpinShort: 'Unpin',
  uwOfflineAdd: 'Add documents…',
  uwOfflineUsage: 'Using {used} of {cap} on this computer',
  uwOfflineEmpty: 'No documents are available offline yet.',
  uwOfflineCapReached:
    'The offline library on this computer is at its limit: storage {cap}; maximum documents: {maxDocs}. Remove an offline copy to add another.',
  uwOfflineReady: 'Available offline',
  uwOfflineBadgeWaiting: 'Waiting for network',
  uwOfflineBadgeDownloading: 'Downloading',
  uwOfflineBadgeVerifying: 'Verifying',
  uwOfflineBadgeUpdate: 'Update available',
  uwOfflineBadgeInterrupted: 'Not ready',
  uwOfflineBadgeDiskFull: 'Not enough space',
  uwOfflineBadgeCorrupt: 'Download damaged',
  uwOfflineBadgeLeaseSoon: 'Offline access ending soon',
  uwOfflineBadgeViewOnly: 'Available offline · view only',
  uwOfflineRowWaiting: 'Will download when online',
  uwOfflineRowProgress: '{done} of {total}',
  uwOfflineRowProgressAria: '{done} of {total}',
  uwOfflineRowVerifying: 'Checking integrity',
  uwOfflineRowReady: 'Version {n} · {size} · offline access until {datetime}',
  uwOfflineRowUpdate: 'Version {n} will download when online; version {old} still works',
  uwOfflineRowUpdateKept: 'Couldn’t update to version {n}: {reason}. Version {old} still works.',
  uwOfflineRowInterrupted: 'The download was interrupted. The older copy (if any) still works.',
  uwOfflineRowDiskFull: '{size} more needed. The older copy is kept.',
  uwOfflineRowCorrupt: 'The damaged copy was removed. Download it again.',
  uwOfflineRowLeaseSoon: 'Connect before {datetime} to renew',
  uwOfflineRowRevoked:
    'You no longer have access to this document. The downloaded copy was removed; drafts stay locked.',
  uwOfflineRowDeleted:
    'The document was deleted on UniWork. The downloaded copy was removed; drafts stay locked.',
  uwOfflineRowArchived: 'The document was archived; the copy here opens until offline access ends.',
  uwOfflineRowMoved: 'Moved to {workspace}; the copy here still works.',
  uwOfflineRowViewOnly: 'Version {n} · view only · offline access until {datetime}',
  uwOfflineReadyAnnounce: 'Available offline: {doc}',
  uwOfflineUnpinConfirm:
    'The downloaded copy will be removed from this computer. Drafts and queued saves are kept.',
  uwOfflineCancelDownload: 'Cancel download',
  uwOfflineDownloadNow: 'Download now',
  uwOfflineOpenFolder: 'Open storage folder',

  // S11 lock panel and second window (uwLockNewerStore* live in the uniwork-documents shard)
  uwLockLeaseTitle: 'Reconnect needed',
  uwLockKeystoreTitle: 'This computer’s keychain is locked',
  uwLockClockTitle: 'Time check needed',
  uwLockRevokedTitle: 'No access',
  uwLockDeletedTitle: 'Document deleted',
  uwLockForeignTitle: 'Belongs to another account',
  uwLockOrgTitle: 'Can’t open in this organization',
  uwLockExpired: 'Offline access expired. The content stays encrypted; connect to open it again.',
  uwLockLibraryOff:
    'Your admin turned off offline documents, so offline access can’t be renewed. Drafts stay locked in the sync center.',
  uwLockKeystore:
    'The computer’s keychain is locked, so the encrypted content can’t be opened. Unlock it and try again; nothing was deleted.',
  uwLockClock:
    'The computer’s clock was set back, so offline access is locked. Connect so UniWork can check the time.',
  uwLockForeign:
    'This document belongs to another account on this computer. Switch to that account to open it.',
  uwLockSuspended:
    'The organization is suspended. The content stays encrypted; contact your admin.',
  uwLockDeactivated:
    'Your account is deactivated in this organization. The content stays encrypted; contact your admin.',
  uwLockSignedOutTitle: 'You’re signed out',
  uwLockSignedOut:
    'The content stays locked on this computer. Sign in with the same account to open it again.',
  uwLockRegion: 'Document status',
  uwLockWhileOpen:
    'The document was locked while open. Unsaved changes are kept encrypted; you can’t save or copy until it’s unlocked.',
  uwLockWhileOpenRam:
    'The document was locked while open and this computer can’t keep your changes safely yet. They exist only in this window (view only); closing it loses them.',
  uwLockOtherWindow:
    'This document is open for editing in another window. This window is view only.',
  uwLockOtherWindowGone:
    'The window editing this document stopped responding. You can edit in this window.',
  uwLockGoToWindow: 'Go to that window',
  uwLockTakeEdit: 'Edit in this window',

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

  // S5 conflict dialog (desktop)
  uwConflictTitle: 'This document was changed elsewhere',
  uwConflictBody: 'Your changes aren’t on UniWork yet and are safe on this computer.',
  uwConflictReload: 'Reload latest',
  uwConflictOverwrite: 'Overwrite…',
  uwConflictCancel: 'Cancel',
  uwConflictKeepUnavailable:
    'This computer can’t keep a draft right now (sync storage full or keychain locked).',
  uwConflictOfflineDesktop:
    'You’re offline and the latest version isn’t on this computer, so it can’t reload yet.',
  uwConflictReloadDesktopBody: 'Choose what happens to your changes before version {n} loads.',
  uwConflictKeepDraft: 'Keep my version as a draft',
  uwConflictDiscard: 'Discard my changes',
  uwConflictKeepDraftHint:
    'The draft stays in the sync center to view or copy; it’s never applied to the new version automatically.',
  uwConflictDraftCapReached:
    'This document has reached the maximum number of kept drafts: {cap}. Discard an old draft in the sync center to keep another.',

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

  // S6 new-version bar (desktop only)
  uwRemoteWaitStuck:
    'The earlier save needs support, so you can’t reload or overwrite yet. Open the sync center to resolve it.',
  uwRemoteRevoked:
    'You no longer have access to this document. Saving stopped; unsaved changes are kept locked on this computer.',
} satisfies Record<keyof typeof zh, string>
