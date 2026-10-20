import type { zh } from './zh'

export const en = {
  // panel and panel states
  collabComments: 'Comments',
  collabDiscussion: 'Discussion',
  collabClosePanel: 'Close {panel}',
  collabLabelCount: '{label} · {count}',
  collabLoading: 'Loading…',
  collabEmptyComments: 'No comments yet. Select something in the document, then choose Comment.',
  collabEmptyDiscussion: 'No discussion yet. Write what you’d like to talk about in this document.',
  collabLoadError: 'Could not load this',
  collabLoadErrorBody: 'Nothing was lost. Try again in a moment.',
  collabRetry: 'Try again',
  collabOffline:
    'Can’t reach UniWork. You can still read what’s already loaded, but you can’t send yet.',
  collabServerError:
    'UniWork is having trouble. You can still read what’s already loaded, but you can’t send yet.',
  collabSignedOut: 'Your session has ended. Sign in again to send.',
  collabNoAccess: 'You no longer have access to this',
  collabNoAccessBody: 'This is hidden under your current access to this document.',
  collabViewOnlyBadge: 'View only',
  collabViewOnly: 'You have view access: you can read but not write.',
  collabUpdatedAnnounce: 'The content was updated.',

  // anchors
  collabAnchorDocx: 'Text: “{quote}”',
  collabAnchorCell: 'Cell {cell}',
  collabAnchorSlide: 'Slide {slide}',
  collabAnchorPage: 'Page {page}',
  collabAnchorStale: 'The location may have changed',
  collabAnchorLost: 'The commented passage is not in the current version',
  collabGoToAnchor: 'Go to location',
  collabAnchorViewVersion: 'View in version {n}',
  collabVersionViewBanner: 'You are viewing version {n} (read-only)',
  collabVersionViewUnavailable: 'This version could not be opened',

  // thread, actions, history
  collabResolved: 'Resolved',
  collabResolve: 'Resolve',
  collabReopen: 'Reopen',
  collabReply: 'Reply',
  collabReplyCount: 'Replies: {count}',
  collabActions: 'More actions',
  collabEdit: 'Edit',
  collabSave: 'Save',
  collabCancel: 'Cancel',
  collabDelete: 'Delete',
  collabCopyText: 'Copy content',
  collabDeleteTitle: 'Delete this?',
  collabDeleteBody: 'The text and edit history will be permanently deleted. Any replies stay.',
  collabDeleteConfirm: 'Delete permanently',
  collabDeleted: 'This content was deleted',
  collabEdited: 'Edited · {time}',
  collabEditedMark: '(edited)',
  collabFormerMember: 'Former member',
  collabHistory: 'View edit history',
  collabHistoryTitle: 'Edit history',
  collabHistoryCurrent: 'Current version',
  collabHistoryEntry: '{name}, {time}',
  collabHistoryEmpty: 'This hasn’t been edited.',
  collabHistoryError: 'Couldn’t load the edit history.',
  collabActionFailed: 'The action did not go through',

  // composer
  collabComposerComment: 'Write a comment…',
  collabComposerReply: 'Write a reply…',
  collabComposerDiscussion: 'Write in the discussion…',
  collabSend: 'Send',
  collabSendHint: '{shortcut} to send',
  collabSending: 'Sending…',
  collabSendFailed: 'Couldn’t send. Your text is still in the box.',
  collabCommentDeleted: 'This comment was deleted.',
  collabDiscussionDeleted: 'This discussion post was deleted.',
  collabDiscardTitle: 'Discard the draft?',
  collabDiscardBody: 'What you’ve written will be lost.',
  collabDiscard: 'Discard',
  collabKeepWriting: 'Keep writing',
  collabAiDraftLabel: 'Draft suggested by UniWork AI. Review it, then send.',

  // comments stored in the file (read-only)
  collabInFileSection: 'Comments in the file',
  collabInFileHint: 'Saved in the file and read-only: you can’t edit or reply here.',

  // mention access warning & post-send notice
  collabMentionWarnTitle: "Mentioned people can't view this document",
  collabMentionWarnBody: "{names} can't view this document, so they won't be notified.",
  collabShareViewThenSend: 'Share view access, then send',
  collabSendWithoutNotify: 'Send without notifying',
  collabMentionAskManager:
    'Ask someone who manages this document to share view access with {names}.',
  collabMentionMixedUnshareable: "Can't share with {unshareable}; they won't be notified.",
  collabSharingView: 'Sharing view access…',
  collabShareViewFailed:
    "Couldn't share view access with {failedNames}. You can try again or send without notifying.",
  collabShareViewPartial:
    "Shared view access with {sharedNames}. Couldn't share with {failedNames} (they won't be notified).",
  collabSendComment: 'Send comment',
  collabRetryShareFor: 'Try again for {failedNames}',
  collabSendFailedAfterShare:
    "Shared view access with {sharedNames}, but couldn't send the comment. Your text is still in the box — try sending again.",
  collabPostSendNoAccess: "{names} can't view this document, so they weren't notified.",
  collabPostSendShareAction: 'Share view access',
  collabPostSendNoRetroNote:
    "Sharing now won't notify them about this comment; mention them in a new comment to notify.",
  collabDismissNotice: 'Dismiss',
} satisfies Record<keyof typeof zh, string>
