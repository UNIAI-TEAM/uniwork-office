/**
 * My AI chats and workbench data per UniWork account.
 *
 * Every account has its own database file under
 * `<userData>/workbench/accounts/<bucket>/`, and signed-out use has its own in
 * `<userData>/workbench/local/`. Only the active bucket is open; every read
 * and write from the renderer names the bucket it was loaded from and is
 * refused when that is not the active one, so a late write of the previous
 * account never lands in the next one's data (and the next account can never
 * read the previous one's).
 *
 * The bucket name is a hash of deployment + account id: no account id or
 * email appears in a path.
 *
 * Pre-upgrade data (the shared `<userData>/workbench/workbench.sqlite`, plus
 * the renderer's localStorage / IndexedDB copies) goes to the first account
 * that signs in after the upgrade, once. `legacy-migration.json` records it;
 * the renderer moves its own copies when the store reports `legacyPending`
 * and then confirms with `markLegacyRendererDone`.
 *
 * Electron-free (unit-tested); index.ts feeds it the session identity.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tryOpenWorkbenchDb, type WorkbenchDb } from './workbench-db'

/** the account a bucket belongs to (deployment-scoped, like working copies) */
export interface WorkbenchOwner {
  deploymentId: string
  accountId: string
}

export const LOCAL_BUCKET = 'local'

/** `local` for signed-out use, `a-<hash>` for an account */
export function workbenchBucketOf(owner: WorkbenchOwner | null): string {
  if (!owner) return LOCAL_BUCKET
  const digest = createHash('sha256')
    .update(`${owner.deploymentId}\n${owner.accountId}`)
    .digest('hex')
  return `a-${digest.slice(0, 32)}`
}

interface LegacyMarker {
  version: 1
  /** the bucket the pre-upgrade data went to */
  to: string
  movedAt: string
  /** the renderer moved its localStorage / IndexedDB copies too */
  rendererDone: boolean
}

export interface WorkbenchAccountsOptions {
  userDataDir: string
  /** one line when the pre-upgrade data moves (account id only, no other personal data) */
  log?: (line: string) => void
  now?: () => Date
  /** removes a file (tests make it fail) */
  unlink?: (path: string) => void
}

/** longest wait for the first account status after start before the signed-out bucket is used anyway */
const SETTLE_MAX_WAIT_MS = 10_000

export class WorkbenchAccounts {
  private readonly userDataDir: string
  private readonly root: string
  private readonly log: (line: string) => void
  private readonly now: () => Date
  private readonly unlink: (path: string) => void
  /** the first owner after start has been applied: until then the bucket is a guess */
  private settled = false
  private settleWaiters: Array<() => void> = []
  private active = LOCAL_BUCKET
  private activeOwner: WorkbenchOwner | null = null
  /** the open database of the active bucket; undefined = not opened yet */
  private db: WorkbenchDb | null | undefined

  constructor(options: WorkbenchAccountsOptions) {
    this.userDataDir = options.userDataDir
    this.root = join(options.userDataDir, 'workbench')
    this.log = options.log ?? ((line) => console.info(line))
    this.now = options.now ?? (() => new Date())
    this.unlink = options.unlink ?? unlinkSync
  }

