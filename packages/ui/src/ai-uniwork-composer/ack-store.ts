import { useCallback, useEffect, useState } from 'react'

export const UNIWORK_ACK_STORAGE_KEY = 'uniwork.office.ai.disclosure.ack.v1'

/**
 * Identity key for the S8 AI disclosure acknowledgment (EXPERIENCE › AI disclosure S8, OQ-UX10).
 * Stored per account + organization + document (`'local'` for local unbound files).
 * Changing document or organization requires re-acknowledgment.
 */
export interface UniworkAckKey {
  readonly account: string
  readonly org: string
  readonly document: string | 'local'
}

export function serializeUniworkAckKey(key: UniworkAckKey | null | undefined): string | null {
  if (!key) return null
  const account = key.account?.trim()
  const org = key.org?.trim()
  const document = key.document?.trim()
  if (!account || !org || !document) return null
  return `${account}|${org}|${document}`
}

/** Whether the user has acknowledged the S8 disclosure for this account + org + document */
export function isAcked(_key: UniworkAckKey | null | undefined): boolean {
  return false
}

/** Records the user's S8 disclosure acknowledgment for this account + org + document */
export function ack(_key: UniworkAckKey | null | undefined): void {
  // implemented in behaviour commit
}

/** Clears all stored disclosure acknowledgments (used by tests and sign-out cleanup) */
export function clearUniworkAcks(): void {
  // implemented in behaviour commit
}

/** Subscribes to disclosure acknowledgment changes */
export function subscribeUniworkAck(_listener: () => void): () => void {
  return () => {}
}

/** React hook binding an ack key to `isAcked` / `ack` state */
export function useUniworkDisclosureAck(key: UniworkAckKey | null | undefined): {
  readonly acked: boolean
  readonly needsAck: boolean
  readonly acknowledge: () => void
} {
  const [, setTick] = useState(0)
  useEffect(() => subscribeUniworkAck(() => setTick((n) => n + 1)), [])
  const acked = isAcked(key)
  const acknowledge = useCallback(() => {
    ack(key)
    setTick((n) => n + 1)
  }, [key])
  return { acked, needsAck: !acked, acknowledge }
}
