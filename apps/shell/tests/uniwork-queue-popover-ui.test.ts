// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/sync/en'
import { en as enDocs } from '../src/renderer/src/i18n/uniwork-documents/en'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { UniworkQueuePopover } from '../src/renderer/src/UniworkQueuePopover'
import {
  TOP_INSET_MAX,
  setTopInsetPart,
  topInsetTotal,
} from '../src/renderer/src/uniwork-top-inset'
import {
  failedReasonKeyOf,
  findQueueRow,
  formatQueueTime,
  isQueuePopoverState,
  queuePopoverModelOf,
  QUEUE_BAND_SETTLE_MS,
} from '../src/renderer/src/queue-popover-model'
import { BLOCKED_REASONS, blockedCopy } from '../src/renderer/src/sync-center-model'
import { blockedReasonKey, chipModelOf } from '../src/renderer/src/uniwork-docs-model'
import type { UniworkDocStatus } from '../src/shared/home-api'
import { SYNC_CENTER_BLOCKED_REASONS } from '../src/shared/sync-center'
import type {
  SyncCenterActionResult,
  SyncCenterBlockedReason,
  SyncCenterRow,
  SyncCenterSnapshot,
  UniworkSyncCenterApi,
} from '../src/shared/sync-center'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SAVED_AT = '2026-03-02T08:30:00Z'

function makeStatus(over: Partial<UniworkDocStatus> = {}): UniworkDocStatus {
  return {
    path: '/work/contract.docx',
    documentId: 'doc-1',
    workspaceId: 'ws-1',
    title: 'Contract.docx',
    format: 'docx',
    access: 'edit',
    state: 'queued',
    ...over,
  } as UniworkDocStatus
}

function makeRow(over: Partial<SyncCenterRow> = {}): SyncCenterRow {
  return {
    id: 'row-1',
    documentId: 'doc-1',
    documentKey: 'key-1',
    title: 'Contract.docx',
    ext: 'docx',
    state: 'queued',
    savedAt: SAVED_AT,
    base: 7,
    canEdit: true,
    ...over,
  }
}

function makeSnapshot(
  pending: SyncCenterRow[],
  attention: SyncCenterRow[] = [],
): SyncCenterSnapshot {
  return {
    header: { status: 'online' },
    storeError: false,
    tabs: { attention, pending, recent: [] },
    defaultTab: attention.length > 0 ? 'attention' : 'pending',
  } as unknown as SyncCenterSnapshot
}

const OK: SyncCenterActionResult = { ok: true }

