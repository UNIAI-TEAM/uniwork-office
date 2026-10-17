import { describe, expect, it } from 'vitest'
import type { SyncCenterHeader, SyncCenterRow, SyncCenterRowState } from '../src/shared/sync-center'
import {
  BLOCKED_REASONS,
  SYNC_TABS,
  actionErrorKey,
  formatBytes,
  headerLine,
  resolveHeaderStatus,
  rowView,
} from '../src/renderer/src/sync-center-model'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

const header = (over: Partial<SyncCenterHeader> = {}): SyncCenterHeader => ({
  status: 'online',
  online: true,
  paused: false,
  adminPaused: false,
  otherOrgHasIntents: false,
  resyncFailed: false,
  feedOff: false,
  resynced: false,
  ...over,
})

const row = (state: SyncCenterRowState, over: Partial<SyncCenterRow> = {}): SyncCenterRow => ({
  id: `r-${state}`,
  documentId: 'd1',
  documentKey: 'k1',
  title: 'Báo cáo Q3',
  ext: 'docx',
  state,
  savedAt: '2026-10-15T08:00:00.000Z',
  canEdit: true,
  ...over,
})

const ctx = { online: true }
const ids = (r: SyncCenterRow, c = ctx) => rowView(r, c).actions.map((a) => a.id)

/** every key the model can hand the pane exists in vi and en */
const table = (lang: 'vi' | 'en') =>
  ({ ...syncStrings[lang], ...uniworkDocumentStrings[lang] }) as Record<string, string>

describe('header status priority (Đầu trang S2)', () => {
  it('takes the highest condition from the flags', () => {
    expect(resolveHeaderStatus(header())).toBe('online')
    expect(resolveHeaderStatus(header({ resynced: true }))).toBe('resynced')
    expect(resolveHeaderStatus(header({ resynced: true, feedOff: true }))).toBe('feed_off')
    expect(resolveHeaderStatus(header({ feedOff: true, resyncFailed: true }))).toBe('resync_failed')
    expect(resolveHeaderStatus(header({ resyncFailed: true, paused: true }))).toBe('paused')
    expect(resolveHeaderStatus(header({ paused: true, online: false }))).toBe('offline')
    expect(resolveHeaderStatus(header({ online: false, adminPaused: true }))).toBe('admin_paused')
  })

  it('keeps the session conditions main resolved above every flag', () => {
    const all = { adminPaused: true, online: false, paused: true, resyncFailed: true }
    expect(resolveHeaderStatus(header({ ...all, status: 'session_expired' }))).toBe(
      'session_expired',
    )
    expect(resolveHeaderStatus(header({ ...all, status: 'signed_out' }))).toBe('signed_out')
    expect(resolveHeaderStatus(header({ ...all, status: 'store_newer' }))).toBe('store_newer')
    // a lower status main sent does not hide a higher flag
    expect(resolveHeaderStatus(header({ status: 'online', paused: true }))).toBe('paused')
  })

  it('maps each status to its line and action', () => {
    expect(headerLine(header({ status: 'store_newer' }), undefined)).toBeNull()
    expect(headerLine(header({ status: 'signed_out' }), { lockedCount: 4 })).toEqual({
      key: 'uwSyncSignedOut',
      params: { count: 4 },
      tone: 'neutral',
      action: 'signIn',
    })
    expect(headerLine(header({ status: 'signed_out' }), { lockedCount: 0 })).toMatchObject({
      key: 'uwSyncSignedOutEmpty',
      tone: 'neutral',
      action: 'signIn',
    })
    expect(headerLine(header({ status: 'session_expired' }), undefined)).toMatchObject({
      key: 'uwSyncSessionExpired',
      action: 'signInAgain',
    })
    expect(headerLine(header({ adminPaused: true }), undefined)?.key).toBe('uwSyncAdminPaused')
    expect(headerLine(header({ online: false, lastSyncAt: 'x' }), undefined)).toMatchObject({
      key: 'uwSyncOffline',
      timeParams: { time: 'x' },
    })
    expect(headerLine(header({ paused: true }), undefined)?.key).toBe('uwSyncPaused')
    expect(headerLine(header({ resyncFailed: true }), undefined)?.key).toBe('uwSyncResyncFailed')
    expect(headerLine(header({ feedOff: true }), undefined)?.key).toBe('uwSyncFeedOff')
    expect(headerLine(header({ resynced: true, lastSyncAt: 'x' }), undefined)?.key).toBe(
      'uwSyncResynced',
    )
    expect(headerLine(header({ lastSyncAt: 'x' }), undefined)).toMatchObject({
      key: 'uwSyncOnline',
      timeParams: { time: 'x' },
    })
  })

  it('BE-2n-3: with no sync time yet the line never carries an empty {time}', () => {
    const online = headerLine(header(), undefined)!
    expect(online.key).toBe('uwSyncOnlineNoTime')
    expect(online.timeParams).toBeUndefined()
    const offline = headerLine(header({ online: false }), undefined)!
    expect(offline.key).toBe('uwSyncOfflineNoTime')
    expect(offline.timeParams).toBeUndefined()
    expect(headerLine(header({ resynced: true }), undefined)?.timeParams).toBeUndefined()
  })
})

