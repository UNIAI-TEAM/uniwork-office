/**
 * Renderer-side cache for Workbench SQLite (main process).
 * After hydrate(), read/write go through memory + IPC; falls back to localStorage.
 */
import type { WorkbenchIdbMediaDump } from '../../shared/home-api'
import {
  collectWorkbenchIdbMedia,
  isWbIdbMediaDump,
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

type WbApi = {
  loadAll: () => Promise<{
    keys: WbKvMap
    keyCount: number
    dbPath: string
    unavailable?: boolean
  }>
  getKey: (key: string) => Promise<string | null>
  setKey: (key: string, value: string) => Promise<void>
  removeKey: (key: string) => Promise<void>
  importKeys: (keys: WbKvMap) => Promise<{ imported: number }>
  exportBackup: (
    media?: WorkbenchIdbMediaDump | null,
  ) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>
  importBackup: () => Promise<{
    ok: boolean
    keyCount?: number
    keys?: WbKvMap
    media?: WorkbenchIdbMediaDump
    error?: string
    canceled?: boolean
  }>
}

function wbApi(): WbApi | null {
  try {
    return window.aiOffice?.wb ?? null
  } catch {
    return null
  }
}

let cache = new Map<string, string>()
let hydrated = false
let usingSqlite = false

export function isWorkbenchStoreReady(): boolean {
  return hydrated
}

export function isWorkbenchUsingSqlite(): boolean {
  return usingSqlite
}

function collectLocalStorageKeys(): WbKvMap {
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

/** Call once on Home mount. Migrates localStorage → SQLite when DB is empty. */
export async function hydrateWorkbenchStore(): Promise<void> {
  const api = wbApi()
  if (!api) {
    hydrated = true
    usingSqlite = false
    return
  }
  try {
    const snap = await api.loadAll()
    if (snap.unavailable) {
      usingSqlite = false
      hydrated = true
      return
    }
    cache = new Map(Object.entries(snap.keys ?? {}))
    // Merge any allowlisted localStorage keys still missing from SQLite
    // (e.g. desk layout / My AI that previously bypassed wbStore).
    const fromLs = collectLocalStorageKeys()
    const missing: WbKvMap = {}
    for (const [k, v] of Object.entries(fromLs)) {
      if (!cache.has(k)) {
        missing[k] = v
        cache.set(k, v)
      }
    }
    if (Object.keys(missing).length > 0) {
      await api.importKeys(missing)
    }
    usingSqlite = true
  } catch {
    usingSqlite = false
    cache = new Map()
  }
  hydrated = true
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
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function wbStoreSetRaw(key: string, value: string): void {
  if (usingSqlite) {
    cache.set(key, value)
    const api = wbApi()
    if (api) void api.setKey(key, value).catch(() => undefined)
    try {
      localStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
    return
  }
  try {
    localStorage.setItem(key, value)
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
    if (api) void api.removeKey(key).catch(() => undefined)
  }
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export async function exportWorkbenchBackupUi(): Promise<
  { ok: true; path: string } | { ok: false; error: string; canceled?: boolean }
> {
  const api = wbApi()
  if (!api) return { ok: false, error: 'unavailable' }
  let media: WorkbenchIdbMediaDump | null = null
  try {
    media = await collectWorkbenchIdbMedia()
  } catch {
    media = null
  }
  const r = await api.exportBackup(media)
  if (r.ok && r.path) return { ok: true, path: r.path }
  return { ok: false, error: r.error ?? 'export-failed', canceled: r.canceled }
}

export async function importWorkbenchBackupUi(): Promise<
  { ok: true; keyCount: number } | { ok: false; error: string; canceled?: boolean }
> {
  const api = wbApi()
  if (!api) return { ok: false, error: 'unavailable' }
  const r = await api.importBackup()
  if (!r.ok) return { ok: false, error: r.error ?? 'import-failed', canceled: r.canceled }
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
