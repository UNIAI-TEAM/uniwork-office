/** Shared fixtures for the collab composer / picker tests (not a test file itself). */
import { vi } from 'vitest'
import type { CollabCandidate, CollabHostState } from '../src/collab/types'

/** English catalogue values of the composer + picker keys (spine String catalogue G8). */
export const PICKER_STRINGS = {
  collabMentionLabel: 'Mention someone',
  collabMentionSearching: 'Searching…',
  collabMentionCount: 'Results: {count}',
  collabMentionNoMatch: 'No one with access to this document matches “{query}”.',
  collabMentionNoCandidates: 'No one else has access to this document yet.',
  collabMentionError: 'Couldn’t load people.',
  collabMentionNoAccessBadge: "Can't view",
  collabRetry: 'Try again',
}

export const COMPOSER_STRINGS = {
  ...PICKER_STRINGS,
  collabComposerComment: 'Write a comment…',
  collabComposerReply: 'Write a reply…',
  collabComposerDiscussion: 'Write in the discussion…',
  collabEdit: 'Edit',
  collabSave: 'Save',
  collabSend: 'Send',
  collabSendHint: '{shortcut} to send',
  collabSending: 'Sending…',
  collabSendFailed: 'Couldn’t send. Your text is still in the box.',
  collabCancel: 'Cancel',
  collabDiscardTitle: 'Discard the draft?',
  collabDiscardBody: 'What you’ve written will be lost.',
  collabDiscard: 'Discard',
  collabKeepWriting: 'Keep writing',
  collabAiDraftLabel: 'Draft suggested by UniWork AI. Review it, then send.',
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
}

export function makeHost(over: Partial<CollabHostState> = {}): CollabHostState {
  return {
    documentId: 'doc-1',
    kind: 'comment',
    level: 'edit',
    myUserId: 'me',
    lang: 'en',
    platform: 'other',
    ...over,
  }
}

export function candidate(id: string, name: string, email?: string): CollabCandidate {
  return email === undefined
    ? { user_id: id, display_name: name }
    : { user_id: id, display_name: name, email }
}

export const ULID_A = '01J8X4USR0AAAAAAAAAAAAAAAA'
export const ULID_B = '01J8X4USR0BBBBBBBBBBBBBBBB'

/** A source whose searchMentions resolves `candidates` (or whatever `impl` returns). */
export function fakeSource(
  candidates: CollabCandidate[] = [],
  impl?: (p: { q: string; limit?: number }) => Promise<{ candidates: CollabCandidate[] }>,
) {
  const searchMentions = vi.fn(impl ?? (async () => ({ candidates })))
  return { searchMentions }
}

export function manyCandidates(n: number): CollabCandidate[] {
  return Array.from({ length: n }, (_, i) => candidate(`id-${i}`, `Person ${i}`))
}

/** Flush pending promises + timers inside act (call with fake timers installed). */
export async function settle(act: (cb: () => Promise<void>) => Promise<void>, ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