describe('tabs', () => {
  it('lists attention, pending, recent in order with their empty lines', () => {
    expect(SYNC_TABS.map((tab) => [tab.id, tab.labelKey, tab.emptyKey])).toEqual([
      ['attention', 'uwSyncTabAttention', 'uwSyncEmptyAttention'],
      ['pending', 'uwSyncTabQueue', 'uwSyncEmptyQueue'],
      ['recent', 'uwSyncTabRecent', 'uwSyncEmptyRecent'],
    ])
  })
})

describe('queue rows (badge, sub-line, actions)', () => {
  it('queued: info badge, saved line, Gửi ngay · Hủy lần lưu…', () => {
    const v = rowView(row('queued', { base: 7, sizeBytes: 2048 }), ctx)
    expect(v.badge).toEqual({ tone: 'info', key: 'uwBadgeQueued' })
    expect(v.sub).toMatchObject({
      key: 'uwRowQueued',
      params: { base: 7 },
      sizeParams: { size: 2048 },
    })
    expect(v.actions.map((a) => a.id)).toEqual(['sendNow', 'cancelSave'])
    expect(v.actions[1]?.confirm).toEqual({
      sentenceKey: 'uwQueueCancelConfirm',
      goKey: 'uwQueueCancelGo',
    })
  })

  it('queued offline: Gửi ngay stays, aria-disabled with the offline reason', () => {
    const send = rowView(row('queued'), { online: false }).actions[0]
    expect(send).toMatchObject({ id: 'sendNow', unavailableKey: 'uwSyncNowOffline' })
  })

  it('paused rows only cancel', () => {
    expect(rowView(row('paused_offline'), ctx).badge).toEqual({
      tone: 'info',
      key: 'uwBadgeWaitNetwork',
    })
    expect(rowView(row('paused_user'), ctx).badge).toEqual({
      tone: 'neutral',
      key: 'uwBadgePausedUser',
    })
    expect(rowView(row('paused_admin'), ctx).badge).toEqual({
      tone: 'neutral',
      key: 'uwBadgePausedAdmin',
    })
    expect(rowView(row('paused_user'), ctx).sub.key).toBe('uwRowPausedUser')
    expect(rowView(row('paused_admin'), ctx).sub.key).toBe('uwRowPausedAdmin')
    for (const s of ['paused_offline', 'paused_user', 'paused_admin'] as const) {
      expect(ids(row(s))).toEqual(['cancelSave'])
    }
  })

  it('uploading and committing have no action', () => {
    const up = rowView(row('uploading', { progress: { done: 1, total: 4 } }), ctx)
    expect(up.badge).toEqual({ tone: 'info', key: 'uwBadgeSending' })
    expect(up.sub.key).toBe('uwRowUploading')
    expect(up.progress).toEqual({ done: 1, total: 4 })
    expect(up.actions).toEqual([])
    expect(rowView(row('committing'), ctx).sub.key).toBe('uwRowCommitting')
    expect(ids(row('committing'))).toEqual([])
  })

  it('reconciling: Kiểm tra lại · Hướng dẫn', () => {
    expect(rowView(row('reconciling'), ctx).badge).toEqual({
      tone: 'warn',
      key: 'uwBadgeReconciling',
    })
    expect(ids(row('reconciling'))).toEqual(['recheck', 'guide'])
  })

  it('reconciling_stuck: three actions plus Bỏ lần lưu…, download only when canEdit', () => {
    const v = rowView(row('reconciling_stuck', { reconcileAttempts: 5 }), ctx)
    expect(v.badge).toEqual({ tone: 'warn', key: 'uwBadgeReconcileStuck' })
    expect(v.sub).toMatchObject({ key: 'uwRowReconcileStuck', params: { count: 5 } })
    expect(v.actions.map((a) => a.id)).toEqual([
      'recheck',
      'copySupport',
      'downloadMine',
      'discardSave',
    ])
    expect(v.actions[3]).toMatchObject({
      labelKey: 'uwActDiscardSave',
      confirm: { sentenceKey: 'uwStuckDiscardConfirm', goKey: 'uwActDiscard' },
    })
    expect(ids(row('reconciling_stuck', { canEdit: false }))).toEqual([
      'recheck',
      'copySupport',
      'discardSave',
    ])
    // offline still runs: the file is on this computer
    expect(ids(row('reconciling_stuck'), { online: false })).toContain('downloadMine')
  })

  it('conflict: Mở để xử lý with the server version line', () => {
    const v = rowView(
      row('conflict', { conflict: { version: 9, author: 'Lan', savedAt: 't' } }),
      ctx,
    )
    expect(v.badge).toEqual({ tone: 'warn', key: 'uwBadgeConflict' })
    expect(v.sub).toMatchObject({ key: 'uwRowConflict', params: { n: 9, author: 'Lan' } })
    expect(v.actions.map((a) => a.id)).toEqual(['openToResolve'])
    // VIS-3: the conflict's one action is the row's primary action
    expect(v.actions.map((a) => a.primary)).toEqual([true])
    expect(rowView(row('conflict', { conflict: { version: 9 } }), ctx).sub.keyParams).toEqual({
      author: 'uwAuthorFallback',
    })
  })

  it('failed: Chi tiết · Lưu lại · Hủy lần lưu…, reason fragment by failedReason', () => {
    const v = rowView(row('failed', { failedReason: 'too_large' }), ctx)
    expect(v.badge).toEqual({ tone: 'error', key: 'uwBadgeFailed' })
    expect(v.sub).toMatchObject({ key: 'uwRowFailed', keyParams: { reason: 'uwReasonTooLarge' } })
    expect(v.actions.map((a) => a.id)).toEqual(['details', 'saveAgain', 'cancelSave'])
    expect(rowView(row('failed', { failedReason: 'quota' }), ctx).sub.keyParams).toEqual({
      reason: 'uwReasonQuota',
    })
    expect(rowView(row('failed'), ctx).sub.keyParams).toEqual({ reason: 'uwReasonOther' })
  })

  it('EL1A-FE-5: a failed save refused by someone else’s edit lock names that reason, not uwReasonOther', () => {
    // the queue parked the intent `failed` with lastError edit_locked (a 423 document_locked):
    // the row must say "someone else is editing" instead of the generic "unavailable"
    const v = rowView(row('failed', { failedReason: 'edit_locked' }), ctx)
    expect(v.badge).toEqual({ tone: 'error', key: 'uwBadgeFailed' })
    expect(v.sub).toMatchObject({
      key: 'uwRowFailed',
      keyParams: { reason: 'uwReasonEditLocked' },
    })
    expect(v.sub.keyParams?.reason).not.toBe('uwReasonOther')
    expect(v.actions.map((a) => a.id)).toEqual(['details', 'saveAgain', 'cancelSave'])
    // never the conflict affordance, and never "khóa" in the vi fragment
    expect(v.actions.map((a) => a.id)).not.toContain('openToResolve')
    for (const lang of ['vi', 'en'] as const) {
      const fragment = table(lang)[v.sub.keyParams!.reason as string]
      expect(fragment, `${lang}.uwReasonEditLocked`).toBeTruthy()
    }
    expect(table('vi').uwReasonEditLocked?.toLowerCase()).not.toContain('khóa')
    expect(table('vi').uwReasonEditLocked?.toLowerCase()).not.toContain('khoá')
  })

  it('committed / moved / archived: Mở', () => {
    const c = rowView(row('committed', { committedVersion: 12 }), ctx)
    expect(c.badge).toEqual({ tone: 'ok', key: 'uwBadgeSaved' })
    expect(c.sub).toMatchObject({ key: 'uwRowCommitted', params: { n: 12 } })
    expect(c.actions.map((a) => a.id)).toEqual(['open'])
    const m = rowView(row('moved', { workspaceName: 'Kế toán' }), ctx)
    expect(m.badge).toEqual({ tone: 'info', key: 'uwBadgeMoved' })
    expect(m.sub).toMatchObject({ key: 'uwRowMoved', params: { workspace: 'Kế toán' } })
    expect(ids(row('moved'))).toEqual(['open'])
    expect(rowView(row('archived'), ctx).badge).toEqual({ tone: 'info', key: 'uwBadgeArchived' })
    expect(rowView(row('archived'), ctx).sub.key).toBe('uwRowArchived')
    expect(ids(row('archived'))).toEqual(['open'])
  })

  it('kept draft: Mở nháp · Bỏ nháp…; revoked: only Bỏ nháp…, not openable', () => {
    const v = rowView(row('kept_draft'), ctx)
    expect(v.badge).toEqual({ tone: 'warn', key: 'uwBadgeKeptDraft' })
    expect(v.sub.key).toBe('uwRowKeptDraft')
    expect(v.opens).toBe('draft')
    expect(v.actions.map((a) => a.id)).toEqual(['openDraft', 'discardDraft'])
    expect(v.actions[1]?.confirm).toEqual({
      sentenceKey: 'uwDiscardDraftConfirm',
      goKey: 'uwActDiscard',
    })
    const r = rowView(row('kept_draft', { revoked: true }), ctx)
    expect(r.badge).toEqual({ tone: 'error', key: 'uwBadgeRevoked' })
    expect(r.opens).toBeNull()
    expect(r.actions.map((a) => a.id)).toEqual(['discardDraft'])
  })
})

