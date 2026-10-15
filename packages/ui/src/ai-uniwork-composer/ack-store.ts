import { useCallback, useEffect, useRef, useState } from 'react'

export const UNIWORK_ACK_STORAGE_KEY = 'uniwork.office.ai.disclosure.ack.v1'

/**
 * Identity key for the S8 AI disclosure acknowledgment (EXPERIENCE › AI disclosure S8, OQ-UX10).
 * Stored per account + organization + document (`'local'` for local unbound files).
 * Changing document or organization requires re-acknowledgment. An empty account (the cloud
 * snapshot has not delivered it yet) has no scope to store under: the ack is required every
 * time and never stored, so it cannot count for a later account on the same document. An empty
 * org with an account is a personal account and keeps the `local-org` scope.
 */
export interface UniworkAckKey {
  readonly account: string
  readonly org: string
  readonly document: string | 'local'
}

export function serializeUniworkAckKey(key: UniworkAckKey | null | undefined): string | null {
  if (!key) return null
  const account = key.account?.trim()
  if (!account) return null
  const org = key.org?.trim() || 'local-org'
  const document = key.document?.trim() || 'local'
  return `${account}|${org}|${document}`
}

const memoryAcks = new Set<string>()
/**
 * Acks of keys that have no account (see `serializeUniworkAckKey`), keyed by the raw key identity.
 * Memory only: never written to storage, never read for a key that has an account, and shared by
 * every hook instance so the inline disclosure, an externally rendered one and the composer agree.
 */
const unscopedAcks = new Set<string>()
const listeners = new Set<() => void>()
let hydrated = false
let storageListenerAttached = false

function readStorageAcks(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(UNIWORK_ACK_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    return []
  }
}

function writeStorageAcks(entries: Iterable<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(UNIWORK_ACK_STORAGE_KEY, JSON.stringify([...new Set(entries)]))
  } catch {
    // storage blocked or quota exceeded: memoryAcks still holds for this session
  }
}

function notifyListeners(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // ignore listener errors
    }
  }
}

function ensureStorageListener(): void {
  if (storageListenerAttached) return
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  storageListenerAttached = true
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== null && event.key !== UNIWORK_ACK_STORAGE_KEY) return
    memoryAcks.clear()
    for (const item of readStorageAcks()) memoryAcks.add(item)
    hydrated = true
    notifyListeners()
  })
}

function ensureHydrated(): void {
  ensureStorageListener()
  if (hydrated) return
  hydrated = true
  for (const item of readStorageAcks()) memoryAcks.add(item)
}

/** Whether the user has acknowledged the S8 disclosure for this account + org + document */
export function isAcked(key: UniworkAckKey | null | undefined): boolean {
  const serialized = serializeUniworkAckKey(key)
  if (!serialized) return false
  ensureHydrated()
  return memoryAcks.has(serialized)
}

/** Records the user's S8 disclosure acknowledgment for this account + org + document */
export function ack(key: UniworkAckKey | null | undefined): void {
  const serialized = serializeUniworkAckKey(key)
  if (!serialized) return
  ensureHydrated()
  const had = memoryAcks.has(serialized)
  memoryAcks.add(serialized)
  writeStorageAcks(memoryAcks)
  if (!had) notifyListeners()
}

/** Clears all stored disclosure acknowledgments (used by tests and sign-out cleanup) */
export function clearUniworkAcks(): void {
  const hadAny = memoryAcks.size > 0 || unscopedAcks.size > 0
  memoryAcks.clear()
  unscopedAcks.clear()
  hydrated = false
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(UNIWORK_ACK_STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  if (hadAny) notifyListeners()
}

/** Subscribes to disclosure acknowledgment changes */
export function subscribeUniworkAck(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Stable identity of a key before it is trimmed and serialized; used for the in-memory ack */
function rawAckIdentity(key: UniworkAckKey | null | undefined): string | null {
  if (!key) return null
  return JSON.stringify([key.account ?? '', key.org ?? '', key.document ?? ''])
}

function isUnscopedAcked(key: UniworkAckKey | null | undefined): boolean {
  const identity = rawAckIdentity(key)
  return identity !== null && serializeUniworkAckKey(key) === null && unscopedAcks.has(identity)
}

/**
 * React hook binding an ack key to `isAcked` / `ack` state.
 * A key without an account cannot be stored (see `serializeUniworkAckKey`), so `acknowledge`
 * keeps that ack in one shared in-memory set instead: it lets every region and composer showing
 * that key send, is never written to storage, and is dropped as soon as the key changes.
 */
export function useUniworkDisclosureAck(key: UniworkAckKey | null | undefined): {
  readonly acked: boolean
  readonly needsAck: boolean
  readonly ackNow: () => void
  readonly acknowledge: () => void
} {
  const [, setTick] = useState(0)
  useEffect(() => subscribeUniworkAck(() => setTick((n) => n + 1)), [])
  const identity = rawAckIdentity(key)
  const previousIdentityRef = useRef(identity)
  useEffect(() => {
    const previous = previousIdentityRef.current
    previousIdentityRef.current = identity
    if (previous !== null && previous !== identity && unscopedAcks.delete(previous)) {
      notifyListeners()
    }
  }, [identity])
  const acked = isAcked(key) || isUnscopedAcked(key)
  const acknowledge = useCallback(() => {
    if (key != null && serializeUniworkAckKey(key) === null) {
      const raw = rawAckIdentity(key)
      if (raw !== null && !unscopedAcks.has(raw)) {
        unscopedAcks.add(raw)
        notifyListeners()
      }
      return
    }
    ack(key)
    setTick((n) => n + 1)
  }, [key])
  return { acked, needsAck: !acked, ackNow: acknowledge, acknowledge }
}
