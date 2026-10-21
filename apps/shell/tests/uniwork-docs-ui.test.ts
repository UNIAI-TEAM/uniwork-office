import { describe, expect, it, vi } from 'vitest'
import type {
  RecentEntry,
  UniworkDocErrorCode,
  UniworkDocStatus,
  UniworkDocSummary,
  UniworkSaveState,
} from '../src/shared/home-api'
import {
  PICKER_SEARCH_DEBOUNCE_MS,
  UNIWORK_ERROR_KEYS,
  blockedReasonKey,
  chipCopy,
  chipModelOf,
  docExtension,
  errorActionOf,
  formatWhen,
  hiddenDocCount,
  initialPickerState,
  isOpenable,
  launchNoticeOf,
  moveActive,
  openCardOf,
  pathKey,
  pickerBodyOf,
  pickerReducer,
  recentOpenAction,
  recentRowIsMissing,
  recentRowModifiedMs,
  recentRowPolicy,
  retryActionOf,
  visibleDocs,
  type PickerAction,
  type PickerState,
} from '../src/renderer/src/uniwork-docs-model'
import { openRecentEntry, openUniworkDocument } from '../src/renderer/src/uniwork-open'
import { publishUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'
import { subscribeUniworkOpened } from '../src/renderer/src/uniwork-recents-refresh'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import type { StringKey, TFunc } from '../src/renderer/src/locale'

const copy = {
  ...accountStrings.en,
  ...syncStrings.en,
  ...uniworkDocumentStrings.en,
} as Record<string, string>
/** English translator with the same {placeholder} rule as the real one */
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

function doc(id: string, title: string, format: UniworkDocSummary['format']): UniworkDocSummary {
  return { id, workspaceId: 'w1', title, format, updatedAt: '2026-05-01T10:00:00Z' }
}

describe('chipModelOf: save state -> chip', () => {
  const labelOf = (s: Partial<UniworkDocStatus>, signedIn = false) => {
    const model = chipModelOf(status(s), { needsSignIn: !signedIn })
    return { ...model, ...chipCopy(model, t, 'en-US') }
  }

  it.each<[UniworkSaveState, string, string, string | undefined]>([
    ['ready', 'Saved to UniWork', 'ok', undefined],
    ['saved', 'Saved to UniWork', 'ok', undefined],
    ['dirty', 'Unsaved changes', 'neutral', undefined],
    ['saving', 'Saving…', 'busy', undefined],
    ['offline', 'Not saved: offline', 'neutral', 'retry'],
    ['signed-out', 'Sign in again to save', 'error', 'sign-in'],
    ['conflict', 'Version conflict', 'warn', 'resolve'],
    ['error', 'Couldn’t save', 'error', 'retry'],
  ])('%s -> "%s" (%s, action %s)', (state, label, tone, action) => {
    const chip = labelOf({ state })
    expect(chip.label).toBe(label)
    expect(chip.tone).toBe(tone)
    expect(chip.action?.kind).toBe(action)
  })

  it('shows View only for a read-only document that is idle, never "Saved"', () => {
    for (const state of ['ready', 'saved', 'dirty', 'saving'] as const) {
      const chip = labelOf({ access: 'view', state })
      expect(chip.label).toBe('View only')
      expect(chip.action).toBeUndefined()
    }
  })

  it('lets a failure state win over View only (a downgraded document that was refused)', () => {
    expect(labelOf({ access: 'view', state: 'blocked', error: 'forbidden' }).label).toBe(
      'Blocked: no permission',
    )
  })

  it.each([
    ['forbidden', 'Blocked: no permission'],
    ['not_found', 'Blocked: document missing'],
    ['deleted', 'Blocked: document deleted'],
    ['quota_exceeded', 'Blocked: storage full'],
    ['too_large', 'Blocked: file too large'],
    ['server_error', 'Blocked: unavailable'],
  ] as const)(
    'blocked with %s reads "%s", opens the queue and keeps the local copy promise',
    (error, label) => {
      const chip = labelOf({ state: 'blocked', error })
      expect(chip.label).toBe(label)
      expect(chip.tone).toBe('error')
      // blocked opens the queue popover for the reason's next step (G5-06u)
      expect(chip.action).toEqual({ kind: 'view-queue', labelKey: 'uwActViewQueue' })
      expect(chip.tip).toContain('Your changes are kept on this computer.')
    },
  )

  it('says "offline" only when the network is the problem', () => {
    for (const error of [undefined, 'network'] as const) {
      const chip = labelOf({ state: 'offline', error })
      expect(chip.label).toBe('Not saved: offline')
      expect(chip.tip).toContain('back online')
    }
  })

  it.each(['server_error', 'timeout', 'malformed_response'] as const)(
    'a %s while the network is fine reads as UniWork being unreachable, not offline',
    (error) => {
      const chip = labelOf({ state: 'offline', error })
      expect(chip.label).toBe("Can't reach UniWork · not saved")
      expect(chip.tip).toBe('Your changes are safe on this computer. Retry in a moment.')
      expect(chip.tone).toBe('neutral')
      expect(chip.action?.kind).toBe('retry')
    },
  )

  it('offers a browser sign-in while signed out, and Retry once the account is signed in again', () => {
    expect(labelOf({ state: 'signed-out' }, false).action).toEqual({
      kind: 'sign-in',
      labelKey: 'acctSignIn',
    })
    expect(labelOf({ state: 'signed-out' }, true).action?.kind).toBe('retry')
  })

  it('leads the error tooltip with the sentence for the code', () => {
    const chip = labelOf({ state: 'error', error: 'network' })
    expect(chip.tip.startsWith('Can’t reach UniWork.')).toBe(true)
    expect(chip.action?.kind).toBe('retry')
  })

  it('puts the last save time into the saved tooltip only when there is one', () => {
    expect(labelOf({ state: 'saved' }).tip).toBe('All changes are saved to UniWork.')
    const when = labelOf({ state: 'saved', lastSavedAt: '2026-05-01T10:00:00Z' }).tip
    expect(when).toMatch(/^All changes are saved to UniWork\. Last saved .+\.$/)
    expect(when).not.toContain('{time}')
  })

  it('never shows an internal code or a bare state name', () => {
    for (const state of [
      'ready',
      'dirty',
      'saving',
      'saved',
      'conflict',
      'blocked',
      'offline',
      'signed-out',
      'error',
    ] as const) {
      const chip = labelOf({ state, error: state === 'error' ? 'timeout' : undefined })
      expect(chip.label).not.toMatch(/_|signed-out|conflict_|\{|\}/)
      expect(chip.tip).not.toMatch(/\{|\}/)
    }
  })
})

describe('keystore_locked reason', () => {
  it('maps to the keychain-locked reason, not the generic one', () => {
    expect(blockedReasonKey('keystore_locked')).toBe('uwReasonKeystore')
    expect(t(blockedReasonKey('keystore_locked'))).toBe(syncStrings.en.uwReasonKeystore)
    expect(blockedReasonKey('keystore_locked')).not.toBe(blockedReasonKey(undefined))
  })

  it('keeps the existing reasons unchanged', () => {
    expect(blockedReasonKey('forbidden')).toBe('uwReasonForbidden')
    expect(blockedReasonKey('quota_exceeded')).toBe('uwReasonQuota')
    expect(blockedReasonKey(undefined)).toBe('uwReasonOther')
  })
})

describe('store_full reason', () => {
  it('maps to the store-full reason and the full-store sentence', () => {
    expect(blockedReasonKey('store_full')).toBe('uwReasonStoreFull')
    expect(UNIWORK_ERROR_KEYS.store_full).toBe('uwQueueFull')
    expect(t(blockedReasonKey('store_full'))).toBe(syncStrings.en.uwReasonStoreFull)
    expect(blockedReasonKey('store_full')).not.toBe(blockedReasonKey(undefined))
  })

  it('has a sentence for keystore_locked and store_full in every shipped table', () => {
    expect(UNIWORK_ERROR_KEYS.keystore_locked).toBe('uwReasonKeystore')
    for (const lang of ['vi', 'en'] as const) {
      const table = { ...syncStrings[lang], ...uniworkDocumentStrings[lang] } as Record<
        string,
        string
      >
      expect(table[UNIWORK_ERROR_KEYS.keystore_locked]).toBeTruthy()
      expect(table[UNIWORK_ERROR_KEYS.store_full]).toBeTruthy()
    }
  })

  it('shows the blocked chip with the keychain / full-store reason', () => {
    const labelOf = (error: 'keystore_locked' | 'store_full') =>
      chipCopy(chipModelOf(status({ state: 'blocked', error })), t, 'en-US')
    const keystore = labelOf('keystore_locked')
    expect(keystore.label).toContain(syncStrings.en.uwReasonKeystore)
    expect(keystore.title).toContain(syncStrings.en.uwReasonKeystore)
    const full = labelOf('store_full')
    expect(full.label).toContain(syncStrings.en.uwReasonStoreFull)
    expect(full.title).toContain(syncStrings.en.uwQueueFull)
  })
})

describe('G5-06 save queue: states -> chip', () => {
  const chipOf = (s: Partial<UniworkDocStatus>, queuedAt?: string) => {
    const model = chipModelOf(status(s), { needsSignIn: false, queuedAt })
    return { ...model, ...chipCopy(model, t, 'en-US') }
  }
  // uwReasonQuota / TooLarge / Other / Forbidden / Deleted live in the uniwork-documents shard
  const en = { ...syncStrings.en, ...uniworkDocumentStrings.en }

  it.each<[UniworkSaveState, StringKey, StringKey, string]>([
    ['queued', 'uwChipQueued', 'uwTipQueued', 'info'],
    ['paused_offline', 'uwChipQueued', 'uwTipQueued', 'info'],
    ['paused_user', 'uwChipQueued', 'uwTipPausedUser', 'info'],
    ['paused_admin', 'uwChipPausedAdmin', 'uwTipPausedAdmin', 'neutral'],
    ['reconciling', 'uwChipReconciling', 'uwTipReconciling', 'warn'],
    ['reconciling-stuck', 'uwChipReconcileStuck', 'uwTipReconciling', 'warn'],
  ])('%s -> %s / %s (%s)', (state, labelKey, tipKey, tone) => {
    const model = chipModelOf(status({ state }))
    expect(model.labelKey).toBe(labelKey)
    expect(model.tipKey).toBe(tipKey)
    expect(model.tone).toBe(tone)
    // the queue states open the queue popover (G5-06u)
    expect(model.action).toEqual({ kind: 'view-queue', labelKey: 'uwActViewQueue' })
    expect(chipOf({ state }).label).toBe(en[labelKey])
  })

  it('failed reads as the error chip with the reused quota / too-large / other fragment', () => {
    const chip = chipOf({ state: 'failed', error: 'too_large' })
    expect(chip.tone).toBe('error')
    expect(chip.labelKey).toBe('uwChipError')
    expect(chip.tipKey).toBe('uwTipFailed')
    expect(chip.tip).toBe(en.uwTipFailed.replace('{reason}', en.uwReasonTooLarge))
    expect(chipOf({ state: 'failed', error: 'quota_exceeded' }).tip).toContain(en.uwReasonQuota)
    expect(chipOf({ state: 'failed' }).tip).toContain(en.uwReasonOther)
    expect(chipOf({ state: 'failed', error: 'server_error' }).tip).not.toMatch(/\{|\}/)
  })

  it('queued with an unsent N+1 switches to the "queued newer" chip', () => {
    for (const state of ['queued', 'paused_offline', 'paused_user'] as const) {
      expect(chipModelOf(status({ state, pendingNext: true })).labelKey).toBe('uwChipQueuedNewer')
    }
    const chip = chipOf({ state: 'queued', pendingNext: true })
    expect(chip.label).toBe(en.uwChipQueuedNewer)
    expect(chip.tipKey).toBe('uwTipQueuedNewer')
    expect(chipOf({ state: 'queued', pendingNext: false }).labelKey).toBe('uwChipQueued')
    // paused_admin and the reconcile states have no newer variant
    expect(chipModelOf(status({ state: 'paused_admin', pendingNext: true })).labelKey).toBe(
      'uwChipPausedAdmin',
    )
    expect(chipModelOf(status({ state: 'reconciling', pendingNext: true })).labelKey).toBe(
      'uwChipReconciling',
    )
  })

  it('fills the queued tooltip with the time of the waiting save', () => {
    const chip = chipOf({ state: 'queued' }, '2026-05-01T10:00:00Z')
    expect(chip.tip).toMatch(/^Your save from .+ is kept safely/)
    expect(chip.tip).not.toMatch(/\{|\}/)
  })

  it('a queue state wins over View only (the intent was created before access dropped)', () => {
    expect(chipOf({ access: 'view', state: 'queued' }).labelKey).toBe('uwChipQueued')
    expect(chipOf({ access: 'view', state: 'reconciling' }).labelKey).toBe('uwChipReconciling')
  })

  it('never shows an internal code or a placeholder', () => {
    for (const state of [
      'queued',
      'paused_offline',
      'paused_user',
      'paused_admin',
      'reconciling',
      'reconciling-stuck',
    ] as const) {
      const chip = chipOf({ state }, '2026-05-01T10:00:00Z')
      expect(chip.label).not.toMatch(/_|\{|\}/)
      expect(chip.tip).not.toMatch(/\{|\}/)
    }
  })
})

describe('S6 remote-newer chip priority', () => {
  const newerDirty = { kind: 'newer-dirty', version: 4 } as const
  const chip = (s: Partial<UniworkDocStatus>) => chipModelOf(status(s), { needsSignIn: false })

  it('reads "newer version on UniWork" (warn, Resolve -> reload) for a newer-dirty / newer-ai bar', () => {
    const model = chip({ state: 'dirty', remote: newerDirty })
    expect(model).toMatchObject({
      tone: 'warn',
      labelKey: 'uwChipRemoteNewer',
      tipKey: 'uwTipRemoteNewer',
      action: { kind: 'reload', labelKey: 'uwActResolve' },
    })
    expect(chipCopy(model, t, 'en-US').label).toBe(copy.uwChipRemoteNewer)
    // the AI bar: Reload is not available yet, so the pill has no button either
    expect(chip({ state: 'dirty', remote: { kind: 'newer-ai', version: 4 } })).toMatchObject({
      labelKey: 'uwChipRemoteNewer',
      action: undefined,
    })
    // a save in flight or a stuck one: same
    for (const wait of ['commit', 'stuck'] as const) {
      expect(chip({ state: 'dirty', remote: { ...newerDirty, wait } }).action).toBeUndefined()
    }
  })

  it.each<UniworkSaveState>([
    'paused_admin',
    'queued',
    'paused_offline',
    'paused_user',
    'dirty',
    'saving',
    'offline',
    'saved',
    'ready',
  ])('beats %s', (state) => {
    expect(chip({ state, remote: newerDirty }).labelKey).toBe('uwChipRemoteNewer')
  })

  it('beats View only', () => {
    expect(chip({ access: 'view', state: 'saved', remote: newerDirty }).labelKey).toBe(
      'uwChipRemoteNewer',
    )
  })

  it.each<[UniworkSaveState, StringKey]>([
    ['reconciling', 'uwChipReconciling'],
    ['reconciling-stuck', 'uwChipReconcileStuck'],
    ['conflict', 'uwChipConflict'],
    ['blocked', 'uwChipBlocked'],
    ['error', 'uwChipError'],
    ['failed', 'uwChipError'],
    ['signed-out', 'uwChipSignedOut'],
  ])('loses to %s', (state, labelKey) => {
    expect(chip({ state, remote: newerDirty }).labelKey).toBe(labelKey)
  })

  it('only a newer-* bar changes the chip', () => {
    for (const remote of [
      { kind: 'updated', version: 2 },
      { kind: 'now-clean', version: 2 },
      { kind: 'reload-failed', version: 2 },
      { kind: 'revoked' },
      { kind: 'deleted' },
    ] as const) {
      expect(chip({ state: 'dirty', remote }).labelKey).toBe('uwChipDirty')
    }
    expect(chip({ state: 'dirty' }).labelKey).toBe('uwChipDirty')
  })
})

describe('G5-06 error codes -> sentence and reason', () => {
  const en = { ...syncStrings.en, ...uniworkDocumentStrings.en }
  const doc = en

  it.each<[UniworkDocErrorCode, StringKey, StringKey]>([
    ['capability_off', 'uwTipPausedAdmin', 'uwReasonOther'],
    ['intent_unknown', 'uwErrReconcileStuck', 'uwReasonOther'],
    ['document_deleted', 'uwErrDeleted', 'uwReasonDeleted'],
    ['document_archived', 'uwReasonArchived', 'uwReasonArchived'],
    ['permission_revoked', 'uwErrForbidden', 'uwReasonForbidden'],
    ['member_deactivated', 'uwLockDeactivated', 'uwReasonDeactivated'],
    ['organization_suspended', 'uwLockSuspended', 'uwReasonSuspended'],
    ['drafts_full', 'uwConflictDraftCapReached', 'uwReasonOther'],
    ['other_window', 'uwLockOtherWindow', 'uwReasonOther'],
  ])('%s -> sentence %s, blocked reason %s', (code, sentence, reason) => {
    expect(UNIWORK_ERROR_KEYS[code]).toBe(sentence)
    expect(blockedReasonKey(code)).toBe(reason)
    for (const lang of ['vi', 'en'] as const) {
      const table = { ...syncStrings[lang], ...uniworkDocumentStrings[lang] } as Record<
        string,
        string
      >
      expect(table[UNIWORK_ERROR_KEYS[code]]).toBeTruthy()
      expect(table[blockedReasonKey(code)]).toBeTruthy()
    }
  })

  it('reuses the existing deleted / forbidden / suspended / deactivated reasons in the blocked chip', () => {
    const labelOf = (error: UniworkDocErrorCode) =>
      chipCopy(chipModelOf(status({ state: 'blocked', error })), t, 'en-US')
    expect(labelOf('permission_revoked').label).toContain(en.uwReasonForbidden)
    expect(labelOf('permission_revoked').tip).toContain(doc.uwErrForbidden)
    expect(labelOf('document_deleted').label).toContain(en.uwReasonDeleted)
    expect(labelOf('document_deleted').tip).toContain(doc.uwErrDeleted)
    // an archived document is never shown as a deleted one
    expect(labelOf('document_archived').label).toContain(en.uwReasonArchived)
    expect(labelOf('document_archived').label).not.toContain(en.uwReasonDeleted)
    expect(labelOf('document_archived').tip).not.toContain(doc.uwErrDeleted)
    expect(labelOf('organization_suspended').label).toContain(en.uwReasonSuspended)
    expect(labelOf('organization_suspended').tip).toContain(en.uwLockSuspended)
    expect(labelOf('member_deactivated').label).toContain(en.uwReasonDeactivated)
    expect(labelOf('member_deactivated').tip).toContain(en.uwLockDeactivated)
  })

  it('gives the account-side blocks no retry action (a re-check is the Queue row’s)', () => {
    for (const code of [
      'permission_revoked',
      'document_deleted',
      'member_deactivated',
      'organization_suspended',
    ] as const) {
      expect(errorActionOf(code)).toBe('none')
    }
  })
})

describe('errorActionOf', () => {
  it('sign in for an expired session, retry for transport trouble, nothing for a verdict', () => {
    expect(errorActionOf('session_expired')).toBe('sign-in')
    expect(errorActionOf('not_signed_in')).toBe('sign-in')
    for (const e of ['network', 'timeout', 'server_error', 'malformed_response'] as const) {
      expect(errorActionOf(e)).toBe('retry')
    }
    for (const e of [
      'forbidden',
      'not_found',
      'deleted',
      'unsupported_format',
      'ticket_expired',
    ] as const) {
      expect(errorActionOf(e)).toBe('none')
    }
  })
})

describe('launchNoticeOf', () => {
  it('shows progress while opening, with the title when known', () => {
    expect(launchNoticeOf({ phase: 'opening' })).toMatchObject({
      tone: 'busy',
      messageKey: 'uwLaunchOpening',
    })
    expect(launchNoticeOf({ phase: 'opening', title: ' Plan.docx ' })).toMatchObject({
      messageKey: 'uwLaunchOpeningTitle',
      params: { title: 'Plan.docx' },
    })
  })

  it('clears once the document opened', () => {
    expect(launchNoticeOf({ phase: 'opened', path: 'C:\\x.docx', title: 'x' })).toBeNull()
  })

  it('asks to sign in and stays until acted on', () => {
    const notice = launchNoticeOf({ phase: 'needs-sign-in' })
    expect(notice).toMatchObject({ tone: 'warn', signIn: true })
    expect(notice?.autoHideMs).toBeUndefined()
  })

  it('has copy per failure code; the expired link says to open it again from UniWork', () => {
    const expired = launchNoticeOf({ phase: 'failed', error: 'ticket_expired' })
    expect(t(expired!.messageKey)).toBe('This link expired. Open the document again from UniWork.')
    expect(expired).toMatchObject({ tone: 'error', signIn: false })
    expect(expired!.autoHideMs).toBeGreaterThan(0)
    const invalid = launchNoticeOf({ phase: 'failed', error: 'ticket_invalid' })
    expect(t(invalid!.messageKey)).toContain('no longer valid')
    expect(launchNoticeOf({ phase: 'failed', error: 'session_expired' })?.signIn).toBe(true)
    expect(launchNoticeOf({ phase: 'failed', error: 'forbidden' })?.signIn).toBe(false)
  })
})

describe('openCardOf: the card is always there, the call to action follows the account', () => {
  it.each([
    ['signed-in', 'picker', false],
    ['refreshing', 'picker', false],
    ['server-unreachable', 'picker', false],
    ['loading', 'picker', false],
    ['signed-out', 'sign-in', true],
    ['session-expired', 'sign-in', true],
    ['session-revoked', 'sign-in', true],
    ['signing-in', 'none', false],
    ['not-configured', 'settings', true],
    ['wrong-deployment', 'settings', true],
    ['keyring-unavailable', 'settings', true],
    ['keystore-locked', 'settings', true],
  ] as const)('%s -> %s', (view, action, attention) => {
    const card = openCardOf(view)
    expect(card.action).toBe(action)
    expect(card.attention).toBe(attention)
    expect(t(card.subKey)).not.toBe(card.subKey)
  })

  it('says what to do in each unsigned state', () => {
    expect(t(openCardOf('signed-out').subKey)).toBe('Sign in to open')
    expect(t(openCardOf('session-expired').subKey)).toBe('Sign in again to open')
    expect(t(openCardOf('not-configured').subKey)).toBe('UniWork sign-in is not set up here')
  })
})

describe('picker reducer', () => {
  const run = (actions: PickerAction[], from: PickerState = initialPickerState()) =>
    actions.reduce(pickerReducer, from)
  const workspaces = [
    { id: 'w1', name: 'Team', orgId: 'o1', myRole: null },
    { id: 'w2', name: 'Sales', orgId: 'o1', myRole: null },
  ]
  const loadedWorkspaces: PickerAction = {
    type: 'workspaces-loaded',
    result: { ok: true, value: workspaces },
  }
  const page = (docs: UniworkDocSummary[], nextCursor: string | null = null) => ({
    ok: true as const,
    value: { documents: docs, nextCursor },
  })

  it('starts loading, selects the first workspace and starts the first list fetch', () => {
    const s0 = initialPickerState()
    expect(pickerBodyOf(s0)).toEqual({ kind: 'loading' })
    const s1 = run([loadedWorkspaces])
    expect(s1.workspaceId).toBe('w1')
    expect(s1.list.requestId).toBe(1)
    expect(pickerBodyOf(s1)).toEqual({ kind: 'loading' })
  })

  it('shows the no-workspaces state when the account has none', () => {
    const s = run([{ type: 'workspaces-loaded', result: { ok: true, value: [] } }])
    expect(pickerBodyOf(s)).toEqual({ kind: 'no-workspaces' })
    expect(s.workspaceId).toBeNull()
  })

  it('lists documents and highlights the first one that can be opened', () => {
    const docs = [
      doc('a', 'Photo.png', null),
      doc('b', 'Plan.docx', 'docx'),
      doc('c', 'Sheet.xlsx', 'xlsx'),
    ]
    const s = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: page(docs) },
    ])
    expect(pickerBodyOf(s)).toEqual({ kind: 'list' })
    expect(s.activeId).toBe('b')
  })

  it('drops an answer for an older request (workspace switched while loading)', () => {
    const s = run([
      loadedWorkspaces,
      { type: 'select-workspace', id: 'w2' },
      {
        type: 'list-loaded',
        requestId: 1,
        append: false,
        result: page([doc('x', 'Old.docx', 'docx')]),
      },
    ])
    expect(s.list.requestId).toBe(2)
    expect(s.list.docs).toEqual([])
    expect(s.list.status).toBe('loading')
  })

  it('a new search starts a fresh list and distinguishes empty from no results', () => {
    const loaded = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: page([]) },
    ])
    expect(pickerBodyOf(loaded)).toEqual({ kind: 'empty' })
    const searching = run([{ type: 'set-query', query: 'plan' }], loaded)
    expect(searching.list.requestId).toBe(2)
    const none = run(
      [{ type: 'list-loaded', requestId: 2, append: false, result: page([]) }],
      searching,
    )
    expect(pickerBodyOf(none)).toEqual({ kind: 'no-results', query: 'plan' })
  })

  it('ignores a search that did not change the committed text', () => {
    const s = run([loadedWorkspaces])
    expect(pickerReducer(s, { type: 'set-query', query: '' })).toBe(s)
  })

  it('appends the next page, keeps the highlight, and clears the cursor at the end', () => {
    const first = [doc('a', 'A.docx', 'docx')]
    const second = [doc('b', 'B.pdf', 'pdf')]
    let s = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: page(first, 'cur1') },
      { type: 'load-more' },
    ])
    expect(s.list.loadingMore).toBe(true)
    // a second click while loading does not start another fetch
    expect(pickerReducer(s, { type: 'load-more' })).toBe(s)
    s = run([{ type: 'list-loaded', requestId: 1, append: true, result: page(second) }], s)
    expect(s.list.docs.map((d) => d.id)).toEqual(['a', 'b'])
    expect(s.list.nextCursor).toBeNull()
    expect(s.list.loadingMore).toBe(false)
    expect(s.activeId).toBe('a')
  })

  it('a failed Load more keeps the rows and reports the error under them', () => {
    const s = run([
      loadedWorkspaces,
      {
        type: 'list-loaded',
        requestId: 1,
        append: false,
        result: page([doc('a', 'A.docx', 'docx')], 'c'),
      },
      { type: 'load-more' },
      { type: 'list-loaded', requestId: 1, append: true, result: { ok: false, error: 'network' } },
    ])
    expect(pickerBodyOf(s)).toEqual({ kind: 'list' })
    expect(s.list.moreError).toBe('network')
    expect(s.list.loadingMore).toBe(false)
    expect(s.list.nextCursor).toBe('c')
  })

  it.each([
    ['network', 'retry'],
    ['server_error', 'retry'],
    ['session_expired', 'sign-in'],
    ['forbidden', 'none'],
  ] as const)('a list failure with %s offers %s', (error, action) => {
    const s = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: { ok: false, error } },
    ])
    expect(pickerBodyOf(s)).toEqual({ kind: 'error', error, action })
  })

  it('Retry reloads the list; after a workspace-list failure it reloads the workspaces', () => {
    const listFailed = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: { ok: false, error: 'timeout' } },
    ])
    expect(retryActionOf(listFailed)).toEqual({ type: 'list-retry' })
    const again = run([{ type: 'list-retry' }], listFailed)
    expect(again.list.requestId).toBe(2)
    expect(pickerBodyOf(again)).toEqual({ kind: 'loading' })

    const wsFailed = run([{ type: 'workspaces-loaded', result: { ok: false, error: 'network' } }])
    expect(pickerBodyOf(wsFailed)).toEqual({ kind: 'error', error: 'network', action: 'retry' })
    expect(retryActionOf(wsFailed)).toEqual({ type: 'workspaces-retry' })
    expect(pickerBodyOf(run([{ type: 'workspaces-retry' }], wsFailed))).toEqual({ kind: 'loading' })
  })

  it('opening is one at a time; a failure is kept inline and can be cleared', () => {
    let s = run([{ type: 'open-start', id: 'a', title: 'A.docx' }])
    expect(s.opening).toEqual({ id: 'a', title: 'A.docx' })
    expect(pickerReducer(s, { type: 'open-start', id: 'b', title: 'B' })).toBe(s)
    s = run([{ type: 'open-failed', error: 'session_expired' }], s)
    expect(s.opening).toBeNull()
    expect(s.openError).toBe('session_expired')
    expect(run([{ type: 'clear-open-error' }], s).openError).toBeNull()
    // a new attempt clears the previous error
    expect(run([{ type: 'open-start', id: 'a', title: 'A' }], s).openError).toBeNull()
  })

  it('keeps the same workspace when the workspace list reloads', () => {
    const s = run([loadedWorkspaces, { type: 'select-workspace', id: 'w2' }, loadedWorkspaces])
    expect(s.workspaceId).toBe('w2')
  })
})