describe('blocked reasons (Lý do bị chặn, 13 reasons)', () => {
  const blocked = (reason: string) =>
    rowView(row('blocked', { blockedReason: reason as SyncCenterRow['blockedReason'] }), ctx)

  it('covers the 13 reasons of the spine', () => {
    expect(Object.keys(BLOCKED_REASONS).sort()).toEqual(
      [
        'session_expired',
        'signed_out',
        'foreign_account',
        'permission_revoked',
        'document_deleted',
        'document_archived',
        'organization_suspended',
        'member_deactivated',
        'lease_expired',
        'keystore_locked',
        'clock_rollback',
        'store_full',
        'store_newer',
      ].sort(),
    )
  })

  it('maps badge, reason fragment and actions per reason', () => {
    const expected: Record<string, [string, string, string, string[]]> = {
      session_expired: ['error', 'uwBadgeBlocked', 'uwReasonSession', ['signInAgain']],
      signed_out: ['error', 'uwBadgeLocked', 'uwReasonSignedOut', ['signIn']],
      foreign_account: ['error', 'uwBadgeLocked', 'uwReasonForeign', ['switchAccount']],
      permission_revoked: [
        'error',
        'uwBadgeRevoked',
        'uwReasonForbidden',
        ['recheck', 'discardDraft'],
      ],
      document_deleted: ['error', 'uwBadgeDeleted', 'uwReasonDeleted', ['recheck', 'discardDraft']],
      document_archived: [
        'info',
        'uwBadgeArchived',
        'uwReasonArchived',
        ['recheck', 'discardDraft'],
      ],
      organization_suspended: ['error', 'uwBadgeBlocked', 'uwReasonSuspended', ['recheck']],
      member_deactivated: [
        'error',
        'uwBadgeBlocked',
        'uwReasonDeactivated',
        ['recheck', 'discardDraft'],
      ],
      lease_expired: ['error', 'uwBadgeReconnect', 'uwReasonLease', ['reconnect']],
      keystore_locked: ['error', 'uwBadgeKeystore', 'uwReasonKeystore', ['retry']],
      clock_rollback: ['error', 'uwBadgeReconnect', 'uwReasonClock', ['reconnect']],
      store_full: ['error', 'uwBadgeBlocked', 'uwReasonStoreFull', []],
      store_newer: ['error', 'uwBadgeLocked', 'uwReasonStoreNewer', []],
    }
    for (const [reason, [tone, badge, fragment, actions]] of Object.entries(expected)) {
      const v = blocked(reason)
      expect(v.badge, reason).toEqual({ tone, key: badge })
      expect(v.sub, reason).toMatchObject({ key: 'uwRowBlocked', keyParams: { reason: fragment } })
      expect(
        v.actions.map((a) => a.id),
        reason,
      ).toEqual(actions)
    }
  })

  it('Bỏ nháp… on a blocked row needs the in-row confirm, for the four access-lost reasons only', () => {
    for (const reason of [
      'permission_revoked',
      'document_deleted',
      'document_archived',
      'member_deactivated',
    ]) {
      const discard = blocked(reason).actions.find((a) => a.id === 'discardDraft')
      expect(discard, reason).toMatchObject({
        labelKey: 'uwActDiscardDraft',
        confirm: { sentenceKey: 'uwDiscardDraftConfirm', goKey: 'uwActDiscard' },
      })
    }
    for (const reason of Object.keys(BLOCKED_REASONS)) {
      if (
        [
          'permission_revoked',
          'document_deleted',
          'document_archived',
          'member_deactivated',
        ].includes(reason)
      ) {
        continue
      }
      expect(
        blocked(reason).actions.map((a) => a.id),
        reason,
      ).not.toContain('discardDraft')
    }
  })

  it('lease_expired with the offline library off has no Kết nối lại; other rows keep theirs', () => {
    const lease = (over: Partial<SyncCenterRow>) =>
      rowView(row('blocked', { blockedReason: 'lease_expired', ...over }), ctx)
    expect(lease({ libraryOff: true }).actions).toEqual([])
    expect(lease({ libraryOff: true }).badge).toEqual({ tone: 'error', key: 'uwBadgeReconnect' })
    expect(lease({ libraryOff: true }).sub).toMatchObject({
      key: 'uwRowBlocked',
      keyParams: { reason: 'uwReasonLease' },
    })
    expect(lease({ libraryOff: false }).actions.map((a) => a.id)).toEqual(['reconnect'])
    expect(lease({}).actions.map((a) => a.id)).toEqual(['reconnect'])
    // libraryOff is about lease_expired only
    const clock = rowView(
      row('blocked', { blockedReason: 'clock_rollback', libraryOff: true }),
      ctx,
    )
    expect(clock.actions.map((a) => a.id)).toEqual(['reconnect'])
  })

  it('never names the document of another account', () => {
    expect(blocked('foreign_account').hideTitle).toBe(true)
    expect(blocked('foreign_account').opens).toBeNull()
    expect(blocked('permission_revoked').hideTitle).toBe(false)
  })

  it('an unknown reason still renders a blocked row with Kiểm tra lại', () => {
    const v = blocked('locked_other')
    expect(v.badge).toEqual({ tone: 'error', key: 'uwBadgeBlocked' })
    expect(v.sub.keyParams).toEqual({ reason: 'uwReasonOther' })
    expect(v.actions.map((a) => a.id)).toEqual(['recheck'])
  })
})

