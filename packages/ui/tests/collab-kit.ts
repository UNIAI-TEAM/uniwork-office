/**
 * Shared fixtures for the collab core tests (W20A): a scriptable fake `CollabSource`, a minimal en string
 * record (stub until strings-collab-panel lands; the real aggregator is wired by the lead), and comment builders.
 */
import { vi } from 'vitest'
import type {
  CollabComment,
  CollabHostState,
  CollabListResult,
  CollabSource,
} from '../src/collab/types'

export const EN: Record<string, string> = {
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
  collabAnchorDocx: 'Text: “{quote}”',
  collabAnchorCell: 'Cell {cell}',
  collabAnchorSlide: 'Slide {slide}',
  collabAnchorPage: 'Page {page}',
  collabAnchorStale: 'The location may have changed',
  collabAnchorLost: 'The commented location can no longer be found',
  collabGoToAnchor: 'Go to location',
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
  collabFormerMember: 'Former member',
  collabHistory: 'View edit history',
  collabHistoryTitle: 'Edit history',
  collabHistoryCurrent: 'Current version',
  collabHistoryEntry: '{name}, {time}',
  collabHistoryEmpty: 'This hasn’t been edited.',
  collabHistoryError: 'Couldn’t load the edit history.',
  collabActionFailed: 'The action did not go through',
  collabCommentDeleted: 'This comment was deleted.',
  collabDiscussionDeleted: 'This discussion post was deleted.',
  collabDiscardTitle: 'Discard the draft?',
  collabDiscardBody: 'What you’ve written will be lost.',
  collabDiscard: 'Discard',
  collabKeepWriting: 'Keep writing',
  collabInFileSection: 'Comments in the file',
  collabInFileHint: 'Saved in the file and read-only: you can’t edit or reply here.',
}

export function host(over: Partial<CollabHostState> = {}): CollabHostState {
  return {
    documentId: 'doc1',
    kind: 'comment',
    level: 'edit',
    myUserId: 'me',
    lang: 'en',
    platform: 'other',
    ...over,
  }
}

let seq = 0
export function cm(over: Partial<CollabComment> & { id: string }): CollabComment {
  seq++
  return {
    document_id: 'doc1',
    author_id: 'u1',
    parent_id: null,
    body: `body ${over.id}`,
    kind: 'comment',
    revision: 1,
    anchor: null,
    created_at: `2026-10-12T10:${String(seq % 60).padStart(2, '0')}:00Z`,
    updated_at: `2026-10-12T10:${String(seq % 60).padStart(2, '0')}:00Z`,
    display_name: 'Ann Lee',
    ...over,
  }
}

export function list(comments: CollabComment[], token = 't1'): CollabListResult {
  return { comments, mentions: [], list_token: token, unchanged: false }
}

export const UNCHANGED: CollabListResult = {
  comments: [],
  mentions: [],
  list_token: 't-same',
  unchanged: true,
}

export function err(code: string, detailsCode?: string) {
  return Object.assign(new Error(code), {
    code,
    ...(detailsCode ? { details: { code: detailsCode } } : {}),
  })
}

export interface FakeSource extends CollabSource {
  list: ReturnType<typeof vi.fn> & CollabSource['list']
  create: ReturnType<typeof vi.fn> & CollabSource['create']
  update: ReturnType<typeof vi.fn> & CollabSource['update']
  remove: ReturnType<typeof vi.fn> & CollabSource['remove']
  resolve: ReturnType<typeof vi.fn> & CollabSource['resolve']
  reopen: ReturnType<typeof vi.fn> & CollabSource['reopen']
  revisions: ReturnType<typeof vi.fn> & CollabSource['revisions']
  searchMentions: ReturnType<typeof vi.fn> & CollabSource['searchMentions']
}

/** every call resolves with an empty answer unless a test scripts it */
export function fakeSource(first: CollabListResult = list([])): FakeSource {
  const ok = (id = 'x') => Promise.resolve({ comment: cm({ id }) })
  return {
    list: vi.fn().mockResolvedValue(first),
    create: vi.fn(() => ok()),
    update: vi.fn(() => ok()),
    remove: vi.fn(() => Promise.resolve({ outcome: 'removed' as const })),
    resolve: vi.fn(() => ok()),
    reopen: vi.fn(() => ok()),
    revisions: vi.fn(() => Promise.resolve({ revisions: [] })),
    searchMentions: vi.fn(() => Promise.resolve({ candidates: [] })),
  } as unknown as FakeSource
}

/** let pending promises and React effects settle */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
