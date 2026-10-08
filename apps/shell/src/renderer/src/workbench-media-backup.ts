/**
 * Dump / restore Workbench IndexedDB media blobs for ZIP backup.
 * Stores: tasks attachments (Blob), pets photos (data URL), health body (data URL).
 */

export interface WbIdbMediaDump {
  version: 1
  tasks: Record<string, string>
  pets: Record<string, string>
  health: Record<string, string>
}

const STORES = [
  { db: 'uniwork.wb.tasks.media', store: 'blobs', slot: 'tasks' as const, kind: 'blob' as const },
  { db: 'uniwork.wb.pets.media', store: 'photos', slot: 'pets' as const, kind: 'string' as const },
  {
    db: 'uniwork.wb.health.media',
    store: 'blobs',
    slot: 'health' as const,
    kind: 'string' as const,
  },
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
  const dump: WbIdbMediaDump = { version: 1, tasks: {}, pets: {}, health: {} }
  for (const s of STORES) {
    dump[s.slot] = await dumpStore(s.db, s.store, s.kind)
  }
  return dump
}

export async function restoreWorkbenchIdbMedia(dump: WbIdbMediaDump | null | undefined): Promise<void> {
  if (!dump || dump.version !== 1) return
  for (const s of STORES) {
    const entries = dump[s.slot]
    if (entries && typeof entries === 'object') {
      await restoreStore(s.db, s.store, s.kind, entries)
    }
  }
}

export function isWbIdbMediaDump(value: unknown): value is WbIdbMediaDump {
  if (!value || typeof value !== 'object') return false
  const v = value as WbIdbMediaDump
  return (
    v.version === 1 &&
    typeof v.tasks === 'object' &&
    v.tasks != null &&
    typeof v.pets === 'object' &&
    v.pets != null &&
    typeof v.health === 'object' &&
    v.health != null
  )
}
