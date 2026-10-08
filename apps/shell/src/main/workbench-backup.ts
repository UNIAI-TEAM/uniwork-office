/**
 * Local Workbench backup: ZIP containing SQLite DB (+ optional IndexedDB media).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import JSZip from 'jszip'
import type { WorkbenchIdbMediaDump } from '../shared/home-api'
import { getWorkbenchDb, type WbKvMap } from './workbench-db'

export interface WorkbenchBackupManifest {
  version: 1
  kind: 'uniwork-workbench-backup'
  createdAt: string
  app: 'shell'
  keyCount: number
  /** Present when ZIP includes idb_media.json */
  hasIdbMedia?: boolean
}

function isMediaDump(value: unknown): value is WorkbenchIdbMediaDump {
  if (!value || typeof value !== 'object') return false
  const v = value as WorkbenchIdbMediaDump
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

export async function exportWorkbenchBackup(
  parent: BrowserWindow | null,
  media?: WorkbenchIdbMediaDump | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string; canceled?: boolean }> {
  try {
    const db = getWorkbenchDb(app.getPath('userData'))
    const keys = db.loadAll()
    const hasMedia = isMediaDump(media)
    const zip = new JSZip()
    const manifest: WorkbenchBackupManifest = {
      version: 1,
      kind: 'uniwork-workbench-backup',
      createdAt: new Date().toISOString(),
      app: 'shell',
      keyCount: Object.keys(keys).length,
      ...(hasMedia ? { hasIdbMedia: true } : {}),
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))
    zip.file('wb_kv.json', JSON.stringify(keys))
    if (hasMedia) {
      zip.file('idb_media.json', JSON.stringify(media))
    }
    // Also embed a raw copy of the sqlite file for forensics / future restores
    if (existsSync(db.dbPath)) {
      zip.file('workbench.sqlite', readFileSync(db.dbPath))
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const opts = {
      title: 'Export Workbench backup',
      defaultPath: `uniwork-workbench-${manifest.createdAt.slice(0, 10)}.zip`,
      filters: [{ name: 'UniWork backup', extensions: ['zip'] }],
    }
    const result =
      parent && !parent.isDestroyed()
        ? await dialog.showSaveDialog(parent, opts)
        : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) {
      return { ok: false, error: 'canceled', canceled: true }
    }
    writeFileSync(result.filePath, buffer)
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function importWorkbenchBackup(
  parent: BrowserWindow | null,
): Promise<
  | { ok: true; keyCount: number; keys: WbKvMap; media?: WorkbenchIdbMediaDump }
  | { ok: false; error: string; canceled?: boolean }
> {
  try {
    const openOpts = {
      title: 'Import Workbench backup',
      properties: ['openFile' as const],
      filters: [{ name: 'UniWork backup', extensions: ['zip', 'json'] }],
    }
    const picked =
      parent && !parent.isDestroyed()
        ? await dialog.showOpenDialog(parent, openOpts)
        : await dialog.showOpenDialog(openOpts)
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, error: 'canceled', canceled: true }
    }
    const filePath = picked.filePaths[0]
    const db = getWorkbenchDb(app.getPath('userData'))

    if (filePath.endsWith('.json')) {
      // Legacy localStorage snapshot from backup-addons.ts
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as {
        kind?: string
        version?: number
        keys?: WbKvMap
      }
      if (raw?.kind !== 'uniwork-local-backup' || raw.version !== 1 || !raw.keys) {
        return { ok: false, error: 'invalid-legacy-format' }
      }
      const n = db.replaceAll(raw.keys)
      db.setMeta('migrated_from_localstorage', '1')
      return { ok: true, keyCount: n, keys: db.loadAll() }
    }

    const zip = await JSZip.loadAsync(readFileSync(filePath))
    const manifestEntry = zip.file('manifest.json')
    const kvEntry = zip.file('wb_kv.json')
    const sqliteEntry = zip.file('workbench.sqlite')
    const mediaEntry = zip.file('idb_media.json')
    let media: WorkbenchIdbMediaDump | undefined
    if (mediaEntry) {
      try {
        const parsed: unknown = JSON.parse(await mediaEntry.async('string'))
        if (isMediaDump(parsed)) media = parsed
      } catch {
        /* optional */
      }
    }

    if (manifestEntry) {
      const manifest = JSON.parse(await manifestEntry.async('string')) as WorkbenchBackupManifest
      if (manifest.kind !== 'uniwork-workbench-backup' || manifest.version !== 1) {
        return { ok: false, error: 'invalid-manifest' }
      }
    }

    if (kvEntry) {
      const keys = JSON.parse(await kvEntry.async('string')) as WbKvMap
      const n = db.replaceAll(keys)
      db.setMeta('migrated_from_localstorage', '1')
      return { ok: true, keyCount: n, keys: db.loadAll(), ...(media ? { media } : {}) }
    }

    if (sqliteEntry) {
      const dir = mkdtempSync(join(tmpdir(), 'uw-wb-import-'))
      try {
        const incoming = join(dir, 'workbench.sqlite')
        writeFileSync(incoming, await sqliteEntry.async('nodebuffer'))
        db.replaceDatabaseFile(incoming)
        return {
          ok: true,
          keyCount: db.keyCount(),
          keys: db.loadAll(),
          ...(media ? { media } : {}),
        }
      } finally {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }

    return { ok: false, error: 'backup-empty' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
