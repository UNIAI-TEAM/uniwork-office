/**
 * Renderer-side cache for Workbench SQLite (main process).
 * After hydrate(), read/write go through memory + IPC, scoped to the bucket of
 * the signed-in UniWork account (or signed-out use); see
 * apps/shell/src/main/workbench-accounts.ts. localStorage is shared by every
 * account on the computer, so it only holds data when the main-process store
 * is unavailable, and then under a per-bucket prefix.
 */
import type { WorkbenchIdbMediaDump, WorkbenchStoreApi } from '../../shared/home-api'
import {
  clearCurrentWorkbenchBucket,
  currentWorkbenchBucket,
  setCurrentWorkbenchBucket,
} from './workbench-bucket'
import {
  collectWorkbenchIdbMedia,
  isWbIdbMediaDump,
  moveLegacyWorkbenchIdbMedia,
  restoreWorkbenchIdbMedia,
} from './workbench-media-backup'

export type WbKvMap = Record<string, string>

function allowedKey(key: string): boolean {
  return (
    key.startsWith('uniwork.wb.') ||
    key.startsWith('uniwork.skill.') ||
    key.startsWith('uniwork.teacher') ||
    key.startsWith('uniwork.activePractice') ||
    key === 'uniwork.teacherUiLang' ||
    key === 'uniwork.addons.entitlements' ||
    key.startsWith('uniwork.my-ai.') ||
    key.startsWith('uniwork.ai.')
  )
}

function wbApi(): WorkbenchStoreApi | null {
  try {
    return window.aiOffice?.wb ?? null
  } catch {
    return null
  }
}

let cache = new Map<string, string>()
let hydrated = false
let usingSqlite = false
/** a load failed: nothing is readable or writable until the next reset + load (no fallback to another bucket's copy) */
let failed = false
/** bumped by every reset: a hydrate that started before it does not apply */
let generation = 0

export function isWorkbenchStoreReady(): boolean {
  return hydrated
}

export function isWorkbenchUsingSqlite(): boolean {
  return usingSqlite
}

/** the last load failed: the store is closed (nothing read or written) until a reset + load succeeds */
export function isWorkbenchLoadFailed(): boolean {
  return failed
}

/**
 * With a main-process store, nothing is read or written before a hydrate has
 * named the bucket (and after a reset): a write then would land outside any
 * account. Without one (tests) localStorage is used as is.
 */
function storeClosed(): boolean {
  return failed || (!hydrated && wbApi() !== null)
}

/** localStorage name of a key: prefixed with the bucket when one is known */
function lsKey(key: string): string {
  const bucket = currentWorkbenchBucket()
  return bucket ? `uniwork.wbacct.${bucket}.${key}` : key
}

/** pre-upgrade copies: unprefixed allowlisted keys */
function collectLegacyLocalStorageKeys(): WbKvMap {
  const keys: WbKvMap = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !allowedKey(k)) continue
      const v = localStorage.getItem(k)
      if (v != null) keys[k] = v
    }
  } catch {
    /* ignore */
  }
  return keys
}

