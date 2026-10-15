import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SignOutPlan } from '../../shared/home-api'
import type { LastOwner } from './binding-store'

/**
 * The account boundary of UniWork documents on a shared computer. A working
 * copy lives under `<root>/<deploymentId>/<userId>/...`, so its path names
 * the account it belongs to. When the account goes away (an explicit Sign
 * out) or another one takes over (a sign-in as someone else), the documents
 * of the previous account are closed, the AI chat history of those documents
 * is deleted, so none of it is shown to the next person, and the S11 locks of
 * those working copies are forgotten. Local files outside the root are not
 * account data and are never touched. Electron-free: tabs, windows, the chat
 * store and the lock map come in through `deps` (see wiring.ts).
 */

/**
 * What a session lock settled to: `false` aborts a sign-out (a park was
 * refused and the folder kept); `{ lost }` counts the documents an account
 * switch could not keep (d5-1). `void` / `true` = locked, nothing lost.
 */
export type LockOutcome = boolean | void | { ok: boolean; lost?: number }

/** the options of a lock: `switch` = the other account is already live, no abort is possible */
export interface LockOptions {
  confirmed?: boolean
  prompt?: boolean
  switch?: boolean
}

export interface AccountBoundaryDeps {
  /** the working-copy root (BindingStore.root) */
  root: string
  /** every file path a tab or detached editor window shows */
  openPaths(): string[]
  /** the normal close of whatever shows `path`, prompts included; true = it closed */
  closeDocument(path: string): Promise<boolean>
  /** only the prompts of that close, nothing is closed; true = the user let it go ahead */
  confirmClose(path: string): Promise<boolean>
  /** closes whatever shows `path` with no prompt (its prompts were answered by confirmClose) */
  closeNow(path: string): void
  /** every file path the AI chat store keys a transcript or project entry on */
  aiHistoryPaths(): string[]
  /** deletes the AI transcripts and project entries of these paths for good */
  forgetAiHistory(paths: string[]): void
  /**
   * forgets the S11 locks of these paths (their folders are untouched). The
   * locks belong to the account that went away, so the next session is not
   * shown a panel for a working copy it cannot explain.
   */
  forgetLocks(match: (path: string) => boolean): void
  /** closes an open conflict dialog as "Decide later" before the documents close */
  closeConflictPrompt(): void
  /**
   * The owner of the live session (the account about to sign out), when there
   * is one. `lockStore` / `lockSession` falls back to the last owner `enforce` saw.
   */
  sessionOwner?(): LastOwner | null
  /**
   * G5-11: computes the sign-out plan for `owner` without changing anything.
   */
  planSignOut?(owner?: LastOwner | null): Promise<SignOutPlan>
  /**
   * Optional sign-out confirmation check (G5-11): runs before any document tab
   * or conflict prompt is closed. False = the user cancelled the sign-out.
   * Only asked before the account goes away (Sign out, a deployment switch that
   * signs out first); an account switch that is already effective never asks.
   */
  confirmSignOut?(
    owner: LastOwner | null,
    options?: { confirmed?: boolean; prompt?: boolean; plan?: SignOutPlan },
  ): Promise<boolean>
  /**
   * G5-11 (Q2 = a): an account switch that is already effective always locks
   * the account it leaves; when content of that account was lost (RAM-only
   * content, or N+1 the lock could not park, d5-1) the user is told so
   * afterwards, with `plan.ramOnly` carrying the count of both. Fire-and-forget:
   * the lock never waits on this notice.
   */
  noticeSwitchLoss?(owner: LastOwner, plan: SignOutPlan): void
  /**
   * G5-11: locks the session of `owner` (bounded receipt wait, N+1 capture into
   * `parked`, working/recovery copy cleanup, RAM cache clear, and store lock).
   */
  lockSession?(
    owner: LastOwner | null,
    onWaiting?: () => void,
    options?: LockOptions,
  ): Promise<LockOutcome>
  /**
   * Locks the durable store of the account that goes away (after parking any
   * N+1 working copies and deleting plaintext working/recovery copies). Runs
   * after `forgetLocks` and before `closeNow` so open editors can still flush
   * their capture save; returning `false` aborts the sign-out before tabs close.
   */
  lockStore?(owner: LastOwner | null, options?: LockOptions): Promise<LockOutcome>
}

/** the account a working-copy path belongs to; null outside the root */
export function workingCopyOwner(
  root: string,
  path: string,
): { deploymentId: string; userId: string } | 'unknown' | null {
  const rel = relative(resolve(root), resolve(path))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  const [deploymentId, userId] = rel.split(sep)
  // something under the root that is no account's copy (e.g. last-account.json)
  if (!deploymentId || !userId || rel.split(sep).length < 3) return 'unknown'
  return { deploymentId, userId }
}

/** one queued run: the owner and a promise that settles when that run ends (d6-4) */
interface Run {
  owner: LastOwner
  done: Promise<void>
  settle: { resolve(): void; reject(error: unknown): void }
}

