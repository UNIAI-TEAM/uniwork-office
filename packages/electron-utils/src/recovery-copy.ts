import { statSync } from 'node:fs'
import { resolve } from 'node:path'

/** mtime of `copyPath` when it is newer than `filePath`, else null (either missing included); read-only */
export function newerCopyMtime(copyPath: string, filePath: string): number | null {
  try {
    const at = statSync(copyPath).mtimeMs
    return at > statSync(filePath).mtimeMs ? at : null
  } catch {
    return null
  }
}

/**
 * The key a recovery copy's clear epoch is kept under: the absolute path with
 * separators normalized and, for a drive-letter path, letter case ignored, so
 * the shell's sweep and the renderer's write reach the same entry however each
 * spelled the path.
 */
export function recoveryEpochKey(path: string): string {
  const slashed = resolve(path).replace(/\\/g, '/')
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed
}

/** one in-flight recovery write, from `RecoveryClearEpochs.begin` */
export interface RecoveryWriteTicket {
  readonly key: string
  readonly epoch: number
}

/**
 * Clear epochs for recovery copies (stale-recovery race): a write that started
 * before a clear of the same path must not leave the file it lands behind.
 * `begin` snapshots before the write's first await, `cleared` asks after it,
 * `end` releases the ticket. An entry exists only while a write is in flight,
 * so the map is bounded by the writes running now and a clear with nothing in
 * flight records nothing (a later write starts from a fresh snapshot anyway).
 */
export class RecoveryClearEpochs {
  private readonly entries = new Map<string, { epoch: number; inflight: number }>()

  begin(path: string): RecoveryWriteTicket {
    const key = recoveryEpochKey(path)
    const entry = this.entries.get(key) ?? { epoch: 0, inflight: 0 }
    entry.inflight += 1
    this.entries.set(key, entry)
    return { key, epoch: entry.epoch }
  }

  /** true when a clear of the ticket's path ran since `begin` */
  cleared(ticket: RecoveryWriteTicket): boolean {
    return (this.entries.get(ticket.key)?.epoch ?? ticket.epoch) !== ticket.epoch
  }

  end(ticket: RecoveryWriteTicket): void {
    const entry = this.entries.get(ticket.key)
    if (!entry) return
    entry.inflight -= 1
    if (entry.inflight <= 0) this.entries.delete(ticket.key)
  }

  /** invalidates every write in flight for `path`; nothing is kept when none is */
  bump(path: string): void {
    const entry = this.entries.get(recoveryEpochKey(path))
    if (entry) entry.epoch += 1
  }

  /** entries held right now (tests) */
  get size(): number {
    return this.entries.size
  }
}