describe('queue popover model (S4)', () => {
  it('finds the row of a document in pending, then attention', () => {
    const pending = makeRow({ id: 'p' })
    const attention = makeRow({ id: 'a', state: 'failed' })
    expect(findQueueRow(makeSnapshot([pending], [attention]), 'doc-1')?.id).toBe('p')
    expect(findQueueRow(makeSnapshot([], [attention]), 'doc-1')?.id).toBe('a')
    expect(findQueueRow(makeSnapshot([pending]), 'doc-1')?.id).toBe('p')
    expect(findQueueRow(makeSnapshot([pending]), 'other')).toBeUndefined()
    expect(findQueueRow(null, 'doc-1')).toBeUndefined()
  })

  describe('RFE6u4-01: one blocked-reason copy, the sync center own (blockedCopy)', () => {
    const reasons = Object.keys(BLOCKED_REASONS) as SyncCenterBlockedReason[]

    it('knows every reason main knows', () => {
      expect(reasons.length).toBeGreaterThan(0)
      expect([...reasons].sort()).toEqual([...SYNC_CENTER_BLOCKED_REASONS].sort())
    })

    it('line 3 of a blocked save is blockedCopy(reason).reasonKey for every reason', () => {
      for (const reason of reasons) {
        const model = queuePopoverModelOf(
          makeStatus({ state: 'blocked', error: 'session_expired' }),
          makeRow({ state: 'blocked', blockedReason: reason }),
          'pill',
        )
        expect(model.line3, reason).toMatchObject({
          key: 'uwRowBlocked',
          reasonKey: blockedCopy(reason).reasonKey,
        })
      }
    })

    it('a reason main does not know reads the sync center fallback, like its rows', () => {
      const model = queuePopoverModelOf(
        makeStatus({ state: 'blocked', error: 'session_expired' }),
        makeRow({ state: 'blocked', blockedReason: 'from_the_future' as SyncCenterBlockedReason }),
        'pill',
      )
      expect(model.line3?.reasonKey).toBe(blockedCopy('from_the_future').reasonKey)
      expect(model.line3?.reasonKey).toBe('uwReasonOther')
    })

    it('without a row reason the status error code still decides (unchanged)', () => {
      for (const error of ['session_expired', 'not_signed_in', 'keystore_locked'] as const) {
        const model = queuePopoverModelOf(makeStatus({ state: 'blocked', error }), undefined, 'pill')
        const reason = error === 'not_signed_in' ? 'signed_out' : error
        expect(model.line3?.reasonKey, error).toBe(blockedCopy(reason).reasonKey)
      }
      const other = queuePopoverModelOf(
        makeStatus({ state: 'blocked', error: 'network' }),
        undefined,
        'pill',
      )
      expect(other.line3?.reasonKey).toBe(blockedReasonKey('network'))
    })

    it('a store refusal reads blockedCopy too, and the pill chip says the same word', () => {
      const keystore = queuePopoverModelOf(
        makeStatus({ state: 'error', error: 'keystore_locked' }),
        undefined,
        'ctrl-s',
      )
      expect(keystore.line1.reasonKey).toBe(blockedCopy('keystore_locked').reasonKey)
      for (const error of ['keystore_locked', 'store_full', 'session_expired'] as const) {
        const chip = chipModelOf(makeStatus({ state: 'blocked', error }))
        expect(chip.reasonKey, error).toBe(blockedCopy(error).reasonKey)
      }
    })

    it('the model keeps no reason-copy table of its own', () => {
      const source = readFileSync(
        resolve(__dirname, '../src/renderer/src/queue-popover-model.ts'),
        'utf8',
      )
      expect(source).not.toMatch(/BLOCKED_REASON_KEY/)
      expect(source).not.toMatch(/second lander deletes this map/)
      expect(source).toMatch(/blockedCopy/)
    })
  })

  it('knows which statuses show the popover', () => {
    for (const state of [
      'queued',
      'paused_offline',
      'paused_user',
      'paused_admin',
      'reconciling',
      'reconciling-stuck',
      'blocked',
      'failed',
      'saving',
    ] as const) {
      expect(isQueuePopoverState(makeStatus({ state }))).toBe(true)
    }
    expect(isQueuePopoverState(makeStatus({ state: 'error', error: 'store_full' }))).toBe(true)
    expect(isQueuePopoverState(makeStatus({ state: 'error', error: 'keystore_locked' }))).toBe(true)
    for (const state of ['ready', 'saved', 'dirty', 'offline', 'conflict', 'signed-out'] as const) {
      expect(isQueuePopoverState(makeStatus({ state }))).toBe(false)
    }
    expect(isQueuePopoverState(makeStatus({ state: 'error', error: 'network' }))).toBe(false)
  })

  it('line 1 is waiting-with-time+base for a row, the blocked-save sentence without one or from Ctrl/Cmd+S', () => {
    const waiting = queuePopoverModelOf(makeStatus(), makeRow(), 'pill')
    expect(waiting.line1).toMatchObject({ key: 'uwQueuePopWaiting', time: SAVED_AT, base: 7 })
    expect(queuePopoverModelOf(makeStatus(), undefined, 'pill').line1.key).toBe(
      'uwQueueBlockedSave',
    )
    expect(queuePopoverModelOf(makeStatus(), makeRow(), 'ctrl-s').line1.key).toBe(
      'uwQueueBlockedSave',
    )
  })

  it('line 2 only with a newer unsent edit; line 3 only when blocked', () => {
    expect(queuePopoverModelOf(makeStatus(), makeRow(), 'pill').line2).toBeUndefined()
    expect(
      queuePopoverModelOf(makeStatus({ pendingNext: true }), makeRow(), 'pill').line2?.key,
    ).toBe('uwQueuePopNewer')
    expect(queuePopoverModelOf(makeStatus(), makeRow(), 'pill').line3).toBeUndefined()
    const blocked = queuePopoverModelOf(
      makeStatus({ state: 'blocked', error: 'permission_revoked' }),
      makeRow({ state: 'blocked', blockedReason: 'permission_revoked' }),
      'pill',
    )
    expect(blocked.line3).toMatchObject({ key: 'uwRowBlocked', reasonKey: 'uwReasonForbidden' })
  })

  it('a store refusal reads as the reason alone (store_full: the full-store sentence)', () => {
    const keystore = queuePopoverModelOf(
      makeStatus({ state: 'error', error: 'keystore_locked' }),
      undefined,
      'ctrl-s',
    )
    expect(keystore.line1).toMatchObject({ key: 'uwRowBlocked', reasonKey: 'uwReasonKeystore' })
    expect(keystore.line3).toBeUndefined()
    const full = queuePopoverModelOf(
      makeStatus({ state: 'error', error: 'store_full' }),
      undefined,
      'ctrl-s',
    )
    expect(full.line1.key).toBe('uwQueueFull')
    expect(full.actions.map((a) => a.id)).toEqual(['open-center'])
  })

  it('failed: line 1 is the failed tip with the reason, Save again then Cancel then the center', () => {
    const model = queuePopoverModelOf(
      makeStatus({ state: 'failed' }),
      makeRow({ state: 'failed', failedReason: 'quota' }),
      'pill',
    )
    expect(model.line1).toMatchObject({ key: 'uwTipFailed', reasonKey: 'uwReasonQuota' })
    expect(model.actions.map((a) => a.id)).toEqual(['save-again', 'cancel', 'open-center'])
  })

  it('RFE6u-07: one failed-reason source: the row when there is one, else the status code', () => {
    const status = makeStatus({ state: 'failed', error: 'too_large' })
    expect(failedReasonKeyOf(status, makeRow({ state: 'failed', failedReason: 'quota' }))).toBe(
      'uwReasonQuota',
    )
    expect(failedReasonKeyOf(status, undefined)).toBe('uwReasonTooLarge')
    expect(queuePopoverModelOf(status, undefined, 'pill').line1.reasonKey).toBe('uwReasonTooLarge')
  })

  it('Cancel only in the cancellable states and only when a row id is known', () => {
    const ids = (state: UniworkDocStatus['state'], row?: SyncCenterRow) =>
      queuePopoverModelOf(makeStatus({ state }), row, 'pill').actions.map((a) => a.id)
    for (const state of ['queued', 'paused_offline', 'paused_user', 'paused_admin'] as const) {
      expect(ids(state, makeRow({ state }))).toEqual(['cancel', 'open-center'])
    }
    for (const state of ['saving', 'reconciling', 'reconciling-stuck', 'blocked'] as const) {
      expect(ids(state, makeRow())).toEqual(['open-center'])
    }
    expect(ids('queued', undefined)).toEqual(['open-center'])
  })

  it('a blocked reason offers its own next step, at most three actions', () => {
    const blocked = (reason: SyncCenterRow['blockedReason'], error: UniworkDocStatus['error']) =>
      queuePopoverModelOf(
        makeStatus({ state: 'blocked', error }),
        makeRow({ state: 'blocked', blockedReason: reason }),
        'pill',
      ).actions
    expect(blocked('session_expired', 'session_expired')[0]).toEqual({
      id: 'sign-in-again',
      labelKey: 'uwActSignInAgain',
    })
    expect(blocked('signed_out', 'not_signed_in')[0]).toEqual({
      id: 'sign-in',
      labelKey: 'acctSignIn',
    })
    expect(blocked('permission_revoked', 'forbidden')[0]).toEqual({
      id: 'recheck',
      labelKey: 'uwActRecheck',
    })
    expect(blocked('store_full', 'store_full').map((a) => a.id)).toEqual(['open-center'])
    for (const reason of [
      'session_expired',
      'signed_out',
      'foreign_account',
      'permission_revoked',
      'lease_expired',
      'keystore_locked',
      'store_newer',
    ] as const) {
      expect(blocked(reason, undefined).length).toBeLessThanOrEqual(3)
    }
  })
})

