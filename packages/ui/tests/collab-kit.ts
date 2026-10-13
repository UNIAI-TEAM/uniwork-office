/**
 * Shared fixtures for the collab core tests (W20A): a scriptable fake `CollabSource`, the en panel strings
 * (the real shard from strings-collab-panel), and comment builders.
 */
import { vi } from 'vitest'
import { collabPanelStrings } from '../src/strings-collab-panel'
import type {
  CollabComment,
  CollabHostState,
  CollabListResult,
  CollabSource,
} from '../src/collab/types'

export const EN: Record<string, string> = collabPanelStrings.en

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