function newRun(owner: LastOwner): Run {
  let settle!: Run['settle']
  const done = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject }
  })
  // d1-2: a run is observed from the moment it exists. Every caller that awaits
  // `run.done` still receives the rejection; this no-op handler only makes sure a
  // run whose push promise is dropped (or was never awaited) cannot turn a lock
  // failure into a process-level unhandled rejection.
  void done.catch(() => undefined)
  return { owner, done, settle }
}

/** `deploymentId/accountId`: one account's boundary key */
function ownerKey(owner: LastOwner): string {
  return `${owner.deploymentId}/${owner.accountId}`
}

export class AccountBoundary {
  private readonly deps: AccountBoundaryDeps
  /** `deploymentId/accountId` whose boundary is enforced; null = not yet, or signed out */
  private enforced: string | null = null
  /** the last live owner `enforce` saw (the account an account switch leaves) */
  private lastOwner: LastOwner | null = null
  /** the drain of `enforce` runs in progress (one at a time); null = idle. Never rejects. */
  private running: Promise<void> | null = null
  /** the run the drain is in right now; null = between runs */
  private current: Run | null = null
  /**
   * The runs status pushes asked for while a run was in progress, oldest
   * first. Each owner was live at its push (its store opened, its documents
   * editable), so each gets its own run: the run after it locks it (d6-1).
   * A repeat of the owner right before it joins that run; a repeat after
   * another owner is a new run on purpose (that owner was live in between and
   * must be locked by it), and it never re-locks anyone: each run locks only
   * the owner of the run before it.
   */
  private readonly queued: Run[] = []

  constructor(deps: AccountBoundaryDeps) {
    this.deps = deps
  }

  /** every working copy, whoever it belongs to */
  private readonly anyAccount = (path: string): boolean =>
    workingCopyOwner(this.deps.root, path) !== null

  /** a working copy of anyone but `owner` */
  private notOwnedBy(owner: LastOwner): (path: string) => boolean {
    return (path) => {
      const found = workingCopyOwner(this.deps.root, path)
      if (found === null) return false
      return (
        found === 'unknown' ||
        found.deploymentId !== owner.deploymentId ||
        found.userId !== owner.accountId
      )
    }
  }

  /** G5-11: computes what the sign-out prompt needs without changing anything. */
  async planSignOut(owner?: LastOwner | null): Promise<SignOutPlan> {
    const target = owner ?? this.deps.sessionOwner?.() ?? this.lastOwner
    if (this.deps.planSignOut) return this.deps.planSignOut(target)
    return { count: 0, waiting: 0, keystoreLocked: false, ramOnly: 0 }
  }

  /** G5-11: locks the session of `owner` without throwing or asking "discard". */
  async lockSession(owner: LastOwner | null, onWaiting?: () => void): Promise<void> {
    await this.lock(owner, undefined, onWaiting)
  }

  /**
   * Before an explicit Sign out: every document that is a working copy (of any
   * account) gets its close prompt, one at a time, and only when all of them
   * went ahead are the documents closed. False when the user cancelled a
   * prompt or when parking N+1 failed: the sign-out does not go ahead and no
   * document was closed.
   */
  async beforeSignOut(options?: { confirmed?: boolean; prompt?: boolean }): Promise<boolean> {
    await this.running?.catch(() => undefined)
    const owner = this.deps.sessionOwner?.() ?? this.lastOwner
    if (this.deps.planSignOut) {
      const plan = await this.deps.planSignOut(owner)
      if (plan.count > 0 || plan.ramOnly > 0) {
        if (options?.confirmed === true) {
          // already confirmed by the renderer prompt
        } else if (this.deps.confirmSignOut) {
          if (!(await this.deps.confirmSignOut(owner, { ...options, plan }))) return false
        } else {
          return false
        }
      }
    } else if (this.deps.confirmSignOut && !(await this.deps.confirmSignOut(owner, options))) {
      return false
    }
    this.deps.closeConflictPrompt()
    const paths = this.pathsWhere(this.anyAccount)
    for (const path of paths) if (!(await this.deps.confirmClose(path))) return false
    this.deps.forgetLocks(this.anyAccount)
    // the account is about to leave: capture N+1 from open tabs and lock its
    // durable store before the tabs close
    if (!(await this.lock(owner, options)).ok) return false
    // a prompt or capture may have taken a while: close what still shows a working copy
    for (const path of this.pathsWhere(this.anyAccount)) this.deps.closeNow(path)
    this.lastOwner = null
    return true
  }

  /** After an explicit Sign out: the AI history of every working copy is deleted. */
  afterSignOut(): void {
    this.enforced = null
    this.forgetWhere(this.anyAccount)
    this.deps.forgetLocks(this.anyAccount)
    // idempotent with beforeSignOut: whatever owner is left locks its store
    const owner = this.lastOwner
    this.lastOwner = null
    if (owner) void this.lock(owner)
  }