describe('keyboard navigation skips documents that cannot be opened', () => {
  const docs = [doc('a', 'A.docx', 'docx'), doc('x', 'Pic.png', null), doc('b', 'B.pdf', 'pdf')]

  it('moves over openable rows only', () => {
    expect(moveActive(docs, 'a', 'next')).toBe('b')
    expect(moveActive(docs, 'b', 'next')).toBe('b')
    expect(moveActive(docs, 'b', 'prev')).toBe('a')
    expect(moveActive(docs, 'a', 'prev')).toBe('a')
    expect(moveActive(docs, null, 'next')).toBe('a')
    expect(moveActive(docs, 'a', 'last')).toBe('b')
    expect(moveActive(docs, 'b', 'first')).toBe('a')
  })

  it('has no highlight when nothing can be opened', () => {
    expect(moveActive([doc('x', 'Pic.png', null)], null, 'next')).toBeNull()
    expect(moveActive([], null, 'first')).toBeNull()
  })

  it('classifies formats: only the six office formats open', () => {
    expect(isOpenable(doc('a', 'A.docx', 'docx'))).toBe(true)
    expect(isOpenable(doc('x', 'Pic.png', null))).toBe(false)
    expect(docExtension(doc('x', 'Pic.PNG', null))).toBe('png')
    expect(docExtension(doc('x', 'README', null))).toBe('')
    expect(docExtension(doc('a', 'Notes', 'md'))).toBe('md')
  })

  it('debounces the search long enough to ride out typing', () => {
    expect(PICKER_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(200)
  })
})

describe('time and path helpers', () => {
  const now = new Date('2026-05-01T18:00:00')

  it('formats today as a time and other days as a date; empty when unusable', () => {
    expect(formatWhen('2026-05-01T09:30:00', 'en-US', now)).toMatch(/9:30/)
    expect(formatWhen('2026-04-02T09:30:00', 'en-US', now)).toMatch(/Apr/)
    expect(formatWhen('not a date', 'en-US', now)).toBe('')
  })

  it('reads dates by the shared list rule (24h clock, yesterday, short day, year)', () => {
    expect(formatWhen('2026-05-01T09:30:00', 'en-US', now)).toBe('09:30')
    expect(formatWhen('2026-04-30T16:30:00', 'en-US', now)).toBe('Yesterday, 16:30')
    expect(formatWhen('2026-04-30T16:30:00', 'vi-VN', now)).toBe('Hôm qua, 16:30')
    expect(formatWhen('2026-04-02T09:30:00', 'en-US', now)).toBe('Apr 2')
    expect(formatWhen('2026-04-02T09:30:00', 'vi-VN', now)).toBe('02/04')
    expect(formatWhen('2025-10-18T09:30:00', 'en-US', now)).toBe('Oct 18, 2025')
    expect(formatWhen('2025-10-18T09:30:00', 'vi-VN', now)).toBe('18/10/2025')
  })

  it('compares Windows paths regardless of slash direction and drive-letter case', () => {
    expect(pathKey('C:\\Users\\a\\X.docx')).toBe(pathKey('c:/Users/a/X.docx'))
    expect(pathKey('/home/a/X.docx')).not.toBe(pathKey('/home/a/x.docx'))
  })

  it('is the one shared implementation, so main and the renderer key a path alike (R1-be-10)', async () => {
    // the renderer re-exports the shared function; main imports the same module
    const { pathKey: sharedPathKey } = await import('../src/shared/path-key')
    expect(pathKey).toBe(sharedPathKey)
    const { pathKey: modelPathKey } = await import('../src/renderer/src/uniwork-docs-model')
    expect(modelPathKey).toBe(sharedPathKey)
  })
})

describe('openRecentEntry', () => {
  const local: RecentEntry = {
    path: 'C:\\docs\\a.docx',
    name: 'a.docx',
    ext: 'docx',
    mtimeMs: 1,
    sizeBytes: 1,
  } as RecentEntry
  const bound: RecentEntry = {
    ...local,
    path: 'C:\\ud\\uniwork-documents\\dep\\u\\d1\\Plan.docx',
    name: 'Plan.docx',
    uniwork: { documentId: 'd1', workspaceId: 'w1', title: 'Plan', access: 'edit' },
  }

  it('opens a local file by path, exactly as before, with no UniWork call', async () => {
    const api = { openPath: vi.fn(async () => undefined), uniworkOpenDocument: vi.fn() }
    const notify = vi.fn()
    await openRecentEntry(local, api as never, notify)
    expect(api.openPath).toHaveBeenCalledWith(local.path)
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('opens a UniWork recent through UniWork by document id, never by its path', async () => {
    const api = {
      openPath: vi.fn(),
      uniworkOpenDocument: vi.fn(async () => ({ ok: true as const, value: { path: bound.path } })),
    }
    const notify = vi.fn()
    await openRecentEntry(bound, api as never, notify)
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(api.openPath).not.toHaveBeenCalled()
    expect(notify.mock.calls.map((c) => c[0].phase)).toEqual(['opening', 'opened'])
  })

  it('reports a refusal and a rejected call as failures the person can read', async () => {
    const refused = {
      openPath: vi.fn(),
      uniworkOpenDocument: vi.fn(async () => ({ ok: false as const, error: 'not_found' as const })),
    }
    const notify = vi.fn()
    await openRecentEntry(bound, refused as never, notify)
    expect(notify).toHaveBeenLastCalledWith({ phase: 'failed', error: 'not_found' })

    const broken = {
      openPath: vi.fn(),
      uniworkOpenDocument: vi.fn(async () => Promise.reject(new Error('ipc'))),
    }
    const notify2 = vi.fn()
    await openRecentEntry(bound, broken as never, notify2)
    expect(notify2).toHaveBeenLastCalledWith({ phase: 'failed', error: 'network' })
  })
})

describe('openUniworkDocument', () => {
  it('opens a cloud document by id and reports progress in the notice', async () => {
    const api = {
      uniworkOpenDocument: vi.fn(async () => ({
        ok: true as const,
        value: { path: '/w/Plan.docx' },
      })),
    }
    const notify = vi.fn()
    await openUniworkDocument({ documentId: 'd1', title: 'Plan' }, api as never, notify)
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(notify.mock.calls.map((c) => c[0])).toEqual([
      { phase: 'opening', title: 'Plan' },
      { phase: 'opened', path: '/w/Plan.docx', title: 'Plan' },
    ])
  })
})

describe('recentRowPolicy', () => {
  it('a local row keeps every file action exactly as before', () => {
    expect(recentRowPolicy({})).toEqual({
      badge: false,
      selectable: true,
      draggable: true,
      showLocation: true,
      fileActions: true,
    })
  })

  it('a UniWork row has a badge and none of Show in folder, rename, delete, move, drag or bulk select', () => {
    expect(
      recentRowPolicy({
        uniwork: { documentId: 'd1', workspaceId: 'w1', title: 'Plan', access: 'view' },
      }),
    ).toEqual({
      badge: true,
      selectable: false,
      draggable: false,
      showLocation: false,
      fileActions: false,
    })
  })
})

describe('a UniWork recent whose working copy is gone', () => {
  const uniwork = { documentId: 'd1', workspaceId: 'w1', title: 'Plan', access: 'edit' as const }

  it('is not "missing": opening it downloads the document again', () => {
    expect(recentRowIsMissing({ missing: true, uniwork })).toBe(false)
    expect(recentRowIsMissing({ missing: true })).toBe(true)
    expect(recentRowIsMissing({ missing: false })).toBe(false)
    expect(recentRowIsMissing({})).toBe(false)
  })

  it('a click on it opens it (a fresh download), a local missing file asks first', () => {
    expect(recentOpenAction({ missing: true, uniwork })).toBe('open')
    expect(recentOpenAction({ missing: true })).toBe('confirm-missing')
    expect(recentOpenAction({})).toBe('open')
  })

  it("shows no Modified time: the working copy's file time is the download time", () => {
    expect(recentRowModifiedMs({ mtimeMs: 123, uniwork })).toBeNull()
    expect(recentRowModifiedMs({ mtimeMs: 123, missing: true })).toBeNull()
    expect(recentRowModifiedMs({ mtimeMs: 123 })).toBe(123)
  })
})

describe('recents refresh after a UniWork document opens', () => {
  function setup() {
    let push: ((event: { phase: string }) => void) | null = null
    const offMain = vi.fn()
    const api = {
      onUniworkLaunch: vi.fn((cb: (event: never) => void) => {
        push = cb as never
        return offMain
      }),
    }
    const refresh = vi.fn()
    const off = subscribeUniworkOpened(api, refresh)
    return { api, refresh, off, offMain, push: (event: { phase: string }) => push!(event) }
  }

  it('refreshes when the picker or a recents row reports an opened document', () => {
    const { refresh, off } = setup()
    publishUniworkNotice({ phase: 'opened', path: 'C:\\w\\Plan.docx', title: 'Plan' })
    expect(refresh).toHaveBeenCalledTimes(1)
    off()
  })

  it('refreshes when main reports a document opened from the web', () => {
    const { refresh, push, off } = setup()
    push({ phase: 'opened' })
    expect(refresh).toHaveBeenCalledTimes(1)
    off()
  })

  it('ignores opening, sign-in and failure events', () => {
    const { refresh, push, off } = setup()
    publishUniworkNotice({ phase: 'opening', title: 'Plan' })
    publishUniworkNotice({ phase: 'failed', error: 'network' })
    push({ phase: 'needs-sign-in' })
    expect(refresh).not.toHaveBeenCalled()
    off()
  })

  it('stops listening once unsubscribed', () => {
    const { refresh, off, offMain } = setup()
    off()
    expect(offMain).toHaveBeenCalledTimes(1)
    publishUniworkNotice({ phase: 'opened', path: 'p', title: 'Plan' })
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('FD-14: the picker lists only what UniWork Office opens', () => {
  const run = (actions: PickerAction[], from: PickerState = initialPickerState()) =>
    actions.reduce(pickerReducer, from)
  const loadedWorkspaces: PickerAction = {
    type: 'workspaces-loaded',
    result: { ok: true, value: [{ id: 'w1', name: 'Team', orgId: 'o1', myRole: null }] },
  }
  const page = (list: UniworkDocSummary[]) => ({
    ok: true as const,
    value: { documents: list, nextCursor: null },
  })
  const docs = [
    doc('p', 'Photo.png', null),
    doc('a', 'Plan.docx', 'docx'),
    doc('n', 'Notes.zip', null),
    { ...doc('o', 'Old.docx', 'docx'), archived: true } as UniworkDocSummary,
    doc('c', 'Sheet.xlsx', 'xlsx'),
  ]
  const loaded = (list: UniworkDocSummary[]) =>
    run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: page(list) },
    ])

  it('drops non-openable rows but keeps archived ones, and counts what it hid', () => {
    const s = loaded(docs)
    expect(visibleDocs(s).map((d) => d.id)).toEqual(['a', 'o', 'c'])
    expect(hiddenDocCount(s)).toBe(2)
    expect(s.activeId).toBe('a')
  })

  it('walks the keyboard over the visible rows only', () => {
    const s = loaded(docs)
    const shown = visibleDocs(s)
    expect(moveActive(shown, 'a', 'next')).toBe('o')
    expect(moveActive(shown, 'o', 'next')).toBe('c')
    expect(moveActive(shown, 'c', 'last')).toBe('c')
    expect(moveActive(shown, 'c', 'first')).toBe('a')
  })

  it('counts nothing hidden when every row opens', () => {
    expect(hiddenDocCount(loaded([doc('a', 'A.docx', 'docx')]))).toBe(0)
    expect(hiddenDocCount(loaded([]))).toBe(0)
  })

  it('shows the empty state, with a hidden count, when every row is hidden', () => {
    const s = loaded([doc('p', 'Photo.png', null), doc('n', 'Notes.zip', null)])
    expect(visibleDocs(s)).toEqual([])
    expect(hiddenDocCount(s)).toBe(2)
    expect(pickerBodyOf(s)).toEqual({ kind: 'empty' })
    expect(s.activeId).toBeNull()
  })

  it('counts only rows that match the shared-list search', () => {
    let s = run([loadedWorkspaces, { type: 'select-shared' }])
    s = run(
      [
        { type: 'list-loaded', requestId: s.list.requestId, append: false, result: page(docs) },
        { type: 'set-query', query: 'photo' },
      ],
      s,
    )
    // the search narrows to the hidden png: nothing shows, one row is hidden
    expect(visibleDocs(s)).toEqual([])
    expect(hiddenDocCount(s)).toBe(1)
    expect(pickerBodyOf(s)).toEqual({ kind: 'no-results', query: 'photo' })
  })
})
