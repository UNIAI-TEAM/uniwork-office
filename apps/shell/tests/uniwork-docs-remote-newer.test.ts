import { describe, expect, it } from 'vitest'
import {
  decideRemote,
  type RemoteLocal,
  type RemoteNotice,
} from '../src/main/uniwork-docs/remote-newer'

/**
 * G5-03a: the pure "server has a newer version" decision. One test per row of
 * the rule order in the plan (first match wins), plus the revision comparisons
 * that must go through BigInt ('10' is newer than '9') and the malformed
 * cases the feed must never act on.
 */

const notice = (over: Partial<RemoteNotice> = {}): RemoteNotice => ({
  documentId: 'doc_1',
  revision: '10',
  version: 3,
  versionId: 'ver_3',
  ...over,
})

const local = (over: Partial<RemoteLocal> = {}): RemoteLocal => ({
  documentId: 'doc_1',
  baseRevision: '9',
  feedOn: true,
  dirty: false,
  aiRunning: false,
  queue: null,
  ownEcho: new Set<string>(),
  locked: null,
  ...over,
})

describe('decideRemote — rule order', () => {
  it('ignores a malformed revision before anything else', () => {
    for (const revision of ['09x', '-1', '1e3', '', '1.0']) {
      expect(decideRemote(notice({ revision }), local())).toEqual({
        kind: 'ignore',
        reason: 'malformed',
      })
    }
    // a leading zero is inside the wire form; it is not newer, not malformed
    expect(decideRemote(notice({ revision: '09' }), local({ baseRevision: '9' }))).toEqual({
      kind: 'ignore',
      reason: 'not-newer',
    })
    // 19 digits is the widest the wire form allows; 09x is malformed, not newer
    expect(decideRemote(notice({ revision: '9223372036854775807' }), local())).toEqual({
      kind: 'reload',
    })
  })

  it('ignores a notice for another document', () => {
    expect(decideRemote(notice({ documentId: 'doc_2' }), local())).toEqual({
      kind: 'ignore',
      reason: 'other-doc',
    })
  })

  it('ignores every notice while the feed is off (capability sync_feed)', () => {
    expect(decideRemote(notice(), local({ feedOn: false }))).toEqual({
      kind: 'ignore',
      reason: 'feed-off',
    })
  })

  it('ignores a notice for a locked document (revoked or deleted)', () => {
    expect(decideRemote(notice(), local({ locked: 'revoked' }))).toEqual({
      kind: 'ignore',
      reason: 'locked',
    })
    expect(decideRemote(notice(), local({ locked: 'deleted' }))).toEqual({
      kind: 'ignore',
      reason: 'locked',
    })
  })

  it("'10' is newer than '9' (BigInt), '9223372036854775807' newer than '9223372036854775806'", () => {
    expect(decideRemote(notice({ revision: '10' }), local({ baseRevision: '9' }))).toEqual({
      kind: 'reload',
    })
    expect(
      decideRemote(
        notice({ revision: '9223372036854775807' }),
        local({ baseRevision: '9223372036854775806' }),
      ),
    ).toEqual({ kind: 'reload' })
    // the same width, single-digit difference: never lexicographic
    expect(decideRemote(notice({ revision: '100' }), local({ baseRevision: '99' }))).toEqual({
      kind: 'reload',
    })
  })

  it('ignores a notice that is not newer than the base (equal or lower)', () => {
    expect(decideRemote(notice({ revision: '9' }), local({ baseRevision: '9' }))).toEqual({
      kind: 'ignore',
      reason: 'not-newer',
    })
    expect(decideRemote(notice({ revision: '8' }), local({ baseRevision: '9' }))).toEqual({
      kind: 'ignore',
      reason: 'not-newer',
    })
  })

  it('ignores the echo of this app’s own commit (receipt revision / selfRenamed)', () => {
    expect(decideRemote(notice({ revision: '10' }), local({ ownEcho: new Set(['10']) }))).toEqual({
      kind: 'ignore',
      reason: 'own-echo',
    })
    expect(decideRemote(notice({ revision: '10' }), local({ receiptRevision: '10' }))).toEqual({
      kind: 'ignore',
      reason: 'own-echo',
    })
  })
})

describe('decideRemote — queue, editor and AI rows', () => {
  it('holds while an intent is validating, uploading or committing', () => {
    for (const queue of ['validating', 'uploading', 'committing'] as const) {
      expect(decideRemote(notice(), local({ queue }))).toEqual({ kind: 'hold' })
    }
  })

  it('reconciling → bar newer-dirty wait commit; reconciling-stuck → wait stuck', () => {
    expect(decideRemote(notice(), local({ queue: 'reconciling' }))).toEqual({
      kind: 'bar',
      bar: { kind: 'newer-dirty', version: 3, wait: 'commit' },
    })
    expect(decideRemote(notice(), local({ queue: 'reconciling-stuck' }))).toEqual({
      kind: 'bar',
      bar: { kind: 'newer-dirty', version: 3, wait: 'stuck' },
    })
  })

  it('any other live queue state → bar newer-dirty without a wait reason', () => {
    for (const queue of [
      'queued',
      'paused_offline',
      'paused_user',
      'paused_admin',
      'conflict',
      'blocked',
      'failed',
    ] as const) {
      expect(decideRemote(notice(), local({ queue }))).toEqual({
        kind: 'bar',
        bar: { kind: 'newer-dirty', version: 3 },
      })
    }
  })

  it('a terminal record (committed/cancelled) counts as no intent', () => {
    expect(decideRemote(notice(), local({ queue: 'committed' }))).toEqual({ kind: 'reload' })
    expect(decideRemote(notice(), local({ queue: 'cancelled' }))).toEqual({ kind: 'reload' })
  })

  it('a dirty working copy → bar newer-dirty, never reload', () => {
    expect(decideRemote(notice(), local({ dirty: true }))).toEqual({
      kind: 'bar',
      bar: { kind: 'newer-dirty', version: 3 },
    })
  })

  it('dirty wins over a running AI turn (the bar says dirty)', () => {
    expect(decideRemote(notice(), local({ dirty: true, aiRunning: true }))).toEqual({
      kind: 'bar',
      bar: { kind: 'newer-dirty', version: 3 },
    })
  })

  it('aiRunning → bar newer-ai, never reload', () => {
    expect(decideRemote(notice(), local({ aiRunning: true }))).toEqual({
      kind: 'bar',
      bar: { kind: 'newer-ai', version: 3 },
    })
  })

  it('a clean, idle, intent-free copy reloads', () => {
    expect(decideRemote(notice(), local())).toEqual({ kind: 'reload' })
  })

  it('carries the notice version into every bar', () => {
    expect(decideRemote(notice({ version: 42 }), local({ aiRunning: true }))).toEqual({
      kind: 'bar',
      bar: { kind: 'newer-ai', version: 42 },
    })
  })
})
