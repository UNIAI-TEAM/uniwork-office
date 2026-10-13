/**
 * Composer drafts keyed by {documentId, threadKey}. They live in sessionStorage
 * so a reload of the editor page keeps what the user was writing; the composer
 * clears one only after the server accepted the text (or the user discards it).
 * Storage can be blocked (private window, cleared site data), so every access
 * is wrapped and a per-window memory map takes over.
 */

export interface CollabDraftKey {
  documentId: string
  /** which composer: e.g. `new:<anchor>`, `reply:<commentId>`, `edit:<commentId>`, `discussion` */
  threadKey: string
}

const PREFIX = 'uw-collab-draft:'
const memory = new Map<string, string>()

/** the sessionStorage key; JSON keeps ids with separators from colliding */
export function draftStorageKey(key: CollabDraftKey): string {
  return PREFIX + JSON.stringify([key.documentId, key.threadKey])
}

export function loadDraft(key: CollabDraftKey): string | null {
  const k = draftStorageKey(key)
  try {
    const v = sessionStorage.getItem(k)
    if (v !== null) return v
  } catch {
    // blocked storage: fall through to memory
  }
  return memory.get(k) ?? null
}

/** An empty or whitespace-only text is not a draft: the entry is removed. */
export function saveDraft(key: CollabDraftKey, text: string): void {
  if (text.trim() === '') {
    clearDraft(key)
    return
  }
  const k = draftStorageKey(key)
  try {
    sessionStorage.setItem(k, text)
    memory.delete(k)
  } catch {
    memory.set(k, text)
  }
}

export function clearDraft(key: CollabDraftKey): void {
  const k = draftStorageKey(key)
  memory.delete(k)
  try {
    sessionStorage.removeItem(k)
  } catch {
    // blocked storage: nothing to remove
  }
}
