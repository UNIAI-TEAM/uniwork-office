import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { LastOwner } from './binding-store'

/**
 * The account boundary of UniWork documents on a shared computer. A working
 * copy lives under `<root>/<deploymentId>/<userId>/...`, so its path names
 * the account it belongs to. When the account goes away (an explicit Sign
 * out) or another one takes over (a sign-in as someone else), the documents
 * of the previous account are closed through the normal close (the module's
 * unsaved-changes prompt, then the UniWork prompt: the working copy stays on
 * this computer as the draft that reopening restores), and the AI chat
 * history of those documents is deleted, so none of it is shown to the next
 * person. Local files outside the root are not account data and are never
 * touched. Electron-free: tabs, windows and the chat store come in through
 * `deps` (see wiring.ts).
 */

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
  /** closes an open conflict dialog as "Decide later" before the documents close */
  closeConflictPrompt(): void
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

export class AccountBoundary {
  private readonly deps: AccountBoundaryDeps
  /** `deploymentId/accountId` whose boundary is enforced; null = not yet, or signed out */
  private enforced: string | null = null
  private running: Promise<unknown> | null = null

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

  /**
   * Before an explicit Sign out: every document that is a working copy (of any
   * account) gets its close prompt, one at a time, and only when all of them
   * went ahead are the documents closed. False when the user cancelled a
   * prompt: the sign-out does not go ahead and no document was closed.
   */
  async beforeSignOut(): Promise<boolean> {
    await this.running?.catch(() => undefined)
    this.deps.closeConflictPrompt()
    const paths = this.pathsWhere(this.anyAccount)
    for (const path of paths) if (!(await this.deps.confirmClose(path))) return false
    // a prompt may have taken a while: close what still shows a working copy
    for (const path of this.pathsWhere(this.anyAccount)) this.deps.closeNow(path)
    return true
  }

  /** After an explicit Sign out: the AI history of every working copy is deleted. */
  afterSignOut(): void {
    this.enforced = null
    this.forgetWhere(this.anyAccount)
  }

  /**
   * A live session of `owner` (every signed-in status push): once per account,
   * the documents of any other account are closed and their AI history is
   * deleted. When a prompt was cancelled the boundary stays unenforced, so the
   * next status push asks again; a run in progress is not started twice.
   */
  async enforce(owner: LastOwner): Promise<void> {
    const key = `${owner.deploymentId}/${owner.accountId}`
    if (this.enforced === key || this.running) return
    const run = (async () => {
      const foreign = this.notOwnedBy(owner)
      if (this.deps.openPaths().some(foreign)) this.deps.closeConflictPrompt()
      const closed = await this.closeWhere(foreign)
      this.forgetWhere(foreign)
      if (closed) this.enforced = key
    })()
    this.running = run
    try {
      await run
    } finally {
      if (this.running === run) this.running = null
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
