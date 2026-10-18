import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { EditLockSession, type EditLockTransport } from '../src/main/uniwork-edit-lock/session'
import type {
  EditLockHeartbeat,
  EditLockState,
  EditLockTenure,
} from '../src/main/uniwork-edit-lock/client'

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const LOCK = '01J8X4LOCK0N1P2Q3R4S5T6U7V'
const EDITOR = '01J8X4ED1T0R0000000000000A'

const TENURE: EditLockTenure = {
  lockId: LOCK,
  documentId: DOC,
  holderId: 'u1',
  client: 'desktop',
  acquiredAt: '2026-10-15T03:12:00Z',
  expiresAt: '2026-10-15T03:14:00Z',
  heartbeatIntervalMs: 30_000,
  ttlMs: 120_000,
  serverTime: '2026-10-15T03:12:00Z',
}

function locked(heldByMe: boolean, holderName = 'Lan'): UniworkDocError {
  return new UniworkDocError('edit_locked', {
    status: 423,
    serverCode: 'document_locked',
    editLock: {
      holderName,
      since: '2026-10-15T03:12:00Z',
      expiresAt: '2026-10-15T03:14:00Z',
      heldByMe,
    },
  })
}

function lost(reason: string, byName?: string): UniworkDocError {
  return new UniworkDocError('server_error', {
    status: 409,
    serverCode: 'edit_lock_lost',
    lostReason: reason as UniworkDocError['lostReason'],
    byName: byName ?? null,
  })
}

function transport(overrides: Partial<EditLockTransport> = {}): EditLockTransport & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    async getState() {
      calls.push('R1')
      return { lock: null, serverTime: 't' } satisfies EditLockState
    },
    async acquire() {
      calls.push('R2')
      return TENURE
    },
    async heartbeat() {
      calls.push('R3')
      return {
        lockId: LOCK,
        expiresAt: '2026-10-15T03:16:00Z',
        serverTime: 't',
      } satisfies EditLockHeartbeat
    },
    async release() {
      calls.push('R4')
    },
    ...overrides,
  }
}

