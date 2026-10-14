/**
 * Dump / restore Workbench IndexedDB media blobs for ZIP backup.
 * Stores: tasks attachments (Blob).
 */

import { isWorkbenchBucketCleared, wbMediaDbName } from './workbench-bucket'

export interface WbIdbMediaDump {
  version: 1
  tasks: Record<string, string>
}

const STORES = [
  { db: 'uniwork.wb.tasks.media', store: 'blobs', slot: 'tasks' as const, kind: 'blob' as const },
]

function openDb(name: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error(`idb_open_failed:${name}`))
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('blob_read_failed'))
    reader.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) return new Blob([dataUrl])
  const mime = m[1] || 'application/octet-stream'
  const isB64 = Boolean(m[2])
  const data = m[3] ?? ''
  if (isB64) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(data)], { type: mime })
}

async function dumpStore(
  dbName: string,
  storeName: string,
  kind: 'blob' | 'string',
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const db = await openDb(dbName, storeName)
    const entries = await new Promise<Array<[IDBValidKey, unknown]>>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const req = store.openCursor()
      const rows: Array<[IDBValidKey, unknown]> = []
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve(rows)
          return
        }
        rows.push([cursor.key, cursor.value])
        cursor.continue()
      }
      req.onerror = () => reject(req.error ?? new Error('idb_cursor_failed'))
    })
    db.close()
    for (const [key, value] of entries) {
      const id = String(key)
      if (kind === 'string' && typeof value === 'string' && value) {
        out[id] = value
      } else if (kind === 'blob' && value instanceof Blob) {
        out[id] = await blobToDataUrl(value)
      } else if (kind === 'blob' && typeof value === 'string' && value) {
        out[id] = value
      }
    }
  } catch {
    /* store may be empty / unavailable */
  }
  return out
}

async function restoreStore(
  dbName: string,
  storeName: string,
  kind: 'blob' | 'string',
  entries: Record<string, string>,
): Promise<void> {
  const ids = Object.keys(entries)
  if (ids.length === 0) return
  const db = await openDb(dbName, storeName)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    for (const id of ids) {
      const raw = entries[id]
      if (!raw) continue
      store.put(kind === 'blob' ? dataUrlToBlob(raw) : raw, id)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('idb_restore_failed'))
  })
  db.close()
}

export async function collectWorkbenchIdbMedia(): Promise<WbIdbMediaDump> {
  const dump: WbIdbMediaDump = { version: 1, tasks: {} }
  // no bucket (the account just changed): nothing of any account to read
  if (isWorkbenchBucketCleared()) return dump
  for (const s of STORES) {
    dump[s.slot] = await dumpStore(wbMediaDbName(s.db), s.store, s.kind)
  }
  return dump
}

export async function restoreWorkbenchIdbMedia(
  dump: WbIdbMediaDump | null | undefined,
): Promise<void> {
  if (!dump || dump.version !== 1 || isWorkbenchBucketCleared()) return
  for (const s of STORES) {
    const entries = dump[s.slot]
    if (entries && typeof entries === 'object') {
      await restoreStore(wbMediaDbName(s.db), s.store, s.kind, entries)
    }
  }
}

function readAllRows(db: IDBDatabase, storeName: string): Promise<Array<[IDBValidKey, unknown]>> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).openCursor()
    const rows: Array<[IDBValidKey, unknown]> = []
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) {
        resolve(rows)
        return
      }
      rows.push([cursor.key, cursor.value])
      cursor.continue()
    }
    req.onerror = () => reject(req.error ?? new Error('idb_cursor_failed'))
  })
}

/**
 * One time, for the account that received the pre-upgrade data: the shared
 * media databases move into the given bucket's (values copied as they are,
 * existing entries kept), then the shared ones are deleted. The bucket is the
 * one the caller loaded, not whatever is current when an await returns.
 * Rejects when a copy or a delete failed: the caller retries on the next load
 * (a repeated copy keeps what is already there).
 */
export async function moveLegacyWorkbenchIdbMedia(bucket: string): Promise<void> {
  for (const s of STORES) {
    const target = wbMediaDbName(s.db, bucket)
    if (target === s.db) return
    const legacy = await openDb(s.db, s.store)
    let rows: Array<[IDBValidKey, unknown]>
    try {
      rows = await readAllRows(legacy, s.store)
    } finally {
      legacy.close()
    }
    if (rows.length > 0) {
      const db = await openDb(target, s.store)
      try {
        const present = new Set((await readAllRows(db, s.store)).map(([key]) => String(key)))
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(s.store, 'readwrite')
          const store = tx.objectStore(s.store)
          for (const [key, value] of rows) if (!present.has(String(key))) store.put(value, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('idb_move_failed'))
        })
      } finally {
        db.close()
      }
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(s.db)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error(`idb_delete_failed:${s.db}`))
      req.onblocked = () => reject(new Error(`idb_delete_blocked:${s.db}`))
    })
  }
}

export function isWbIdbMediaDump(value: unknown): value is WbIdbMediaDump {
  if (!value || typeof value !== 'object') return false
  const v = value as WbIdbMediaDump
  return v.version === 1 && typeof v.tasks === 'object' && v.tasks != null
}
