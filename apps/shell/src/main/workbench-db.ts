/**
 * Local Workbench database (SQLite via node:sqlite DatabaseSync).
 * Lives under userData/workbench/workbench.sqlite — source of truth for wb.* keys.
 *
 * SQLite is loaded lazily so a missing/broken node:sqlite never prevents the
 * shell main process from booting (falls back to renderer localStorage).
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  appendFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { installStdioGuard } from './stdio-guard'

const SCHEMA_VERSION = 1

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wb_kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wb_kv_prefix ON wb_kv(key);
`

export type WbKvMap = Record<string, string>

type DatabaseSyncCtor = typeof import('node:sqlite').DatabaseSync
type DatabaseSyncInstance = InstanceType<DatabaseSyncCtor>

let DatabaseSyncRef: DatabaseSyncCtor | null = null
let sqliteLoadError: string | null = null

function loadDatabaseSync(): DatabaseSyncCtor {
  if (DatabaseSyncRef) return DatabaseSyncRef
  if (sqliteLoadError) throw new Error(sqliteLoadError)
  try {
    // Ensure broken-stdio guard is active before the ExperimentalWarning fires.
    installStdioGuard()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('node:sqlite') as typeof import('node:sqlite')
    if (typeof mod.DatabaseSync !== 'function') {
      throw new Error('node:sqlite.DatabaseSync unavailable')
    }
    DatabaseSyncRef = mod.DatabaseSync
    return DatabaseSyncRef
  } catch (err) {
    sqliteLoadError = err instanceof Error ? err.message : String(err)
    throw new Error(sqliteLoadError, { cause: err })
  }
}

function logDbError(userDataDir: string, err: unknown): void {
  try {
    const dir = join(userDataDir, 'workbench')
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, 'error.log'),
      `${new Date().toISOString()} ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
    )
  } catch {
    /* ignore */
  }
}

export class WorkbenchDb {
  readonly rootDir: string
  readonly dbPath: string
  private db: DatabaseSyncInstance

  constructor(userDataDir: string) {
    this.rootDir = join(userDataDir, 'workbench')
    this.dbPath = join(this.rootDir, 'workbench.sqlite')
    mkdirSync(this.rootDir, { recursive: true })
    mkdirSync(join(this.rootDir, 'media'), { recursive: true })
    const DatabaseSync = loadDatabaseSync()
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(SCHEMA_SQL)
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
      { value: string } | undefined
    const current = row ? Number(row.value) : 0
    if (!Number.isFinite(current) || current < SCHEMA_VERSION) {
      this.db
        .prepare(
          'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run('schema_version', String(SCHEMA_VERSION))
    }
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* ignore */
    }
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value)
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM wb_kv WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO wb_kv(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, value, now)
  }

  remove(key: string): void {
    this.db.prepare('DELETE FROM wb_kv WHERE key = ?').run(key)
  }

  loadAll(): WbKvMap {
    const rows = this.db.prepare('SELECT key, value FROM wb_kv').all() as {
      key: string
      value: string
    }[]
    const out: WbKvMap = {}
    for (const r of rows) out[r.key] = r.value
    return out
  }

  /** Bulk upsert (migration / import). */
  importKeys(keys: WbKvMap): number {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(
      'INSERT INTO wb_kv(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    let n = 0
    this.db.exec('BEGIN')
    try {
      for (const [k, v] of Object.entries(keys)) {
        if (typeof k !== 'string' || typeof v !== 'string') continue
        if (!isAllowedWbKey(k)) continue
        stmt.run(k, v, now)
        n++
      }
      this.db.exec('COMMIT')
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw err
    }
    return n
  }

  replaceAll(keys: WbKvMap): number {
    const now = new Date().toISOString()
    const stmt = this.db.prepare('INSERT INTO wb_kv(key, value, updated_at) VALUES(?, ?, ?)')
    let n = 0
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM wb_kv')
      for (const [k, v] of Object.entries(keys)) {
        if (typeof k !== 'string' || typeof v !== 'string') continue
        if (!isAllowedWbKey(k)) continue
        stmt.run(k, v, now)
        n++
      }
      this.db.exec('COMMIT')
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw err
    }
    return n
  }

  keyCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM wb_kv').get() as { n: number }
    return Number(row?.n ?? 0)
  }

  /** Hot-swap DB file after import (reopens connection). */
  replaceDatabaseFile(incomingPath: string): void {
    if (!existsSync(incomingPath)) throw new Error('incoming-db-missing')
    this.close()
    const bak = `${this.dbPath}.bak-${Date.now()}`
    if (existsSync(this.dbPath)) {
      try {
        copyFileSync(this.dbPath, bak)
      } catch {
        /* ignore */
      }
    }
    const tmp = `${this.dbPath}.import-tmp`
    copyFileSync(incomingPath, tmp)
    try {
      renameSync(tmp, this.dbPath)
    } catch {
      copyFileSync(tmp, this.dbPath)
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }
    const DatabaseSync = loadDatabaseSync()
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.migrate()
  }
}

export function isAllowedWbKey(key: string): boolean {
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

let singleton: WorkbenchDb | null = null
let singletonFailed = false

export function getWorkbenchDb(userDataDir: string): WorkbenchDb {
  if (singleton) return singleton
  if (singletonFailed) throw new Error(sqliteLoadError || 'workbench-db-unavailable')
  try {
    singleton = new WorkbenchDb(userDataDir)
    return singleton
  } catch (err) {
    singletonFailed = true
    logDbError(userDataDir, err)
    throw err
  }
}

/** Returns null when SQLite cannot open — callers should fall back. */
export function tryGetWorkbenchDb(userDataDir: string): WorkbenchDb | null {
  try {
    return getWorkbenchDb(userDataDir)
  } catch {
    return null
  }
}

export function resetWorkbenchDbForTests(): void {
  if (singleton) {
    singleton.close()
    singleton = null
  }
  singletonFailed = false
  sqliteLoadError = null
  DatabaseSyncRef = null
}
