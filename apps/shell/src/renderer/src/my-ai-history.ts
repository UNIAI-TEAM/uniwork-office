/**
 * Persist My AI chat threads per practice (Workbench SQLite via wbStore).
 */
import type { PracticeId } from '@uniwork/practice-core'
import type { AttachmentMeta } from '../../shared/home-api'
import { wbStoreGetRaw, wbStoreRemove, wbStoreSetRaw } from './workbench-store-client'

const KEY_PREFIX = 'uniwork.my-ai.chat.v1:'
const MAX_MESSAGES = 80
const MAX_TEXT = 4_000

export type StoredChatRole = 'user' | 'assistant' | 'system'

export interface StoredAttachment {
  path: string
  name: string
  ext: string
  sizeBytes: number
}

export interface StoredChatMessage {
  id: string
  role: StoredChatRole
  text: string
  contextUsed?: boolean
  attachments?: StoredAttachment[]
}

function storageKey(practiceId: PracticeId): string {
  return `${KEY_PREFIX}${practiceId}`
}

function sanitizeAtts(atts: unknown): StoredAttachment[] | undefined {
  if (!Array.isArray(atts)) return undefined
  const out: StoredAttachment[] = []
  for (const a of atts) {
    if (
      a &&
      typeof a === 'object' &&
      typeof (a as AttachmentMeta).path === 'string' &&
      typeof (a as AttachmentMeta).name === 'string' &&
      typeof (a as AttachmentMeta).ext === 'string'
    ) {
      out.push({
        path: (a as AttachmentMeta).path,
        name: (a as AttachmentMeta).name,
        ext: (a as AttachmentMeta).ext,
        sizeBytes: typeof (a as AttachmentMeta).sizeBytes === 'number' ? (a as AttachmentMeta).sizeBytes : 0,
      })
    }
  }
  return out.length > 0 ? out.slice(0, 12) : undefined
}

export function loadMyAiHistory(practiceId: PracticeId): StoredChatMessage[] {
  try {
    const raw = wbStoreGetRaw(storageKey(practiceId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (m): m is StoredChatMessage =>
          !!m &&
          typeof m === 'object' &&
          typeof (m as StoredChatMessage).id === 'string' &&
          typeof (m as StoredChatMessage).text === 'string' &&
          ['user', 'assistant', 'system'].includes((m as StoredChatMessage).role),
      )
      .slice(-MAX_MESSAGES)
      .map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text.slice(0, MAX_TEXT),
        ...(m.contextUsed ? { contextUsed: true } : {}),
        ...(sanitizeAtts(m.attachments) ? { attachments: sanitizeAtts(m.attachments) } : {}),
      }))
  } catch {
    return []
  }
}

export function saveMyAiHistory(
  practiceId: PracticeId,
  messages: ReadonlyArray<{
    id: string
    role: StoredChatRole
    text: string
    contextUsed?: boolean
    attachments?: AttachmentMeta[]
  }>,
): void {
  try {
    const payload: StoredChatMessage[] = messages.slice(-MAX_MESSAGES).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text.slice(0, MAX_TEXT),
      ...(m.contextUsed ? { contextUsed: true } : {}),
      ...(sanitizeAtts(m.attachments) ? { attachments: sanitizeAtts(m.attachments) } : {}),
    }))
    if (payload.length === 0) {
      wbStoreRemove(storageKey(practiceId))
      return
    }
    wbStoreSetRaw(storageKey(practiceId), JSON.stringify(payload))
  } catch {
    /* quota */
  }
}

export function clearMyAiHistory(practiceId: PracticeId): void {
  wbStoreRemove(storageKey(practiceId))
}
