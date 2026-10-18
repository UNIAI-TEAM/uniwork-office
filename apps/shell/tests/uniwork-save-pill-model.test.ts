import { describe, expect, it } from 'vitest'
import type { UniworkDocErrorCode, UniworkDocStatus } from '../src/shared/home-api'
import {
  FOCUS_TIP_MIN_PX,
  UNIWORK_ERROR_KEYS,
  chipCopy,
  chipModelOf,
  focusTipRoomOf,
  miniGlyphOf,
  type ChipModel,
} from '../src/renderer/src/uniwork-docs-model'
import { formatQueueTime } from '../src/renderer/src/queue-popover-model'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import type { StringKey, TFunc } from '../src/renderer/src/locale'

/**
 * G5-06u contract §2: the Save pill state table (T1) and its priority order (T2).
 * One row per spine state; "first match wins".
 */

const copy = {
  ...accountStrings.en,
  ...syncStrings.en,
  ...uniworkDocumentStrings.en,
} as Record<string, string>
const t: TFunc = (key: StringKey, params) =>
  (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

function status(partial: Partial<UniworkDocStatus> = {}): UniworkDocStatus {
  return {
    path: 'C:\\data\\uniwork-documents\\d1\\Plan.docx',
    documentId: 'd1',
    workspaceId: 'w1',
    title: 'Plan',
    format: 'docx',
    access: 'edit',
    state: 'saved',
    ...partial,
  }
}

const chip = (
  s: Partial<UniworkDocStatus>,
  ctx = { needsSignIn: true } as {
    needsSignIn: boolean
    queuedAt?: string
  },
): ChipModel => chipModelOf(status(s), ctx)

const newerDirty = { kind: 'newer-dirty', version: 4 } as const

type Row = {
  name: string
  input: Partial<UniworkDocStatus>
  label: StringKey
  tone: ChipModel['tone']
  /** [kind, labelKey] or undefined for "no button" */
  action?: [string, StringKey]
  tip: StringKey
}

describe('T1: Save pill state table', () => {
  const rows: Row[] = [
    {
      name: '1 blocked (forbidden)',
      input: { state: 'blocked', error: 'forbidden' },
      label: 'uwChipBlocked',
      tone: 'error',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipBlocked',
    },
    {
      name: '1 blocked (session_expired -> sign in again)',
      input: { state: 'blocked', error: 'session_expired' },
      label: 'uwChipBlocked',
      tone: 'error',
      action: ['sign-in', 'uwActSignInAgain'],
      tip: 'uwTipBlocked',
    },
    {
      name: '1 blocked (not_signed_in -> sign in)',
      input: { state: 'blocked', error: 'not_signed_in' },
      label: 'uwChipBlocked',
      tone: 'error',
      action: ['sign-in', 'acctSignIn'],
      tip: 'uwTipBlocked',
    },
    {
      name: '1 error + keystore_locked reads blocked',
      input: { state: 'error', error: 'keystore_locked' },
      label: 'uwChipBlocked',
      tone: 'error',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipBlocked',
    },
    {
      name: '1 error + store_full reads blocked',
      input: { state: 'error', error: 'store_full' },
      label: 'uwChipBlocked',
      tone: 'error',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipBlocked',
    },
    {
      name: '2 signed-out (account signed out)',
      input: { state: 'signed-out' },
      label: 'uwChipSignedOut',
      tone: 'error',
      action: ['sign-in', 'acctSignIn'],
      tip: 'uwTipSignedOut',
    },
    {
      name: '3 failed',
      input: { state: 'failed', error: 'too_large' },
      label: 'uwChipError',
      tone: 'error',
      action: ['details', 'uwActDetails'],
      tip: 'uwTipFailed',
    },
    {
      name: '4 error (other code)',
      input: { state: 'error', error: 'network' },
      label: 'uwChipError',
      tone: 'error',
      action: ['retry', 'uwActRetry'],
      tip: 'uwTipError',
    },
    {
      name: '5 conflict',
      input: { state: 'conflict' },
      label: 'uwChipConflict',
      tone: 'warn',
      action: ['resolve', 'uwActResolve'],
      tip: 'uwTipConflict',
    },
    {
      name: '6 reconciling-stuck',
      input: { state: 'reconciling-stuck' },
      label: 'uwChipReconcileStuck',
      tone: 'warn',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipReconciling',
    },
    {
      name: '7 reconciling',
      input: { state: 'reconciling' },
      label: 'uwChipReconciling',
      tone: 'warn',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipReconciling',
    },
    {
      name: '8 remote-newer (newer-dirty)',
      input: { state: 'dirty', remote: newerDirty },
      label: 'uwChipRemoteNewer',
      tone: 'warn',
      action: ['reload', 'uwActResolve'],
      tip: 'uwTipRemoteNewer',
    },
    {
      name: '8 remote-newer (newer-dirty with a save in flight: no button)',
      input: { state: 'dirty', remote: { ...newerDirty, wait: 'commit' } },
      label: 'uwChipRemoteNewer',
      tone: 'warn',
      tip: 'uwTipRemoteNewer',
    },
    {
      name: '8 remote-newer (newer-ai: no button)',
      input: { state: 'dirty', remote: { kind: 'newer-ai', version: 4 } },
      label: 'uwChipRemoteNewer',
      tone: 'warn',
      tip: 'uwTipRemoteNewer',
    },
    {
      name: '9 paused_admin',
      input: { state: 'paused_admin' },
      label: 'uwChipPausedAdmin',
      tone: 'neutral',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipPausedAdmin',
    },
    {
      name: '10 waiting for AI',
      input: { state: 'dirty', saveWait: 'ai' },
      label: 'uwChipSaving',
      tone: 'busy',
      tip: 'uwTipWaitAi',
    },
    {
      name: '10 waiting for AI, long (Stop AI)',
      input: { state: 'dirty', saveWait: 'ai-long' },
      label: 'uwChipSaving',
      tone: 'busy',
      action: ['stop-ai', 'uwActStopAi'],
      tip: 'uwTipWaitAiLong',
    },
    {
      name: '11 saving',
      input: { state: 'saving' },
      label: 'uwChipSaving',
      tone: 'busy',
      tip: 'uwTipSaving',
    },
    {
      name: '12 paused_user',
      input: { state: 'paused_user' },
      label: 'uwChipQueued',
      tone: 'info',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipPausedUser',
    },
    {
      name: '12 paused_user + N+1',
      input: { state: 'paused_user', pendingNext: true },
      label: 'uwChipQueuedNewer',
      tone: 'info',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipPausedUser',
    },
    {
      name: '13 queued',
      input: { state: 'queued' },
      label: 'uwChipQueued',
      tone: 'info',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipQueued',
    },
    {
      name: '13 paused_offline',
      input: { state: 'paused_offline' },
      label: 'uwChipQueued',
      tone: 'info',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipQueued',
    },
    {
      name: '13b queued + N+1',
      input: { state: 'queued', pendingNext: true },
      label: 'uwChipQueuedNewer',
      tone: 'info',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipQueuedNewer',
    },
    {
      name: '13b paused_offline + N+1',
      input: { state: 'paused_offline', pendingNext: true },
      label: 'uwChipQueuedNewer',
      tone: 'info',
      action: ['view-queue', 'uwActViewQueue'],
      tip: 'uwTipQueuedNewer',
    },
    {
      name: '14 view-only (saved)',
      input: { access: 'view', state: 'saved' },
      label: 'uwChipViewOnly',
      tone: 'neutral',
      tip: 'uwTipViewOnly',
    },
    {
      name: '14 view-only (dirty)',
      input: { access: 'view', state: 'dirty' },
      label: 'uwChipViewOnly',
      tone: 'neutral',
      tip: 'uwTipViewOnly',
    },
    {
      name: '15 offline',
      input: { state: 'offline' },
      label: 'uwChipOffline',
      tone: 'neutral',
      action: ['retry', 'uwActRetry'],
      tip: 'uwTipOffline',
    },
    {
      name: '15 unreachable (server-side error)',
      input: { state: 'offline', error: 'server_error' },
      label: 'uwChipUnreachable',
      tone: 'neutral',
      action: ['retry', 'uwActRetry'],
      tip: 'uwTipUnreachable',
    },
    {
      name: '16 dirty',
      input: { state: 'dirty' },
      label: 'uwChipDirty',
      tone: 'neutral',
      tip: 'uwTipDirty',
    },
    {
      name: '17 clean (ready)',
      input: { state: 'ready' },
      label: 'uwChipSaved',
      tone: 'ok',
      tip: 'uwTipSaved',
    },
    {
      name: '17 clean (saved, with a time)',
      input: { state: 'saved', lastSavedAt: '2026-05-01T10:00:00Z' },
      label: 'uwChipSaved',
      tone: 'ok',
      tip: 'uwTipSavedAt',
    },
    {
      name: 'EL-1(a) edit_locked (someone else is editing)',
      input: {
        state: 'edit_locked',
        error: 'edit_locked',
        editLock: {
          holderName: 'Minh Trần',
          since: '2026-05-01T10:00:00Z',
          expiresAt: '2026-05-01T10:02:00Z',
          heldByMe: false,
        },
      },
      label: 'uwChipEditLocked',
      tone: 'info',
      action: ['retry', 'uwActRetry'],
      tip: 'uwTipEditLocked',
    },
    {
      name: 'EL-1(a) edit_locked (heldByMe in another window)',
      input: {
        state: 'edit_locked',
        error: 'edit_locked',
        editLock: {
          holderName: 'Minh Trần',
          since: '2026-05-01T10:00:00Z',
          expiresAt: '2026-05-01T10:02:00Z',
          heldByMe: true,
        },
      },
      label: 'uwChipEditLockedSelf',
      tone: 'info',
      action: ['retry', 'uwActRetry'],
      tip: 'uwTipEditLockedSelf',
    },
  ]

  it.each(rows)('$name', ({ input, label, tone, action, tip }) => {
    const model = chip(input)
    expect(model.labelKey).toBe(label)
    expect(model.tone).toBe(tone)
    if (action) {
      expect(model.action).toEqual({ kind: action[0], labelKey: action[1] })
    } else {
      expect(model.action).toBeUndefined()
    }
    expect(model.tipKey).toBe(tip)
  })

  it('signed-out with the account back in offers Retry, not another sign-in', () => {
    expect(chip({ state: 'signed-out' }, { needsSignIn: false }).action).toEqual({
      kind: 'retry',
      labelKey: 'uwActRetry',
    })
  })

  it('blocked reads the reason after "Blocked:" and keeps the sentence the tooltip leads with', () => {
    const forbidden = chip({ state: 'blocked', error: 'forbidden' })
    expect(forbidden.reasonKey).toBe('uwReasonForbidden')
    expect(chipCopy(forbidden, t, 'en-US').label).toBe('Blocked: no permission')
    const keystore = chip({ state: 'error', error: 'keystore_locked' })
    expect(keystore.reasonKey).toBe('uwReasonKeystore')
    expect(chipCopy(keystore, t, 'en-US').label).toContain(syncStrings.en.uwReasonKeystore)
    const full = chip({ state: 'error', error: 'store_full' })
    expect(full.reasonKey).toBe('uwReasonStoreFull')
    expect(full.errorKey).toBe('uwQueueFull')
    expect(chipCopy(full, t, 'en-US').tip).toContain(syncStrings.en.uwQueueFull)
  })

  it('failed keeps the reason fragment for {reason} of the tooltip', () => {
    const model = chip({ state: 'failed', error: 'quota_exceeded' })
    expect(model.reasonKey).toBe('uwReasonQuota')
    expect(chipCopy(model, t, 'en-US').tip).toContain(copy.uwReasonQuota)
  })

  it('a blocked sign-in reason reads a sentence, not "other"', () => {
    expect(chip({ state: 'blocked', error: 'session_expired' }).reasonKey).toBe('uwReasonSession')
    expect(chip({ state: 'blocked', error: 'not_signed_in' }).reasonKey).toBe('uwReasonSignedOut')
  })

  it('the queued tooltips fill {time} from queuedAt, and read an em dash without one', () => {
    for (const state of ['queued', 'paused_offline', 'paused_user'] as const) {
      const withTime = chip({ state }, { needsSignIn: false, queuedAt: '2026-05-01T10:00:00Z' })
      expect(withTime.savedAt).toBe('2026-05-01T10:00:00Z')
      expect(chipCopy(withTime, t, 'en-US').tip).not.toMatch(/\{|\}|—/)
      const without = chipCopy(chip({ state }), t, 'en-US')
      expect(without.tip).toContain('—')
      expect(without.tip).not.toMatch(/\{|\}/)
    }
  })

  it('every pill state has a visible label and a description with no placeholder left', () => {
    for (const row of rows) {
      const c = chipCopy(
        chip(row.input, { needsSignIn: true, queuedAt: '2026-05-01T10:00:00Z' }),
        t,
        'en-US',
      )
      expect(c.label).toBeTruthy()
      expect(c.label).not.toMatch(/_|\{|\}/)
      expect(c.tip).toBeTruthy()
      expect(c.tip).not.toMatch(/\{|\}/)
    }
  })
})

describe('T2: Save pill priority (the higher row wins)', () => {
  // [higher input, lower input, expected label of the higher]
  const pairs: Array<[string, Partial<UniworkDocStatus>, Partial<UniworkDocStatus>, StringKey]> = [
    [
      'blocked beats remote-newer',
      { state: 'blocked', error: 'forbidden', remote: newerDirty },
      { state: 'dirty', remote: newerDirty },
      'uwChipBlocked',
    ],
    [
      'keystore_locked error beats remote-newer and reads blocked',
      { state: 'error', error: 'keystore_locked', remote: newerDirty },
      { state: 'error', error: 'network', remote: newerDirty },
      'uwChipBlocked',
    ],
    [
      'keystore_locked error beats a plain error',
      { state: 'error', error: 'keystore_locked' },
      { state: 'error', error: 'network' },
      'uwChipBlocked',
    ],
    [
      'failed beats remote-newer',
      { state: 'failed', remote: newerDirty },
      { state: 'saved', remote: newerDirty },
      'uwChipError',
    ],
    [
      'conflict beats remote-newer',
      { state: 'conflict', remote: newerDirty },
      { state: 'dirty', remote: newerDirty },
      'uwChipConflict',
    ],
    [
      'reconciling beats remote-newer',
      { state: 'reconciling', remote: newerDirty },
      { state: 'dirty', remote: newerDirty },
      'uwChipReconciling',
    ],
    [
      'EL-1(a) edit_locked beats remote-newer (the pill names the holder)',
      {
        state: 'edit_locked',
        error: 'edit_locked',
        editLock: {
          holderName: 'Minh Trần',
          since: '2026-05-01T10:00:00Z',
          expiresAt: '2026-05-01T10:02:00Z',
          heldByMe: false,
        },
        remote: newerDirty,
      },
      { state: 'dirty', remote: newerDirty },
      'uwChipEditLocked',
    ],
    [
      // EL1A-R2-4: this row was a state-only pair ({edit_locked} vs {paused_admin}), which could
      // never fail: with the edit_locked branch reverted to its old seat (below the queued rows)
      // the higher input still matched it, because no other branch reads a lone edit_locked state.
      // It now combines the signals that really compete with that branch - a newer-version bar and
      // a save waiting for an AI run - so the pair fails the moment the branch loses its seat
      'EL-1(a) edit_locked beats a paused_admin row carrying a newer bar and a wait',
      { state: 'edit_locked', error: 'edit_locked', saveWait: 'ai', remote: newerDirty },
      { state: 'paused_admin', saveWait: 'ai', remote: newerDirty },
      'uwChipEditLocked',
    ],
    [
      'EL-1(a) edit_locked beats a save waiting for AI',
      { state: 'edit_locked', error: 'edit_locked', saveWait: 'ai' },
      { state: 'dirty', saveWait: 'ai' },
      'uwChipEditLocked',
    ],
    [
      'reconciling-stuck beats remote-newer',
      { state: 'reconciling-stuck', remote: newerDirty },
      { state: 'dirty', remote: newerDirty },
      'uwChipReconcileStuck',
    ],
    [
      'remote-newer beats paused_admin',
      { state: 'paused_admin', remote: newerDirty },
      { state: 'paused_admin' },
      'uwChipRemoteNewer',
    ],
    [
      'remote-newer beats queued',
      { state: 'queued', remote: newerDirty },
      { state: 'queued' },
      'uwChipRemoteNewer',
    ],
    [
      'remote-newer beats waiting for AI',
      { state: 'dirty', saveWait: 'ai', remote: newerDirty },
      { state: 'dirty', saveWait: 'ai' },
      'uwChipRemoteNewer',
    ],
    [
      'paused_admin beats queued with the same unsent N+1',
      { state: 'paused_admin', pendingNext: true },
      { state: 'queued', pendingNext: true },
      'uwChipPausedAdmin',
    ],
    [
      'waiting for AI beats queued/paused_user (a wait row)',
      { state: 'queued', saveWait: 'ai' },
      { state: 'queued' },
      'uwChipSaving',
    ],
    [
      'waiting for AI beats view-only',
      { access: 'view', state: 'dirty', saveWait: 'ai' },
      { access: 'view', state: 'dirty' },
      'uwChipSaving',
    ],
    [
      'queued with an intent beats view-only',
      { access: 'view', state: 'queued' },
      { access: 'view', state: 'dirty' },
      'uwChipQueued',
    ],
    [
      'paused_user with an intent beats view-only',
      { access: 'view', state: 'paused_user' },
      { access: 'view', state: 'dirty' },
      'uwChipQueued',
    ],
    [
      'reconciling beats view-only',
      { access: 'view', state: 'reconciling' },
      { access: 'view', state: 'saved' },
      'uwChipReconciling',
    ],
    [
      'view-only beats dirty / saved',
      { access: 'view', state: 'dirty' },
      { access: 'edit', state: 'dirty' },
      'uwChipViewOnly',
    ],
  ]

  it.each(pairs)('%s', (_name, higher, lower, label) => {
    expect(chip(higher).labelKey).toBe(label)
    // dropping the higher signal gives a different pill
    expect(chip(lower).labelKey).not.toBe(label)
  })

  it('a failure outranks every row below it for a view-only doc as well', () => {
    expect(chip({ access: 'view', state: 'blocked', error: 'forbidden' }).labelKey).toBe(
      'uwChipBlocked',
    )
    expect(chip({ access: 'view', state: 'failed' }).labelKey).toBe('uwChipError')
  })

  it('merging a newer bar never changes the pill of a state that outranks it', () => {
    const outranking: Array<Partial<UniworkDocStatus>> = [
      { state: 'blocked', error: 'forbidden' },
      { state: 'signed-out' },
      { state: 'failed' },
      { state: 'error', error: 'network' },
      { state: 'error', error: 'keystore_locked' },
      { state: 'error', error: 'store_full' },
      { state: 'conflict' },
      // EL-1(a): a 423 lock names the holder instead of yielding to the newer-version bar
      {
        state: 'edit_locked',
        error: 'edit_locked',
        editLock: {
          holderName: 'Minh Trần',
          since: '2026-05-01T10:00:00Z',
          expiresAt: '2026-05-01T10:02:00Z',
          heldByMe: false,
        },
      },
      { state: 'reconciling-stuck' },
      { state: 'reconciling' },
    ]
    for (const s of outranking) {
      expect(chip({ ...s, remote: newerDirty }).labelKey).toBe(chip(s).labelKey)
    }
  })

  it('error codes only matter for the two refusals: other error codes stay "error"', () => {
    const codes: UniworkDocErrorCode[] = ['network', 'timeout', 'forbidden', 'ticket_expired']
    for (const error of codes) {
      expect(chip({ state: 'error', error }).labelKey).toBe('uwChipError')
    }
  })
})

describe('V6u-05: one formatter for the saved-at time (pill and popover)', () => {
  // local wall-clock times so the same-day branch does not depend on the runner's time zone
  const now = new Date(2026, 4, 1, 12, 0)
  const sameDay = new Date(2026, 4, 1, 8, 5).toISOString()
  const otherDay = new Date(2026, 3, 28, 8, 5).toISOString()

  it('the queued tooltip reads the time exactly as the popover line does', () => {
    for (const locale of ['en-US', 'vi-VN']) {
      for (const at of [sameDay, otherDay]) {
        for (const state of ['queued', 'paused_offline', 'paused_user'] as const) {
          const model = chipModelOf(
            {
              path: '/p',
              documentId: 'd',
              workspaceId: 'w',
              title: 'P',
              format: 'docx',
              access: 'edit',
              state,
            } as UniworkDocStatus,
            { needsSignIn: false, queuedAt: at },
          )
          expect(chipCopy(model, t, locale, now).tip).toContain(formatQueueTime(at, locale, now))
        }
      }
    }
  })

  it('the saved-at tooltip of a clean document uses the same formatter', () => {
    const model = chipModelOf(
      {
        path: '/p',
        documentId: 'd',
        workspaceId: 'w',
        title: 'P',
        format: 'docx',
        access: 'edit',
        state: 'saved',
        lastSavedAt: sameDay,
      } as UniworkDocStatus,
      { needsSignIn: false },
    )
    expect(model.tipKey).toBe('uwTipSavedAt')
    expect(chipCopy(model, t, 'en-US', now).tip).toContain(formatQueueTime(sameDay, 'en-US', now))
  })
})

describe('V6u2-01: the in-strip focus chip fits left of the pill', () => {
  it('room = pill left edge minus the 8px gap and the 8px window gutter (unscaled px)', () => {
    // the narrowest real window (720 px minimum): the pill starts at x 216
    expect(focusTipRoomOf(216, 1)).toBe(200)
    // 1280 px window: the pill starts at x 775, far more room than the 480px cap needs
    expect(focusTipRoomOf(775, 1)).toBe(759)
  })

  it('a zoomed interface measures window px and lays out in unscaled px', () => {
    expect(focusTipRoomOf(216, 1.25)).toBe(156)
    expect(focusTipRoomOf(216, 0.8)).toBe(254)
  })

  it('never negative; no room (or a bad measure) is 0', () => {
    expect(focusTipRoomOf(10, 1)).toBe(0)
    expect(focusTipRoomOf(-50, 1)).toBe(0)
    expect(focusTipRoomOf(Number.NaN, 1)).toBe(0)
    expect(focusTipRoomOf(216, 0)).toBe(200)
    expect(focusTipRoomOf(216, Number.NaN)).toBe(200)
  })

  it('a minimum below which the chip is not drawn at all', () => {
    expect(FOCUS_TIP_MIN_PX).toBeGreaterThan(0)
    expect(focusTipRoomOf(216, 1)).toBeGreaterThanOrEqual(FOCUS_TIP_MIN_PX)
  })
})

describe('EL-1(a): edit_locked Save pill & i18n copy', () => {
  const copyVi = {
    ...accountStrings.vi,
    ...syncStrings.vi,
    ...uniworkDocumentStrings.vi,
  } as Record<string, string>
  const tVi: TFunc = (key: StringKey, params) =>
    (copyVi[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

  it('renders "{name} đang sửa" / "{name} is editing" when holderName is present, and falls back to "Người khác đang sửa" / "Someone is editing" when missing', () => {
    const named = chip({
      state: 'edit_locked',
      error: 'edit_locked',
      editLock: {
        holderName: 'Minh Trần',
        since: '2026-05-01T10:00:00Z',
        expiresAt: '2026-05-01T10:02:00Z',
        heldByMe: false,
      },
    })
    expect(named.tone).toBe('info')
    expect(named.labelKey).not.toBe('uwChipConflict')
    expect(chipCopy(named, tVi, 'vi-VN').label).toBe('Minh Trần đang sửa')
    expect(chipCopy(named, t, 'en-US').label).toBe('Minh Trần is editing')

    const unnamed = chip({
      state: 'edit_locked',
      error: 'edit_locked',
      editLock: {
        holderName: null,
        since: null,
        expiresAt: null,
        heldByMe: false,
      },
    })
    expect(chipCopy(unnamed, tVi, 'vi-VN').label).toBe('Người khác đang sửa')
    expect(chipCopy(unnamed, t, 'en-US').label).toBe('Someone is editing')
    expect(chipCopy(unnamed, tVi, 'vi-VN').tip).toContain('—')
    expect(chipCopy(unnamed, tVi, 'vi-VN').tip).not.toMatch(/\{|\}/)
  })

  it('defines edit_locked i18n keys in all locale shards and never uses "khóa" in vi', () => {
    const keys = [
      'uwChipEditLocked',
      'uwChipEditLockedSelf',
      'uwEditLockSomeone',
      'uwTipEditLocked',
      'uwTipEditLockedSelf',
      'uwErrEditLocked',
      'uwReasonEditLocked',
    ] as const
    for (const [locale, dict] of Object.entries(uniworkDocumentStrings)) {
      const record = dict as Record<string, string>
      for (const k of keys) {
        expect(record[k], `${locale}.${k}`).toBeTruthy()
      }
    }
    const viDict = uniworkDocumentStrings.vi as Record<string, string>
    for (const k of keys) {
      expect(viDict[k]?.toLowerCase()).not.toContain('khóa')
      expect(viDict[k]?.toLowerCase()).not.toContain('khoá')
    }
  })

  it('EL1A-FE-1: every non-en shard translates the edit-lock keys, keeping {name}/{time}', () => {
    // a documented exception list: a value that is genuinely identical to en in that language
    const identical: Array<[string, string]> = []
    const keys = [
      'uwChipEditLocked',
      'uwChipEditLockedSelf',
      'uwEditLockSomeone',
      'uwTipEditLocked',
      'uwTipEditLockedSelf',
      'uwErrEditLocked',
      'uwReasonEditLocked',
    ] as const
    const en = uniworkDocumentStrings.en as Record<string, string>
    for (const [locale, dict] of Object.entries(uniworkDocumentStrings)) {
      if (locale === 'en') continue
      const record = dict as Record<string, string>
      for (const k of keys) {
        if (identical.some(([l, key]) => l === locale && key === k)) continue
        expect(record[k], `${locale}.${k} is an untranslated copy of en`).not.toBe(en[k])
      }
      // the placeholders the tip and the label fill must survive translation
      expect(record.uwChipEditLocked, `${locale}.uwChipEditLocked`).toContain('{name}')
      expect(record.uwTipEditLocked, `${locale}.uwTipEditLocked`).toContain('{name}')
      expect(record.uwTipEditLocked, `${locale}.uwTipEditLocked`).toContain('{time}')
      // the read-only sentence is gone (EL1A-TIP): the doc stays editable in EL-1(a)
      expect(record.uwTipEditLocked, `${locale}.uwTipEditLocked`).not.toMatch(/read|chỉ đọc/i)
    }
  })

  it('EL1A-FE-2: UNIWORK_ERROR_KEYS renders every value with no "{" left', () => {
    // the launch notice and chipCopy's errorKey prefix call t(key) with NO params, so a key that
    // needs one ({name}) would leak a raw placeholder; edit_locked maps to the param-free key
    for (const [code, key] of Object.entries(UNIWORK_ERROR_KEYS)) {
      expect(t(key as StringKey), `UNIWORK_ERROR_KEYS.${code} -> ${key}`).not.toMatch(/\{|\}/)
    }
    expect(UNIWORK_ERROR_KEYS.edit_locked).toBe('uwErrEditLocked')
    expect(t('uwErrEditLocked')).toBe('Someone else is editing this document.')
  })

  it('EL1A-FE-7: the tip names the holder (the time is filled from lock.since)', () => {
    const named = chip({
      state: 'edit_locked',
      error: 'edit_locked',
      editLock: {
        holderName: 'Minh Trần',
        since: '2026-05-01T10:00:00Z',
        expiresAt: '2026-05-01T10:02:00Z',
        heldByMe: false,
      },
    })
    // a `t` that leaves missing params alone: dropping tipParams.name would leave a "{name}" hole
    const strict: TFunc = (key: StringKey, params) => {
      const text = copy[key] ?? key
      return params === undefined
        ? text
        : text.replace(/\{(\w+)\}/g, (match, name: string) =>
            Object.hasOwn(params, name) ? String(params[name]) : match,
          )
    }
    const tip = chipCopy(named, strict, 'en-US').tip
    expect(tip).toContain('Minh Trần has been editing since')
    expect(tip).not.toMatch(/\{|\}/)
    expect(chipCopy(named, strict, 'en-US').title).toContain('Minh Trần')
  })

  it('EL1A-FE-3: heldByMe reads as the self label and the self tip, Retry kept', () => {
    const self = chip({
      state: 'edit_locked',
      error: 'edit_locked',
      editLock: {
        holderName: 'Minh Trần',
        since: '2026-05-01T10:00:00Z',
        expiresAt: '2026-05-01T10:02:00Z',
        heldByMe: true,
      },
    })
    expect(self.labelKey).toBe('uwChipEditLockedSelf')
    expect(self.tipKey).toBe('uwTipEditLockedSelf')
    expect(self.action).toEqual({ kind: 'retry', labelKey: 'uwActRetry' })
    const copySelf = chipCopy(self, t, 'en-US')
    expect(copySelf.label).toBe('Editing in another window')
    expect(copySelf.label).not.toContain('Minh Trần')
    expect(copySelf.tip).toBe('You’re editing this document in another window.')

    const copyViSelf = chipCopy(self, tVi, 'vi-VN')
    expect(copyViSelf.label).toBe('Đang sửa ở cửa sổ khác')
    expect(copyViSelf.label).not.toContain('Minh Trần')
    expect(copyViSelf.tip).toBe('Bạn đang sửa tài liệu này ở cửa sổ khác.')

    const other = chip({
      state: 'edit_locked',
      error: 'edit_locked',
      editLock: {
        holderName: 'Minh Trần',
        since: '2026-05-01T10:00:00Z',
        expiresAt: '2026-05-01T10:02:00Z',
        heldByMe: false,
      },
    })
    expect(other.labelKey).toBe('uwChipEditLocked')
    expect(other.tipKey).toBe('uwTipEditLocked')
    expect(chipCopy(other, t, 'en-US').label).toBe('Minh Trần is editing')
  })

  it('EL1A-FE-6: the mini pill wears the ring, never the queued clock or the view-only lock', () => {
    const locked = chip({
      state: 'edit_locked',
      error: 'edit_locked',
      editLock: { holderName: 'Minh Trần', since: null, expiresAt: null, heldByMe: false },
    })
    expect(miniGlyphOf(locked, 'edit_locked')).toBe('ring')
    expect(miniGlyphOf(chip({ state: 'queued' }), 'queued')).toBe('clock')
    expect(miniGlyphOf(chip({ access: 'view', state: 'saved' }), 'saved')).toBe('lock')
  })
})