function removeLocalStorageKeys(keys: Iterable<string>): void {
  for (const k of keys) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Drops everything held for the previous account at once (the account
 * changed), including its bucket name; reads return nothing until the next
 * hydrate names the new one.
 */
export function resetWorkbenchStore(): void {
  generation++
  cache = new Map()
  hydrated = false
  usingSqlite = false
  failed = false
  clearCurrentWorkbenchBucket()
}

/**
 * Loads the current bucket. Once, for the account that received the
 * pre-upgrade data, the old shared localStorage and IndexedDB copies move into
 * it (keys already there win) and are deleted.
 */
export async function hydrateWorkbenchStore(): Promise<void> {
  const api = wbApi()
  resetWorkbenchStore()
  const mine = generation
  if (!api) {
    setCurrentWorkbenchBucket('')
    hydrated = true
    return
  }
  try {
    const snap = await api.loadAll()
    if (mine !== generation) return
    setCurrentWorkbenchBucket(snap.bucket)
    if (snap.unavailable) {
      if (snap.legacyPending) await moveLegacyIntoLocalStorage(api, snap.bucket)
      if (mine !== generation) return
      hydrated = true
      return
    }
    const next = new Map(Object.entries(snap.keys ?? {}))
    if (snap.legacyPending) {
      const legacy = collectLegacyLocalStorageKeys()
      const missing: WbKvMap = {}
      for (const [k, v] of Object.entries(legacy)) {
        if (!next.has(k)) {
          missing[k] = v
          next.set(k, v)
        }
      }
      if (Object.keys(missing).length > 0) await api.importKeys(missing, snap.bucket)
      await moveLegacyMediaAndFinish(api, snap.bucket, Object.keys(legacy))
    }
    if (mine !== generation) return
    cache = next
    usingSqlite = true
  } catch {
    if (mine !== generation) return
    // closed, not a localStorage fallback: no bucket was named, so the only
    // copy such a fallback could reach is another account's
    usingSqlite = false
    cache = new Map()
    failed = true
  }
  hydrated = true
}

async function moveLegacyIntoLocalStorage(api: WorkbenchStoreApi, bucket: string): Promise<void> {
  const legacy = collectLegacyLocalStorageKeys()
  for (const [k, v] of Object.entries(legacy)) {
    try {
      if (localStorage.getItem(lsKey(k)) == null) localStorage.setItem(lsKey(k), v)
    } catch {
      /* quota */
    }
  }
  await moveLegacyMediaAndFinish(api, bucket, Object.keys(legacy))
}

async function moveLegacyMediaAndFinish(
  api: WorkbenchStoreApi,
  bucket: string,
  legacyKeys: string[],
): Promise<void> {
  // the keys are in the account store (or the bucket's fallback copy) by now
  removeLocalStorageKeys(legacyKeys)
  try {
    await moveLegacyWorkbenchIdbMedia(bucket)
  } catch {
    // not confirmed: the shared media databases stay and the move is tried
    // again on the next load (a repeated copy keeps what is already there)
    return
  }
  try {
    await api.legacyDone(bucket)
  } catch {
    // everything is already moved; the confirmation is asked again on the next
    // load, so it must not close the store for the rest of the session
  }
}

/** Replace cache after import backup. */
export function replaceWorkbenchCache(keys: WbKvMap): void {
  cache = new Map(Object.entries(keys))
  usingSqlite = true
  hydrated = true
}

/** Raw string value (view prefs, ids) — not JSON-encoded. */
export function wbStoreGetRaw(key: string): string | null {
  if (usingSqlite) {
    return cache.has(key) ? (cache.get(key) ?? null) : null
  }
  if (storeClosed()) return null
  try {
    return localStorage.getItem(lsKey(key))
  } catch {
    return null
  }
}

/**
 * Keys held for the current bucket (the cache, or the bucket's localStorage
 * fallback copy), unprefixed. Nothing while no bucket is loaded.
 */
export function wbStoreKeys(): string[] {
  if (usingSqlite) return [...cache.keys()]
  if (storeClosed()) return []
  const bucket = currentWorkbenchBucket()
  const prefix = bucket ? `uniwork.wbacct.${bucket}.` : ''
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (prefix) {
        if (k.startsWith(prefix)) keys.push(k.slice(prefix.length))
      } else if (allowedKey(k)) {
        keys.push(k)
      }
    }
  } catch {
    /* ignore */
  }
  return keys
}

export function wbStoreSetRaw(key: string, value: string): void {
  if (usingSqlite) {
    cache.set(key, value)
    const api = wbApi()
    if (api) void api.setKey(key, value, currentWorkbenchBucket()).catch(() => undefined)
    return
  }
  if (storeClosed()) return
  try {
    localStorage.setItem(lsKey(key), value)
  } catch {
    /* ignore */
  }
}

export function wbStoreRead<T>(key: string, fallback: T): T {
  const raw = wbStoreGetRaw(key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function wbStoreWrite(key: string, value: unknown): void {
  let raw: string
  try {
    raw = JSON.stringify(value)
  } catch {
    return
  }
  wbStoreSetRaw(key, raw)
}

export function wbStoreRemove(key: string): void {
  if (usingSqlite) {
    cache.delete(key)
    const api = wbApi()
    if (api) void api.removeKey(key, currentWorkbenchBucket()).catch(() => undefined)
    return
  }
  if (storeClosed()) return
  try {
    localStorage.removeItem(lsKey(key))
  } catch {
    /* ignore */
  }
}

export async function exportWorkbenchBackupUi(): Promise<
  { ok: true; path: string } | { ok: false; error: string; canceled?: boolean }
> {
  const api = wbApi()
  if (!api) return { ok: false, error: 'unavailable' }
  let media: WorkbenchIdbMediaDump | null
  try {
    media = await collectWorkbenchIdbMedia()
  } catch {
    media = null
  }
  const r = await api.exportBackup(media, currentWorkbenchBucket())
  if (r.ok && r.path) return { ok: true, path: r.path }
  return { ok: false, error: r.error ?? 'export-failed', canceled: r.canceled }
}

export async function importWorkbenchBackupUi(): Promise<
  { ok: true; keyCount: number } | { ok: false; error: string; canceled?: boolean }
> {
  const api = wbApi()
  if (!api) return { ok: false, error: 'unavailable' }
  const bucket = currentWorkbenchBucket()
  const r = await api.importBackup(bucket)
  if (!r.ok) return { ok: false, error: r.error ?? 'import-failed', canceled: r.canceled }
  // the account changed while the dialog was open: its data is not this cache's
  if (bucket !== currentWorkbenchBucket()) return { ok: false, error: 'account-changed' }
  if (r.keys) replaceWorkbenchCache(r.keys)
  if (isWbIdbMediaDump(r.media)) {
    try {
      await restoreWorkbenchIdbMedia(r.media)
    } catch {
      /* KV restore succeeded; media best-effort */
    }
  }
  return { ok: true, keyCount: r.keyCount ?? 0 }
}