describe('copy and formatting', () => {
  it('maps action refusals to their sentences', () => {
    expect(actionErrorKey('draft_cap')).toBe('uwConflictDraftCapReached')
    expect(actionErrorKey('store_full')).toBe('uwQueueFull')
    expect(actionErrorKey('offline')).toBe('uwSyncNowOffline')
    expect(actionErrorKey('busy')).toBe('uwSyncActionFailed')
    expect(actionErrorKey('other')).toBe('uwSyncActionFailed')
  })

  it('formats bytes', () => {
    expect(formatBytes(512, 'en-US')).toBe('512 B')
    expect(formatBytes(2048, 'en-US')).toBe('2 KB')
    expect(formatBytes(1.5 * 1024 * 1024, 'en-US')).toBe('1.5 MB')
    expect(formatBytes(1024 ** 3, 'vi-VN')).toBe('1 GB')
  })

  it('every key the model can return exists in vi and en', () => {
    const states: SyncCenterRowState[] = [
      'queued',
      'paused_offline',
      'paused_user',
      'paused_admin',
      'uploading',
      'committing',
      'reconciling',
      'reconciling_stuck',
      'conflict',
      'failed',
      'committed',
      'kept_draft',
      'moved',
      'archived',
    ]
    const views = [
      ...states.map((s) => rowView(row(s), ctx)),
      ...Object.keys(BLOCKED_REASONS).map((reason) =>
        rowView(row('blocked', { blockedReason: reason as SyncCenterRow['blockedReason'] }), ctx),
      ),
    ]
    for (const lang of ['vi', 'en'] as const) {
      const dict = table(lang)
      for (const v of views) {
        const keys = [
          v.badge.key,
          v.sub.key,
          ...Object.values(v.sub.keyParams ?? {}),
          ...v.actions.flatMap((a) => [
            a.labelKey,
            a.confirm?.sentenceKey,
            a.confirm?.goKey,
            a.unavailableKey,
          ]),
        ].filter((k): k is string => Boolean(k))
        for (const k of keys) expect(dict[k], `${lang}:${k}`).toBeTruthy()
      }
    }
  })
})