  /**
   * A live session of `owner` (every signed-in status push): once per account,
   * the documents of any other account are closed and their AI history is
   * deleted. The account that went away is always locked (no prompt can keep
   * it open: the switch already happened). When a close prompt was cancelled
   * the boundary stays unenforced, so the next status push asks again. Runs
   * never overlap: a push that arrives while one runs is queued (unless it
   * names the same owner as the run or push before it) and every queued owner
   * runs in order right after it, without waiting for another push, so an
   * owner that was live only between two pushes is still locked by the next
   * run. The call resolves once the run that covers its owner has ended (d6-4:
   * not the whole drain, so a push never waits for a later owner's lock) and
   * rejects with that run's own failure.
   */
  async enforce(owner: LastOwner): Promise<void> {
    const last = this.queued[this.queued.length - 1] ?? this.current
    let run = last
    if (!run || ownerKey(run.owner) !== ownerKey(owner)) {
      run = newRun(owner)
      this.queued.push(run)
    }
    if (!this.running) this.running = this.drain()
    await run.done
  }

  /** runs the queued owners one after another, oldest first, until none is left */
  private async drain(): Promise<void> {
    try {
      let next = this.queued.shift()
      while (next) {
        this.current = next
        try {
          await this.enforceOnce(next.owner)
          next.settle.resolve()
        } catch (error) {
          next.settle.reject(error)
        } finally {
          this.current = null
        }
        next = this.queued.shift()
      }
    } finally {
      // cleared in the same step that saw nothing queued, so a later push
      // always starts a new drain instead of joining one that has ended
      this.running = null
    }
  }

  private async enforceOnce(owner: LastOwner): Promise<void> {
    const key = ownerKey(owner)
    if (this.enforced === key) return
    const previous = this.lastOwner
    this.lastOwner = owner
    const foreign = this.notOwnedBy(owner)
    if (this.deps.openPaths().some(foreign)) this.deps.closeConflictPrompt()
    // the locks of the account that went away go first: they are panel state,
    // so they must not wait on a save prompt, and a renderer re-read on the
    // account change already sees them gone (F4 residual). They go even when a
    // prompt is cancelled: they are not this account's copies to explain.
    this.deps.forgetLocks(foreign)
    if (previous && ownerKey(previous) !== key) {
      // the other account is already live, so there is nothing left to cancel:
      // the switched-out account is locked exactly as on a confirmed sign-out
      // (N+1 parked, plaintext copies wiped, store locked). The plan is read
      // first, while the RAM-only content it counts still exists.
      const plan = this.deps.planSignOut
        ? await this.deps.planSignOut(previous).catch(() => null)
        : null
      // d5-1: the lock's own result counts what it could not keep (a refused
      // park); RAM-only content is counted by the plan
      const locked = await this.lock(previous, { switch: true })
      const ramOnly = plan?.ramOnly ?? 0
      // only lost content is worth a notice, and it comes after the lock so a
      // user who has not read it yet never keeps the old plaintext on disk
      if (ramOnly > 0 || locked.lost > 0) {
        const lostPlan: SignOutPlan = plan
          ? { ...plan, ramOnly: ramOnly + locked.lost }
          : { count: locked.lost, waiting: 0, keystoreLocked: false, ramOnly: locked.lost }
        try {
          this.deps.noticeSwitchLoss?.(previous, lostPlan)
        } catch {
          // a notice that cannot be shown changes nothing about the lock
        }
      }
    }
    const closed = await this.closeWhere(foreign)
    this.forgetWhere(foreign)
    if (closed) this.enforced = key
  }

  /**
   * Lock one account's durable store (and park any N+1 working copies). `ok` is
   * false only when `lockSession` / `lockStore` explicitly signals an abort (e.g.
   * park failure on explicit sign-out so plaintext working copies are not deleted);
   * `lost` counts the documents a switch could not keep.
   */
  private async lock(
    owner: LastOwner | null,
    options?: LockOptions,
    onWaiting?: () => void,
  ): Promise<{ ok: boolean; lost: number }> {
    try {
      const res = this.deps.lockSession
        ? await this.deps.lockSession(owner, onWaiting, options)
        : await this.deps.lockStore?.(owner, options)
      if (res && typeof res === 'object') return { ok: res.ok, lost: res.lost ?? 0 }
      return { ok: res !== false, lost: 0 }
    } catch {
      return { ok: true, lost: 0 }
    }
  }

  /** the open paths that match, each once */
  private pathsWhere(match: (path: string) => boolean): string[] {
    const seen = new Set<string>()
    const found: string[] = []
    for (const path of this.deps.openPaths()) {
      const key = resolve(path)
      if (seen.has(key) || !match(path)) continue
      seen.add(key)
      found.push(path)
    }
    return found
  }

  private async closeWhere(match: (path: string) => boolean): Promise<boolean> {
    let allClosed = true
    for (const path of this.pathsWhere(match)) {
      if (!(await this.deps.closeDocument(path))) allClosed = false
    }
    return allClosed
  }

  private forgetWhere(match: (path: string) => boolean): void {
    const paths = this.deps.aiHistoryPaths().filter(match)
    if (paths.length > 0) this.deps.forgetAiHistory(paths)
  }
}
