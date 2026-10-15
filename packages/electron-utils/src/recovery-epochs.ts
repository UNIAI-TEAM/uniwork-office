// Pure string work, no node:* imports: the sheets web frame bundles this through its recovery policy.
/**
 * The key a recovery copy's clear epoch is kept under: the path with
 * separators and dot segments normalized and, for a drive-letter path, letter case ignored, so
 * the shell's sweep and the renderer's write reach the same entry however each
 * spelled the path.
 */
export function recoveryEpochKey(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const out: string[] = []
  for (const part of slashed.split('/')) {
    if (part === '.') continue
    if (part === '..') {
      // never climbs above the root or a drive
      if (out.length > 1) out.pop()
      continue
    }
    // an empty part is a repeated separator, kept only as the leading root
    if (part === '' && out.length > 0) continue
    out.push(part)
  }
  const key = out.join('/')
  return /^[a-z]:\//i.test(key) ? key.toLowerCase() : key
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