describe('EditLockSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T03:12:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function session(t: EditLockTransport, extras: { sleepMs?: number } = {}) {
    return new EditLockSession({
      documentId: DOC,
      path: '/tmp/doc.docx',
      editorId: EDITOR,
      transport: t,
      clock: { now: () => Date.now() },
      sleep: async (ms) => {
        await vi.advanceTimersByTimeAsync(ms)
      },
      ...extras,
    })
  }

  it('acquire 201 -> held and starts heartbeat on heartbeat_interval_ms', async () => {
    const t = transport()
    const s = session(t)
    await s.acquire()
    expect(s.view()).toMatchObject({ phase: 'held' })
    expect(s.lockId()).toBe(LOCK)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(t.calls.filter((c) => c === 'R3')).toEqual(['R3'])
    s.dispose()
  })

  it('acquire 200 is held (idempotent)', async () => {
    const t = transport()
    const s = session(t)
    await s.acquire()
    expect(s.view().phase).toBe('held')
    s.dispose()
  })

  it('acquire 423 held_by_me=false -> other (no retry)', async () => {
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        throw locked(false)
      },
    })
    const s = session(t)
    await s.acquire()
    expect(s.view()).toMatchObject({
      phase: 'other',
      holderName: 'Lan',
      since: '2026-10-15T03:12:00Z',
    })
    expect(t.calls.filter((c) => c === 'R2')).toHaveLength(1)
    s.dispose()
  })

  it('acquire 423 held_by_me=true retries once after a short wait; still held -> self_elsewhere', async () => {
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        throw locked(true)
      },
    })
    const s = session(t)
    const done = s.acquire()
    await vi.advanceTimersByTimeAsync(300)
    await done
    expect(s.view().phase).toBe('self_elsewhere')
    expect(t.calls.filter((c) => c === 'R2')).toHaveLength(2)
    s.dispose()
  })

  it('acquire 423 held_by_me=true then 201 on the retry -> held', async () => {
    let n = 0
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        n += 1
        if (n === 1) throw locked(true)
        return TENURE
      },
    })
    const s = session(t)
    const done = s.acquire()
    await vi.advanceTimersByTimeAsync(300)
    await done
    expect(s.view().phase).toBe('held')
    expect(s.lockId()).toBe(LOCK)
    s.dispose()
  })

  it('acquire 403 stays without a session (phase none via dispose)', async () => {
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        throw new UniworkDocError('forbidden', { status: 403, serverCode: 'forbidden' })
      },
    })
    const s = session(t)
    await s.acquire()
    expect(s.view().phase).toBe('none')
    expect(s.lockId()).toBeNull()
    s.dispose()
  })

  it('TTL deadline without a good beat -> lost expired; stops beating', async () => {
    const t = transport({
      async heartbeat() {
        t.calls.push('R3')
        // hang: never resolve, so no good beat
        return new Promise<EditLockHeartbeat>(() => undefined)
      },
    })
    const s = session(t)
    await s.acquire()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(s.view()).toMatchObject({ phase: 'lost', lostReason: 'expired' })
    const beats = t.calls.filter((c) => c === 'R3').length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.calls.filter((c) => c === 'R3')).toHaveLength(beats)
    s.dispose()
  })

  it('409 edit_lock_lost on a beat -> lost with reason and by_name; no auto re-acquire', async () => {
    const t = transport({
      async heartbeat() {
        t.calls.push('R3')
        throw lost('taken_over', 'Minh')
      },
    })
    const s = session(t)
    await s.acquire()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.view()).toMatchObject({
      phase: 'lost',
      lostReason: 'taken_over',
      byName: 'Minh',
    })
    const r2 = t.calls.filter((c) => c === 'R2').length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.calls.filter((c) => c === 'R2')).toHaveLength(r2)
    s.dispose()
  })

  it.each([
    'released',
    'expired',
    'taken_over',
    'handed_over',
    'access_lost',
    'document_archived',
    'moved_here',
  ] as const)('409 reason %s is kept', async (reason) => {
    const t = transport({
      async heartbeat() {
        t.calls.push('R3')
        throw lost(reason)
      },
    })
    const s = session(t)
    await s.acquire()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.view().lostReason).toBe(reason)
    s.dispose()
  })

  it('wake() (resume / network back) beats at once while held', async () => {
    const t = transport()
    const s = session(t)
    await s.acquire()
    expect(t.calls.filter((c) => c === 'R3')).toHaveLength(0)
    await s.wake()
    expect(t.calls.filter((c) => c === 'R3')).toEqual(['R3'])
    s.dispose()
  })

  it('polls R1 every 30 s only while other; free -> free; no poll in held', async () => {
    let state: EditLockState = {
      lock: {
        holderName: 'Lan',
        since: '2026-10-15T03:12:00Z',
        expiresAt: '2026-10-15T03:14:00Z',
        heldByMe: false,
      },
      serverTime: 't',
    }
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        throw locked(false)
      },
      async getState() {
        t.calls.push('R1')
        return state
      },
    })
    const s = session(t)
    await s.acquire()
    expect(s.view().phase).toBe('other')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(t.calls.filter((c) => c === 'R1')).toHaveLength(1)
    state = { lock: null, serverTime: 't' }
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.view().phase).toBe('free')
    const r1 = t.calls.filter((c) => c === 'R1').length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.calls.filter((c) => c === 'R1')).toHaveLength(r1)

    const held = transport()
    const h = session(held)
    await h.acquire()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(held.calls.filter((c) => c === 'R1')).toHaveLength(0)
    h.dispose()
    s.dispose()
  })

  it('does not poll while offline or signed out', async () => {
    let online = true
    let signedIn = true
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        throw locked(false)
      },
    })
    const s = new EditLockSession({
      documentId: DOC,
      path: '/tmp/doc.docx',
      editorId: EDITOR,
      transport: t,
      clock: { now: () => Date.now() },
      isOnline: () => online,
      isSignedIn: () => signedIn,
    })
    await s.acquire()
    online = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(t.calls.filter((c) => c === 'R1')).toHaveLength(0)
    online = true
    signedIn = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(t.calls.filter((c) => c === 'R1')).toHaveLength(0)
    s.dispose()
  })

  it('release sends R4 while held; swallows errors; never releases on lost', async () => {
    const t = transport()
    const s = session(t)
    await s.acquire()
    await s.release()
    expect(t.calls.filter((c) => c === 'R4')).toEqual(['R4'])

    const failing = transport({
      async release() {
        failing.calls.push('R4')
        throw new UniworkDocError('network')
      },
    })
    const s2 = session(failing)
    await s2.acquire()
    await s2.release()
    expect(failing.calls.filter((c) => c === 'R4')).toEqual(['R4'])

    const lostT = transport({
      async heartbeat() {
        lostT.calls.push('R3')
        throw lost('expired')
      },
    })
    const s3 = session(lostT)
    await s3.acquire()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s3.view().phase).toBe('lost')
    await s3.release()
    expect(lostT.calls.filter((c) => c === 'R4')).toHaveLength(0)
    s.dispose()
    s2.dispose()
    s3.dispose()
  })

  it('editHere from other/free/lost is R2; from self_elsewhere is move_from_self', async () => {
    const bodies: Array<boolean | undefined> = []
    const t = transport({
      async acquire(_input, moveFromSelf) {
        t.calls.push('R2')
        bodies.push(moveFromSelf)
        if (bodies.length === 1) throw locked(false)
        return TENURE
      },
    })
    const s = session(t)
    await s.acquire()
    expect(s.view().phase).toBe('other')
    await s.editHere()
    expect(s.view().phase).toBe('held')
    expect(bodies[1]).toBeFalsy()

    let n = 0
    const self = transport({
      async acquire(_input, moveFromSelf) {
        self.calls.push('R2')
        n += 1
        if (n <= 2) throw locked(true)
        expect(moveFromSelf).toBe(true)
        return TENURE
      },
    })
    const s2 = session(self)
    const first = s2.acquire()
    await vi.advanceTimersByTimeAsync(300)
    await first
    expect(s2.view().phase).toBe('self_elsewhere')
    const move = s2.editHere()
    await vi.advanceTimersByTimeAsync(300)
    await move
    expect(s2.view().phase).toBe('held')
    s.dispose()
    s2.dispose()
  })

  it('Q2: acquire network failure -> unreachable; document stays editable (no lock id)', async () => {
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        throw new UniworkDocError('network')
      },
    })
    const s = session(t)
    await s.acquire()
    expect(s.view().phase).toBe('unreachable')
    expect(s.lockId()).toBeNull()
    expect(s.isEditable()).toBe(true)
    s.dispose()
  })

  it('Q2: reconnect acquires before the first commit (R2 before versions/commit)', async () => {
    const order: string[] = []
    let fail = true
    const t = transport({
      async acquire() {
        order.push('R2')
        if (fail) throw new UniworkDocError('timeout')
        return TENURE
      },
    })
    const s = session(t)
    await s.acquire()
    expect(s.view().phase).toBe('unreachable')
    fail = false
    await s.ensureHeldBeforeCommit()
    order.push('commit')
    expect(order).toEqual(['R2', 'R2', 'commit'])
    expect(s.view().phase).toBe('held')
    expect(s.lockId()).toBe(LOCK)
    s.dispose()
  })

  it('Q2: 423 on reconnect acquire parks (other) and sends no commit lock id', async () => {
    let fail = true
    const t = transport({
      async acquire() {
        t.calls.push('R2')
        if (fail) throw new UniworkDocError('network')
        throw locked(false, 'Lan')
      },
    })
    const s = session(t)
    await s.acquire()
    fail = false
    const ready = await s.ensureHeldBeforeCommit()
    expect(ready).toBe('park')
    expect(s.view().phase).toBe('other')
    expect(s.lockId()).toBeNull()
    s.dispose()
  })
})