  /**
   * Resolves once the first owner after start has been applied (a signed-in
   * launch must not read the signed-out bucket while the session restore is
   * still starting), or after `maxWaitMs` so a stuck start cannot leave the
   * renderer without any data.
   */
  whenSettled(maxWaitMs: number = SETTLE_MAX_WAIT_MS): Promise<void> {
    if (this.settled) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, maxWaitMs)
      this.settleWaiters.push(done)
    })
  }

  private settle(): void {
    this.settled = true
    for (const done of this.settleWaiters.splice(0)) done()
  }

  /** the active bucket */
  bucket(): string {
    return this.active
  }

  /**
   * The account whose data is shown (null = signed out). True when the bucket
   * changed: the old database is closed and nothing of it stays open.
   */
  setOwner(owner: WorkbenchOwner | null): boolean {
    const next = workbenchBucketOf(owner)
    this.settle()
    if (next === this.active) return false
    this.closeActive()
    this.active = next
    this.activeOwner = owner ? { ...owner } : null
    return true
  }

  /** the database of the active bucket; null when SQLite cannot open */
  activeDb(): WorkbenchDb | null {
    if (this.db === undefined) {
      if (this.activeOwner) this.migrateLegacy(this.active, this.activeOwner)
      this.db = tryOpenWorkbenchDb(this.userDataDir, this.bucketDir(this.active))
    }
    return this.db
  }

  /** the active database, but only for the bucket a caller loaded from */
  dbFor(bucket: unknown): WorkbenchDb | null {
    if (typeof bucket !== 'string' || bucket !== this.active) return null
    return this.activeDb()
  }

  /** the renderer still has to move its pre-upgrade copies into this bucket */
  legacyPending(bucket: unknown = this.active): boolean {
    if (bucket !== this.active || this.active === LOCAL_BUCKET) return false
    // the move happens when the account's database first opens
    this.activeDb()
    const marker = this.readMarker()
    return marker !== null && marker.to === bucket && !marker.rendererDone
  }

  /** the renderer moved its pre-upgrade copies (only the bucket they went to counts) */
  markLegacyRendererDone(bucket: unknown): void {
    const marker = this.readMarker()
    if (!marker || marker.to !== bucket || bucket !== this.active || marker.rendererDone) return
    this.writeMarker({ ...marker, rendererDone: true })
  }

  close(): void {
    this.closeActive()
  }

  private closeActive(): void {
    this.db?.close()
    this.db = undefined
  }

  private bucketDir(bucket: string): string {
    return bucket === LOCAL_BUCKET
      ? join(this.root, LOCAL_BUCKET)
      : join(this.root, 'accounts', bucket)
  }

  private markerPath(): string {
    return join(this.root, 'legacy-migration.json')
  }

  private readMarker(): LegacyMarker | null {
    try {
      const raw = JSON.parse(readFileSync(this.markerPath(), 'utf8')) as Partial<LegacyMarker>
      if (raw?.version !== 1 || typeof raw.to !== 'string') return null
      return {
        version: 1,
        to: raw.to,
        movedAt: typeof raw.movedAt === 'string' ? raw.movedAt : '',
        rendererDone: raw.rendererDone === true,
      }
    } catch {
      return null
    }
  }

  private writeMarker(marker: LegacyMarker): void {
    mkdirSync(this.root, { recursive: true })
    writeFileSync(this.markerPath(), JSON.stringify(marker))
  }

  /**
   * One time, for the first account that signs in after the upgrade: the
   * shared pre-upgrade database is copied into its bucket and then deleted.
   * A failed copy leaves the shared file and the marker untouched, so the
   * next open tries again.
   */
  private migrateLegacy(bucket: string, owner: WorkbenchOwner): void {
    if (existsSync(this.markerPath())) return
    const legacyPath = join(this.root, 'workbench.sqlite')
    const hadLegacyData = existsSync(legacyPath)
    if (hadLegacyData) {
      const legacy = tryOpenWorkbenchDb(this.userDataDir, this.root)
      const target = legacy ? tryOpenWorkbenchDb(this.userDataDir, this.bucketDir(bucket)) : null
      if (!legacy || !target) {
        legacy?.close()
        target?.close()
        return
      }
      try {
        target.importKeys(legacy.loadAll())
      } catch (err) {
        console.error('[workbench] pre-upgrade data move failed', err)
        return
      } finally {
        legacy.close()
        target.close()
      }
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          this.unlink(`${legacyPath}${suffix}`)
        } catch (err) {
          // already gone is fine; anything else leaves the pre-upgrade file on disk, unreferenced
          if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            this.log(
              `[workbench] could not remove the pre-upgrade database file workbench.sqlite${suffix}: ${(err as Error)?.message ?? err}`,
            )
          }
        }
      }
    }
    this.writeMarker({
      version: 1,
      to: bucket,
      movedAt: this.now().toISOString(),
      rendererDone: false,
    })
    // a fresh install has nothing to move (the marker still records the first account)
    if (hadLegacyData)
      this.log(`[workbench] pre-upgrade My AI and workbench data moved to account ${owner.accountId}`)
  }
}