describe('UniworkQueuePopover (S4)', () => {
  let hostEl: HTMLDivElement
  let root: Root
  let snapshot: SyncCenterSnapshot
  let pushSnapshot: ((snap: SyncCenterSnapshot) => void) | null
  let api: {
    [K in keyof UniworkSyncCenterApi]: ReturnType<typeof vi.fn>
  }
  let onClose: ReturnType<typeof vi.fn>
  let onSignIn: ReturnType<typeof vi.fn>
  let onFocusEditor: ReturnType<typeof vi.fn>
  let openSettings: ReturnType<typeof vi.fn>

  const polite = () => document.querySelector('#uw-live-host [role=status]')?.textContent ?? ''
  const assertive = () => document.querySelector('#uw-live-host [role=alert]')?.textContent ?? ''
  const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null
  const buttons = () =>
    Array.from(dialog()?.querySelectorAll('button') ?? []) as HTMLButtonElement[]
  const buttonByText = (text: string) => buttons().find((b) => b.textContent === text)

  function Harness({
    status,
    opener = 'pill',
    initiallyOpen = true,
  }: {
    status: UniworkDocStatus
    opener?: 'pill' | 'ctrl-s'
    initiallyOpen?: boolean
  }) {
    const [open, setOpen] = useState(initiallyOpen)
    const groupRef = useRef<HTMLDivElement>(null)
    const openerRef = useRef<HTMLButtonElement>(null)
    return createElement(
      LocaleProvider,
      { initial: 'en' },
      createElement(UniworkLiveHost),
      createElement('div', { id: 'editor', tabIndex: -1 }),
      createElement(
        'div',
        { ref: groupRef, id: 'pill-group', tabIndex: -1 },
        createElement(
          'button',
          { id: 'pill-view-queue', ref: openerRef, type: 'button', onClick: () => setOpen(true) },
          'View queue',
        ),
      ),
      open
        ? createElement(UniworkQueuePopover, {
            status,
            opener,
            anchorEl: groupRef.current,
            openerEl: opener === 'pill' ? openerRef.current : null,
            onClose: () => {
              onClose()
              setOpen(false)
            },
            onSignIn: () => onSignIn(),
            onFocusEditor: () => onFocusEditor(),
          })
        : null,
    )
  }

  async function mount(
    status: UniworkDocStatus,
    opts: { opener?: 'pill' | 'ctrl-s'; initiallyOpen?: boolean } = {},
  ) {
    await act(async () => {
      root.render(createElement(Harness, { status, ...opts }))
    })
    await act(async () => {})
  }

  beforeEach(() => {
    localStorage.setItem('uniwork-ui-lang', 'en')
    resetLiveForTests()
    snapshot = makeSnapshot([makeRow()])
    pushSnapshot = null
    onClose = vi.fn()
    onSignIn = vi.fn()
    onFocusEditor = vi.fn()
    openSettings = vi.fn()
    window.addEventListener('uniwork:open-settings', openSettings as EventListener)
    const fn = () => vi.fn(async (): Promise<SyncCenterActionResult> => OK)
    api = {
      getSnapshot: vi.fn(async () => snapshot),
      syncNow: fn(),
      setSendingPaused: fn(),
      sendNow: fn(),
      cancelSave: fn(),
      recheck: fn(),
      copySupportCode: fn(),
      discardSave: fn(),
      openDocument: fn(),
      openDraft: fn(),
      discardDraft: fn(),
      saveAgain: fn(),
      saveMyCopy: fn(),
      retryStore: fn(),
      subscribe: vi.fn((cb: (snap: SyncCenterSnapshot) => void) => {
        pushSnapshot = cb
        return () => {
          if (pushSnapshot === cb) pushSnapshot = null
        }
      }),
    } as typeof api
    ;(window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter = api
    hostEl = document.createElement('div')
    document.body.appendChild(hostEl)
    root = createRoot(hostEl)
  })

  afterEach(() => {
    act(() => root.unmount())
    hostEl.remove()
    document.body.innerHTML = ''
    window.removeEventListener('uniwork:open-settings', openSettings as EventListener)
    delete (window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter
  })

  it('opens as a non-modal dialog labelled by line 1 with the time and base of the fake row', async () => {
    await mount(makeStatus())
    const el = dialog()!
    expect(el).not.toBeNull()
    expect(el.hasAttribute('aria-modal')).toBe(false)
    expect(el.getAttribute('tabindex')).toBe('-1')
    expect(el.hasAttribute('inert')).toBe(false)
    const label = document.getElementById(el.getAttribute('aria-labelledby') ?? '')
    const time = formatQueueTime(SAVED_AT, 'en-US')
    expect(label?.textContent).toBe(
      en.uwQueuePopWaiting.replace('{time}', time).replace('{base}', '7'),
    )
    expect(label?.textContent).toContain('version 7')
    expect(document.activeElement).toBe(el)
    // line 1 is written once to the polite node
    expect(polite()).toBe(label?.textContent)
  })

  it('shows line 2 only when a newer edit waits behind the intent', async () => {
    await mount(makeStatus())
    expect(dialog()!.textContent).not.toContain(en.uwQueuePopNewer)
    await mount(makeStatus({ pendingNext: true }))
    expect(dialog()!.textContent).toContain(en.uwQueuePopNewer)
  })

  it('offers Cancel only in cancellable states and always Open sync center', async () => {
    await mount(makeStatus({ state: 'queued' }))
    expect(buttonByText(en.uwQueueCancel)).toBeDefined()
    expect(buttonByText(en.uwQueueOpenCenter)).toBeDefined()

    snapshot = makeSnapshot([makeRow({ state: 'reconciling' })])
    await mount(makeStatus({ state: 'reconciling' }))
    expect(buttonByText(en.uwQueueCancel)).toBeUndefined()
    expect(buttonByText(en.uwQueueOpenCenter)).toBeDefined()
  })

  it('without a sync-center row: blocked-save sentence, no cancel / save again, center stays', async () => {
    snapshot = makeSnapshot([])
    await mount(makeStatus({ state: 'failed' }))
    expect(buttonByText(en.uwQueueCancel)).toBeUndefined()
    expect(buttonByText(en.uwActSaveAgain)).toBeUndefined()
    expect(buttonByText(en.uwQueueOpenCenter)).toBeDefined()
  })

  it('opens from the pill button with the queued line when the row exists', async () => {
    await mount(makeStatus({ state: 'queued' }), { initiallyOpen: false })
    expect(dialog()).toBeNull()
    await act(async () => {
      document.getElementById('pill-view-queue')!.click()
    })
    await act(async () => {})
    expect(dialog()!.textContent).toContain('version 7')
    expect(buttonByText(en.uwQueueCancel)).toBeDefined()
  })

  function cleanupWindowApi() {
    delete (window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter
  }

  it('confirm step: sentence, focus on Back, Back returns, Cancel save calls cancelSave and closes', async () => {
    await mount(makeStatus())
    await act(async () => {
      buttonByText(en.uwQueueCancel)!.click()
    })
    expect(dialog()!.textContent).toContain(en.uwQueueCancelConfirm)
    const back = buttonByText(en.uwActBack)!
    expect(document.activeElement).toBe(back)
    const go = buttonByText(en.uwQueueCancelGo)!
    expect(go).toBeDefined()
    // the sentence describes both buttons
    const describedBy = go.getAttribute('aria-describedby')
    expect(describedBy).toBe(back.getAttribute('aria-describedby'))
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(en.uwQueueCancelConfirm)

    await act(async () => {
      back.click()
    })
    expect(buttonByText(en.uwQueueCancel)).toBeDefined()
    expect(api.cancelSave).not.toHaveBeenCalled()

    await act(async () => {
      buttonByText(en.uwQueueCancel)!.click()
    })
    await act(async () => {
      buttonByText(en.uwQueueCancelGo)!.click()
    })
    expect(api.cancelSave).toHaveBeenCalledWith('row-1')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(polite()).toBe(en.uwQueueCancelled)
  })

  it('a refused cancel (draft cap / store full) keeps the intent, stays open, says it assertively', async () => {
    api.cancelSave.mockResolvedValueOnce({ ok: false, code: 'draft_cap' })
    await mount(makeStatus())
    await act(async () => {
      buttonByText(en.uwQueueCancel)!.click()
    })
    await act(async () => {
      buttonByText(en.uwQueueCancelGo)!.click()
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    expect(assertive()).toBe(en.uwConflictDraftCapReached.replace('{cap}', '3'))

    api.cancelSave.mockResolvedValueOnce({ ok: false, code: 'store_full' })
    await act(async () => {
      buttonByText(en.uwQueueCancelGo)!.click()
    })
    await act(async () => {})
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog()!.textContent).toContain(en.uwQueueFull)
  })

  it('Esc closes and focus returns to the pill button that opened it', async () => {
    await mount(makeStatus(), { initiallyOpen: false })
    const opener = document.getElementById('pill-view-queue')!
    opener.focus()
    await act(async () => {
      opener.click()
    })
    expect(document.activeElement).toBe(dialog())
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(dialog()).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(opener)
  })

  it('opened by Ctrl/Cmd+S: blocked-save sentence once, Esc hands focus back to the editor', async () => {
    await mount(makeStatus(), { opener: 'ctrl-s' })
    expect(dialog()!.textContent).toContain(en.uwQueueBlockedSave)
    expect(polite()).toBe(en.uwQueueBlockedSave)
    await act(async () => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(dialog()).toBeNull()
    expect(onFocusEditor).toHaveBeenCalledTimes(1)
  })

  it('a click outside closes without moving focus; a click inside or on the opener does not close', async () => {
    await mount(makeStatus())
    await mount(makeStatus()) // second render: the opener ref is filled
    const pointerdown = (el: Element) =>
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await act(async () => {
      pointerdown(dialog()!)
      pointerdown(document.getElementById('pill-view-queue')!)
    })
    expect(onClose).not.toHaveBeenCalled()
    const editor = document.getElementById('editor')!
    editor.focus()
    await act(async () => {
      pointerdown(editor)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(editor)
    expect(onFocusEditor).not.toHaveBeenCalled()
  })

  it('closes when the status leaves every popover state; focus goes to the pill if it was inside', async () => {
    await mount(makeStatus())
    expect(document.activeElement).toBe(dialog())
    await mount(makeStatus({ state: 'saved' }))
    expect(dialog()).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(document.getElementById('pill-view-queue'))
  })

  it('closes when the active document changes', async () => {
    await mount(makeStatus())
    await mount(makeStatus({ path: '/work/other.docx', documentId: 'doc-2' }))
    expect(dialog()).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('follows a pushed snapshot and stops listening on close', async () => {
    await mount(makeStatus())
    expect(dialog()!.textContent).toContain('version 7')
    await act(async () => {
      pushSnapshot?.(makeSnapshot([makeRow({ base: 9 })]))
    })
    expect(dialog()!.textContent).toContain('version 9')
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(pushSnapshot).toBeNull()
  })

  it('Open sync center sends the open-settings event for the sync section and closes', async () => {
    await mount(makeStatus())
    await act(async () => {
      buttonByText(en.uwQueueOpenCenter)!.click()
    })
    expect(openSettings).toHaveBeenCalledTimes(1)
    expect((openSettings.mock.calls[0][0] as CustomEvent).detail).toEqual({ section: 'sync' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('blocked: line 3 gives the reason, the reason action runs (sign in again / check again)', async () => {
    snapshot = makeSnapshot([], [makeRow({ state: 'blocked', blockedReason: 'session_expired' })])
    await mount(makeStatus({ state: 'blocked', error: 'session_expired' }))
    expect(dialog()!.textContent).toContain(en.uwRowBlocked.replace('{reason}', en.uwReasonSession))
    await act(async () => {
      buttonByText(en.uwActSignInAgain)!.click()
    })
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('blocked: an access reason offers Check again, which calls recheck with the row id', async () => {
    snapshot = makeSnapshot(
      [],
      [makeRow({ state: 'blocked', blockedReason: 'permission_revoked' })],
    )
    await mount(makeStatus({ state: 'blocked', error: 'forbidden' }))
    await act(async () => {
      buttonByText(en.uwActRecheck)!.click()
    })
    expect(api.recheck).toHaveBeenCalledWith('row-1')
    expect(enDocs.uwReasonForbidden).toBeTruthy()
  })

  it('a store refusal reads as the reason, with no intent actions', async () => {
    snapshot = makeSnapshot([])
    await mount(makeStatus({ state: 'error', error: 'store_full' }), { opener: 'ctrl-s' })
    expect(dialog()!.textContent).toContain(en.uwQueueFull)
    expect(buttons().map((b) => b.textContent)).toEqual([en.uwQueueOpenCenter])
  })

  it('failed: Save again calls saveAgain with the row id and closes', async () => {
    snapshot = makeSnapshot([], [makeRow({ state: 'failed', failedReason: 'too_large' })])
    await mount(makeStatus({ state: 'failed' }))
    expect(dialog()!.textContent).toContain(
      en.uwTipFailed.replace('{reason}', enDocs.uwReasonTooLarge),
    )
    expect(buttons().map((b) => b.textContent)).toEqual([
      en.uwActSaveAgain,
      en.uwQueueCancel,
      en.uwQueueOpenCenter,
    ])
    await act(async () => {
      buttonByText(en.uwActSaveAgain)!.click()
    })
    expect(api.saveAgain).toHaveBeenCalledWith('row-1')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a busy action keeps the button mounted with aria-disabled and ignores a second click', async () => {
    let release: (value: SyncCenterActionResult) => void = () => {}
    api.saveAgain.mockImplementationOnce(
      () => new Promise<SyncCenterActionResult>((resolve) => (release = resolve)),
    )
    snapshot = makeSnapshot([], [makeRow({ state: 'failed' })])
    await mount(makeStatus({ state: 'failed' }))
    const again = buttonByText(en.uwActSaveAgain)!
    again.focus()
    await act(async () => {
      again.click()
    })
    expect(again.getAttribute('aria-disabled')).toBe('true')
    expect(again.disabled).toBe(false)
    await act(async () => {
      again.click()
    })
    expect(api.saveAgain).toHaveBeenCalledTimes(1)
    await act(async () => {
      release({ ok: true })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('works without window.uniworkSyncCenter (G5-10 not landed): no crash, no row actions', async () => {
    cleanupWindowApi()
    await mount(makeStatus())
    expect(dialog()!.textContent).toContain(en.uwQueueBlockedSave)
    expect(buttons().map((b) => b.textContent)).toEqual([en.uwQueueOpenCenter])
  })

  // FX6u (review r1)
  it('RFE6u-02: an action that closes it returns focus to the pill button, never to <body>', async () => {
    await mount(makeStatus())
    await mount(makeStatus()) // second render: the opener ref is filled
    await act(async () => {
      buttonByText(en.uwQueueCancel)!.click()
    })
    await act(async () => {
      buttonByText(en.uwQueueCancelGo)!.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(document.getElementById('pill-view-queue'))
  })

  it('RFE6u-02: Save again / sign in also hand focus back (the pill, or the editor after Ctrl/Cmd+S)', async () => {
    snapshot = makeSnapshot([], [makeRow({ state: 'failed' })])
    await mount(makeStatus({ state: 'failed' }))
    await mount(makeStatus({ state: 'failed' }))
    buttonByText(en.uwActSaveAgain)!.focus()
    await act(async () => {
      buttonByText(en.uwActSaveAgain)!.click()
    })
    expect(document.activeElement).toBe(document.getElementById('pill-view-queue'))
    act(() => root.unmount())
    root = createRoot(hostEl)

    snapshot = makeSnapshot([], [makeRow({ state: 'blocked', blockedReason: 'session_expired' })])
    await mount(makeStatus({ state: 'blocked', error: 'session_expired' }), { opener: 'ctrl-s' })
    buttonByText(en.uwActSignInAgain)!.focus()
    await act(async () => {
      buttonByText(en.uwActSignInAgain)!.click()
    })
    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(onFocusEditor).toHaveBeenCalledTimes(1)
  })

  it('RFE6u-02: Open sync center leaves the focus to the sync center (no hand-back)', async () => {
    await mount(makeStatus(), { opener: 'ctrl-s' })
    await act(async () => {
      buttonByText(en.uwQueueOpenCenter)!.click()
    })
    expect(onFocusEditor).not.toHaveBeenCalled()
  })

  it('RFE6u-05: Esc in the cancel confirmation backs out of it first, a second Esc closes', async () => {
    await mount(makeStatus())
    await act(async () => {
      buttonByText(en.uwQueueCancel)!.click()
    })
    expect(dialog()!.textContent).toContain(en.uwQueueCancelConfirm)
    const esc = () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await act(async () => esc())
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).not.toContain(en.uwQueueCancelConfirm)
    expect(document.activeElement).toBe(buttonByText(en.uwQueueCancel))
    expect(onClose).not.toHaveBeenCalled()
    expect(api.cancelSave).not.toHaveBeenCalled()
    await act(async () => esc())
    expect(dialog()).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('RFE6u-07: without a row the failed reason comes from the status code, like the pill', async () => {
    snapshot = makeSnapshot([])
    await mount(makeStatus({ state: 'failed', error: 'quota_exceeded' }))
    expect(dialog()!.textContent).toContain(
      en.uwTipFailed.replace('{reason}', enDocs.uwReasonQuota),
    )
  })

  describe('RFE6u-01: the popover lives in the reserved band under the strip', () => {
    let setBarInset: ReturnType<typeof vi.fn>
    const lastInset = () => setBarInset.mock.calls.at(-1)?.[0]
    let rectSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      setBarInset = vi.fn(async () => undefined)
      ;(window as unknown as { aiOffice?: unknown }).aiOffice = { uniworkSetBarInset: setBarInset }
      rectSpy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          const height = this.hasAttribute('data-uw-queue-band') ? 120 : 0
          return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 0,
            bottom: height,
            width: 0,
            height,
          } as DOMRect
        })
    })

    afterEach(() => {
      rectSpy.mockRestore()
      setTopInsetPart('bar', 0)
      delete (window as unknown as { aiOffice?: unknown }).aiOffice
    })

    it('adds its band height to the S6 bar height and gives it back on close', async () => {
      setTopInsetPart('bar', 36)
      expect(lastInset()).toBe(36)
      await mount(makeStatus())
      // the sum, never one overwriting the other
      expect(lastInset()).toBe(36 + 120)
      const band = document.querySelector<HTMLElement>('[data-uw-queue-band]')!
      expect(band.contains(dialog())).toBe(true)
      // drawn right under the strip and the bar
      expect(band.style.top).toContain('36px')
      // the bar changing while the popover is open still sends the sum
      setTopInsetPart('bar', 50)
      expect(lastInset()).toBe(50 + 120)
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(dialog()).toBeNull()
      expect(lastInset()).toBe(50)
    })

    it('without a bar the inset is the band alone, and 0 after close', async () => {
      await mount(makeStatus())
      expect(lastInset()).toBe(120)
      await mount(makeStatus({ state: 'saved' }))
      expect(dialog()).toBeNull()
      expect(lastInset()).toBe(0)
    })

    describe('RBE6u2-03: the band never asks for more than main will give', () => {
      const room = () =>
        document
          .querySelector<HTMLElement>('[data-uw-queue-band]')!
          .style.getPropertyValue('--uw-queue-room')
      const measured = (height: number) =>
        rectSpy.mockImplementation(function (this: HTMLElement) {
          const h = this.hasAttribute('data-uw-queue-band') ? height : 0
          return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 0,
            bottom: h,
            width: 0,
            height: h,
          } as DOMRect
        })
      const body = () => document.querySelector<HTMLElement>('.uw-queue-pop-body')
      let scrollSpy: ReturnType<typeof vi.spyOn>
      let clientSpy: ReturnType<typeof vi.spyOn>

      afterEach(() => {
        scrollSpy?.mockRestore()
        clientSpy?.mockRestore()
        document.documentElement.style.removeProperty('--ui-scale')
      })

      it('mirrors the main-process clamp', () => {
        expect(TOP_INSET_MAX).toBe(400)
      })

      it('a popover taller than the room publishes at most 400 and the dialog gets the room', async () => {
        measured(520)
        await mount(makeStatus())
        expect(room()).toBe('400px')
        expect(setBarInset.mock.calls.every((call) => (call[0] as number) <= 400)).toBe(true)
        expect(lastInset()).toBe(400)
      })

      it('with the S6 bar present the room shrinks by the bar height', async () => {
        setTopInsetPart('bar', 36)
        measured(520)
        await mount(makeStatus())
        expect(room()).toBe('364px')
        expect(lastInset()).toBe(400)
        expect(setBarInset.mock.calls.every((call) => (call[0] as number) <= 400)).toBe(true)
        // the bar growing while the popover is open shrinks the room and keeps the total in range
        setTopInsetPart('bar', 100)
        await act(async () => {})
        expect(room()).toBe('300px')
        expect(topInsetTotal()).toBeLessThanOrEqual(400)
        expect(lastInset()).toBeLessThanOrEqual(400)
      })

      it('a popover that fits is published as measured', async () => {
        measured(120)
        await mount(makeStatus())
        expect(room()).toBe('400px')
        expect(lastInset()).toBe(120)
      })

      it('the cap is in unscaled px: a zoomed interface measures window px', async () => {
        document.documentElement.style.setProperty('--ui-scale', '2')
        measured(1000)
        await mount(makeStatus())
        expect(room()).toBe('400px')
        expect(lastInset()).toBe(400)
      })

      it('a zoomed band that fits is published unscaled', async () => {
        document.documentElement.style.setProperty('--ui-scale', '2')
        measured(700)
        await mount(makeStatus())
        expect(lastInset()).toBe(350)
      })

      it('the text scrolls inside the dialog; the action row stays outside the scroll area', async () => {
        await mount(makeStatus())
        const scroller = body()!
        expect(scroller).not.toBeNull()
        expect(dialog()!.contains(scroller)).toBe(true)
        expect(scroller.textContent).toContain('version 7')
        const actions = dialog()!.querySelector('.uw-queue-pop-actions')!
        expect(scroller.contains(actions)).toBe(false)
        expect(actions.querySelectorAll('button').length).toBeGreaterThan(0)
        // the cancel confirmation sentence scrolls with the text; its buttons stay put
        await act(async () => {
          buttonByText('Cancel save…')!.click()
        })
        expect(body()!.textContent).toContain(en.uwQueueCancelConfirm)
        expect(body()!.contains(dialog()!.querySelector('.uw-queue-pop-actions button'))).toBe(
          false,
        )
      })

      it('a body that fits is not a keyboard stop', async () => {
        await mount(makeStatus())
        expect(body()!.hasAttribute('tabindex')).toBe(false)
        expect(body()!.hasAttribute('role')).toBe(false)
      })

      it('an overflowing body is a keyboard stop, named by line 1', async () => {
        scrollSpy = vi
          .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
          .mockImplementation(() => 500)
        clientSpy = vi
          .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
          .mockImplementation(() => 200)
        await mount(makeStatus())
        expect(body()!.getAttribute('tabindex')).toBe('0')
        expect(body()!.getAttribute('role')).toBe('group')
        expect(body()!.getAttribute('aria-labelledby')).toBe(
          dialog()!.getAttribute('aria-labelledby'),
        )
      })

      describe('RFE6u4-02: the body shrinking at the cap updates the keyboard stop', () => {
        type FakeObserver = { callback: () => void; observed: Element[] }
        let observers: FakeObserver[]
        let hadObserver: boolean
        let previousObserver: unknown
        let bodyScroll = 500

        beforeEach(() => {
          observers = []
          bodyScroll = 500
          hadObserver = 'ResizeObserver' in window
          previousObserver = (window as unknown as { ResizeObserver?: unknown }).ResizeObserver
          ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
            private readonly record: FakeObserver
            constructor(callback: () => void) {
              this.record = { callback, observed: [] }
              observers.push(this.record)
            }
            observe(target: Element): void {
              this.record.observed.push(target)
            }
            unobserve(): void {}
            disconnect(): void {}
          }
          scrollSpy = vi
            .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
            .mockImplementation(() => bodyScroll)
          clientSpy = vi
            .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
            .mockImplementation(() => 200)
        })

        afterEach(() => {
          if (hadObserver) {
            ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = previousObserver
          } else {
            delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver
          }
        })

        /** what the browser does when an observed element changed size */
        const fireFor = (target: Element) => {
          for (const record of observers) {
            if (record.observed.includes(target)) record.callback()
          }
        }

        it('observes the band and the scrolling body', async () => {
          measured(520)
          await mount(makeStatus())
          const band = document.querySelector<HTMLElement>('[data-uw-queue-band]')!
          const observed = observers.flatMap((record) => record.observed)
          expect(observed).toContain(band)
          expect(observed).toContain(body()!)
        })

        it('the body fitting again at an unchanged band height drops the tab stop', async () => {
          // the band sits at its cap: its own height never changes again
          measured(520)
          await mount(makeStatus())
          expect(body()!.getAttribute('tabindex')).toBe('0')
          bodyScroll = 200
          await act(async () => fireFor(body()!))
          expect(body()!.hasAttribute('tabindex')).toBe(false)
          expect(body()!.hasAttribute('role')).toBe(false)
          expect(lastInset()).toBe(400)
        })

        it('the body overflowing again makes it a tab stop again', async () => {
          bodyScroll = 200
          measured(520)
          await mount(makeStatus())
          expect(body()!.hasAttribute('tabindex')).toBe(false)
          bodyScroll = 600
          await act(async () => fireFor(body()!))
          expect(body()!.getAttribute('tabindex')).toBe('0')
        })
      })

      describe('queue-popover.css', () => {
        const css = readFileSync(
          resolve(__dirname, '../src/renderer/src/queue-popover.css'),
          'utf8',
        ).replace(new RegExp(String.fromCharCode(13), 'g'), '')
        const rule = (selector: string): string => {
          const start = css.indexOf(`${String.fromCharCode(10)}${selector} {`)
          expect(start, selector).toBeGreaterThanOrEqual(0)
          const open = css.indexOf('{', start)
          return css.slice(open + 1, css.indexOf('}', open))
        }

        it('the dialog is capped by the room minus the band chrome', () => {
          expect(rule('.uw-queue-pop')).toMatch(
            /max-height: calc\(var\(--uw-queue-room, \d+px\) - 15px\)/,
          )
          // padding 6 + 8 and the 1px border make the 15px
          expect(rule('.uw-queue-band')).toMatch(/padding: 6px 12px 8px/)
          expect(rule('.uw-queue-band')).toMatch(/border-bottom: 1px solid/)
          expect(rule('.uw-queue-band')).toMatch(/overflow: hidden/)
        })

        it('the body scrolls, the action row never shrinks, the focus ring shows', () => {
          expect(rule('.uw-queue-pop-body')).toMatch(/overflow-y: auto/)
          expect(rule('.uw-queue-pop-body')).toMatch(/min-height: 0/)
          expect(rule('.uw-queue-pop-actions')).toMatch(/flex-shrink: 0/)
          expect(rule('.uw-queue-pop-body:focus-visible')).toMatch(
            /outline: 2px solid var\(--color-border-brand\)/,
          )
        })

        it('theme tokens only', () => {
          expect(rule('.uw-queue-pop-body') + rule('.uw-queue-pop-body:focus-visible')).not.toMatch(
            /#[0-9a-f]{3,8}|rgba?\(/i,
          )
        })
      })
    })

    describe('V6u-03: the editor moves once on open, once on close', () => {
      let resolveSnapshot: (value: SyncCenterSnapshot) => void
      const insets = () => setBarInset.mock.calls.map((call) => call[0] as number)
      /** the distinct totals main was asked for, in order (a resend of the same total moves nothing) */
      const moves = () => insets().filter((v, i, all) => i === 0 || v !== all[i - 1])

      beforeEach(() => {
        // the band is taller while it shows the 2-line no-row sentence than with the row's 1-line one
        rectSpy.mockImplementation(function (this: HTMLElement) {
          if (!this.hasAttribute('data-uw-queue-band')) return { height: 0 } as DOMRect
          const height = this.textContent?.includes('version 7') ? 98 : 117
          return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 0,
            bottom: height,
            width: 0,
            height,
          } as DOMRect
        })
        api.getSnapshot = vi.fn(
          () =>
            new Promise<SyncCenterSnapshot>((resolve) => {
              resolveSnapshot = resolve
            }),
        ) as typeof api.getSnapshot
      })

      it('holds the band height until the sync-center row has arrived', async () => {
        await mount(makeStatus())
        expect(dialog()).not.toBeNull()
        // nothing reserved yet: the fallback sentence's height is never sent
        expect(insets().filter((v) => v > 0)).toEqual([])
        await act(async () => {
          resolveSnapshot(makeSnapshot([makeRow()]))
        })
        await act(async () => {})
        expect(moves().filter((v) => v > 0)).toEqual([98])
        await act(async () => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })
        expect(moves().filter((v) => v > 0)).toEqual([98])
        expect(lastInset()).toBe(0)
      })

      it('a lookup that never answers is capped: the band is reserved after the cap', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
          await mount(makeStatus())
          expect(insets().filter((v) => v > 0)).toEqual([])
          await act(async () => {
            vi.advanceTimersByTime(QUEUE_BAND_SETTLE_MS)
          })
          expect(moves().filter((v) => v > 0)).toEqual([117])
          expect(QUEUE_BAND_SETTLE_MS).toBeGreaterThan(0)
          expect(QUEUE_BAND_SETTLE_MS).toBeLessThanOrEqual(500)
        } finally {
          vi.useRealTimers()
        }
      })

      it('a failed lookup reserves the band at once (no row to wait for)', async () => {
        api.getSnapshot = vi.fn(async () => {
          throw new Error('gone')
        }) as typeof api.getSnapshot
        await mount(makeStatus())
        await act(async () => {})
        expect(moves().filter((v) => v > 0)).toEqual([117])
      })
    })
  })
})
