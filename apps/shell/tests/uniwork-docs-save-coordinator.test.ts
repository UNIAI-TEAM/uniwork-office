import { describe, it } from 'vitest'

/**
 * G5-06 durable save queue (W4a): the QueueDispatcher + the Ctrl/Cmd+S
 * save-coordinator front, on fakes only (clock, random, server with lookup,
 * store, lock, capability). One named case per card Test line (plan card
 * G5-06, docs/superpowers/plans/2026-10-12-office-g5-g6-g7.md l.541-552).
 *
 * Skeleton first (it.todo), implementation follows; the 409-keeps-intent and
 * capability_off-keeps-intent cases are the red-before pair that must fail on
 * the pre-W4a save-coordinator.
 */

describe('G5-06 W4a save queue (fakes)', () => {
  it.todo('crash at each step, timeout after commit, cancel race')
  it.todo('one receipt/version: a replayed intent commits exactly one version')
  it.todo('a migrated intent replays exactly once, with its own key')
  it.todo('409 -> conflict with the same intent id, durable across a restart')
  it.todo('expired upload -> reconciling, exactly one lookup, no byte re-upload')
  it.todo('lookup unknown -> reconciling-stuck, no new attempt, "check again" only looks up')
  it.todo('lookup 401 / 403 by code / 410 -> the right reason')
  it.todo('N+1 stays dirty behind the pending intent')
  it.todo('two windows on one Document -> the second is read-only')
  it.todo('lock holder crash -> the other window acquires after goneMs')
  it.todo('stalled holder resumes after hand-off -> read-only, no write')
  it.todo('sync_write off / office_capability_off -> paused_admin, no new request, queue kept')
  it.todo('flag off during uploading -> stop before commit, same intent paused_admin, no request after')
  it.todo('two orgs with different sync_write -> each intent follows its org')
  it.todo('offline 2 h (past capability TTL) -> Ctrl/Cmd+S -> paused_offline, not paused_admin')
  it.todo('keystore_locked / store_full -> refused with a reason, no intent')
  it.todo('cancel when the document is closed -> the snapshot becomes a kept draft')
  it.todo('cancel or discard at 3 drafts or a full store -> refused, intent kept')
  it.todo('user pause + offline -> online -> paused_user, no dispatch')
  it.todo('the store locks while reconciling -> unlock -> still reconciling')
  it.todo('"Luu lai" on failed -> the old intent is superseded before the new one')
  it.todo('a tombstone stops replay')
  it.todo('queue/budget limit -> refused with a code')
  it.todo('startup does not read the drafts folder')
  it.todo('store compliance stays green')
})
