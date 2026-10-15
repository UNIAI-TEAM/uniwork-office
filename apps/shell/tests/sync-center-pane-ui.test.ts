/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lang } from '@genoffice/i18n'
import type {
  SyncCenterActionResult,
  SyncCenterRow,
  SyncCenterRowState,
  SyncCenterSnapshot,
  UniworkSyncCenterApi,
} from '../src/shared/sync-center'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SyncCenterPane } from '../src/renderer/src/SyncCenterPane'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const vi_ = { ...syncStrings.vi, ...uniworkDocumentStrings.vi } as Record<string, string>
const en_ = { ...syncStrings.en, ...uniworkDocumentStrings.en } as Record<string, string>
const wbLoading = (workbenchStrings.vi as Record<string, string>).wbLoading!
const fill = (s: string, params: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))

const row = (
  id: string,
  state: SyncCenterRowState,
  over: Partial<SyncCenterRow> = {},
): SyncCenterRow => ({
  id,
  documentId: `doc-${id}`,
  documentKey: `key-${id}`,
  title: `Tài liệu ${id}`,
  ext: 'docx',
  state,
  savedAt: '2026-10-15T08:00:00.000Z',
  canEdit: true,
  ...over,
})

const snapshot = (over: Partial<SyncCenterSnapshot> = {}): SyncCenterSnapshot => ({
  header: {
    status: 'online',
    online: true,
    paused: false,
    adminPaused: false,
    otherOrgHasIntents: false,
    resyncFailed: false,
    feedOff: false,
    resynced: false,
    lastSyncAt: '2026-10-15T08:30:00.000Z',
    account: { name: 'Minh', email: 'minh@example.test' },
    org: { id: 'o1', name: 'Vietants' },
    storeBudget: { used: 1024 * 1024, cap: 1024 ** 3 },
  },
  storeError: false,
  tabs: {
    attention: [
      row('stuck', 'reconciling_stuck', { reconcileAttempts: 4, supportCode: 'SUP-1' }),
      row('draft', 'kept_draft'),
    ],
    pending: [row('q', 'queued', { base: 3, sizeBytes: 2048 })],
    recent: [row('c', 'committed', { committedVersion: 8 })],
  },
  defaultTab: 'attention',
  ...over,
})

type Fake = {
  [K in Exclude<keyof UniworkSyncCenterApi, 'subscribe' | 'getSnapshot'>]: ReturnType<typeof vi.fn>
} & {
  getSnapshot: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  push: (s: SyncCenterSnapshot) => void
}

function fakeApi(initial: SyncCenterSnapshot | null): Fake {
  let listener: ((s: SyncCenterSnapshot) => void) | null = null
  const ok = (): Promise<SyncCenterActionResult> => Promise.resolve({ ok: true })
  return {
    getSnapshot: vi.fn(() => (initial ? Promise.resolve(initial) : new Promise(() => undefined))),
    syncNow: vi.fn(ok),
    setSendingPaused: vi.fn(ok),
    sendNow: vi.fn(ok),
    cancelSave: vi.fn(ok),
    recheck: vi.fn(ok),
    copySupportCode: vi.fn(ok),
    discardSave: vi.fn(ok),
    openDocument: vi.fn(ok),
    openDraft: vi.fn(ok),
    discardDraft: vi.fn(ok),
    saveAgain: vi.fn(ok),
    saveMyCopy: vi.fn(ok),
    retryStore: vi.fn(ok),
    subscribe: vi.fn((cb: (s: SyncCenterSnapshot) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    }),
    push: (s) => listener?.(s),
  }
}

let host: HTMLDivElement
let root: Root
let onSignIn: ReturnType<typeof vi.fn>
let onSignOut: ReturnType<typeof vi.fn>

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  onSignIn = vi.fn()
  onSignOut = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve())
}

async function render(api: Fake, lang: Lang = 'vi') {
  act(() => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(SyncCenterPane, {
          api: api as unknown as UniworkSyncCenterApi,
          onSignIn,
          onSignOut,
        }),
      ),
    )
  })
  await flush()
}

const buttons = (scope: ParentNode = host) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
const button = (label: string, scope: ParentNode = host) => {
  const found = buttons(scope).find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  )
  if (!found) throw new Error(`no button "${label}"`)
  return found
}
const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
const panel = () => host.querySelector<HTMLElement>('[role="tabpanel"]')!
const status = () => host.querySelector<HTMLElement>('[role="status"]')!
const rowEl = (id: string) => host.querySelector<HTMLElement>(`tr[data-row-id="${id}"]`)!
const click = async (el: HTMLElement) => {
  await act(async () => el.click())
  await flush()
}
const key = async (el: HTMLElement, k: string) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

describe('SyncCenterPane', () => {
  it('shows 3 skeleton rows on first load', async () => {
    await render(fakeApi(null))
    expect(host.querySelectorAll('.sc-skeleton-row')).toHaveLength(3)
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('has a polite live node from the start', async () => {
    await render(fakeApi(null))
    expect(status().getAttribute('role')).toBe('status')
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1)
  })

  it('opens on "Cần xử lý" when it has rows, else on "Đang chờ lưu"', async () => {
    await render(fakeApi(snapshot()))
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    act(() => root.unmount())
    root = createRoot(host)
    await render(
      fakeApi(snapshot({ defaultTab: 'pending', tabs: { ...snapshot().tabs, attention: [] } })),
    )
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
  })

  it('names each tab with its count and labels the tabpanel by the tab', async () => {
    await render(fakeApi(snapshot()))
    expect(tabs()[0]!.getAttribute('aria-label')).toBe(
      fill(vi_.uwSyncTabCount!, { label: vi_.uwSyncTabAttention!, count: 2 }),
    )
    const p = panel()
    expect(p.getAttribute('aria-labelledby')).toBe(tabs()[0]!.id)
    expect(tabs()[0]!.getAttribute('aria-controls')).toBe(p.id)
    expect(p.querySelector('caption')?.textContent).toBe(vi_.uwSyncTabAttention)
  })

  it('tablist: roving tabindex, arrows wrap, Home/End', async () => {
    await render(fakeApi(snapshot()))
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1])
    tabs()[0]!.focus()
    await key(tabs()[0]!, 'ArrowRight')
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs()[1])
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1])
    await key(tabs()[1]!, 'End')
    expect(document.activeElement).toBe(tabs()[2])
    await key(tabs()[2]!, 'ArrowRight')
    expect(document.activeElement).toBe(tabs()[0])
    await key(tabs()[0]!, 'ArrowLeft')
    expect(document.activeElement).toBe(tabs()[2])
    await key(tabs()[2]!, 'Home')
    expect(document.activeElement).toBe(tabs()[0])
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('Tab walks the doc button then every row action in order', async () => {
    await render(fakeApi(snapshot()))
    const focusables = Array.from(
      panel().querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.tabIndex >= 0)
    expect(focusables.map((el) => el.textContent?.trim())).toEqual([
      'Tài liệu stuck',
      vi_.uwActRecheck,
      vi_.uwActCopySupport,
      vi_.uwActDownloadMine,
      vi_.uwActDiscardSave,
      'Tài liệu draft',
      vi_.uwActOpenDraft,
      vi_.uwActDiscardDraft,
    ])
  })

  it('rows have a name of title + state and a text badge', async () => {
    await render(fakeApi(snapshot()))
    expect(rowEl('stuck').getAttribute('aria-label')).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: 'Tài liệu stuck', state: vi_.uwBadgeReconcileStuck! }),
    )
    expect(rowEl('stuck').querySelector('.sc-badge')?.textContent).toBe(vi_.uwBadgeReconcileStuck)
    expect(rowEl('stuck').querySelector('th[scope="row"]')).not.toBeNull()
  })

  it('renders each state with its actions', async () => {
    const all: SyncCenterRow[] = [
      row('a', 'queued'),
      row('b', 'paused_offline'),
      row('c', 'paused_user'),
      row('d', 'paused_admin'),
      row('e', 'uploading', { progress: { done: 1, total: 2 } }),
      row('f', 'committing'),
      row('g', 'reconciling'),
      row('h', 'conflict', { conflict: { version: 5 } }),
      row('i', 'failed', { failedReason: 'quota' }),
      row('j', 'moved', { workspaceName: 'X' }),
      row('k', 'archived'),
      row('l', 'kept_draft', { revoked: true }),
      row('m', 'blocked', { blockedReason: 'session_expired' as never }),
    ]
    await render(fakeApi(snapshot({ tabs: { attention: all, pending: [], recent: [] } })))
    const actionsOf = (id: string) =>
      buttons(rowEl(id).querySelector('.sc-actions')!).map((b) => b.textContent?.trim())
    expect(actionsOf('a')).toEqual([vi_.uwActSendNow, vi_.uwQueueCancel])
    for (const id of ['b', 'c', 'd']) expect(actionsOf(id)).toEqual([vi_.uwQueueCancel])
    expect(actionsOf('e')).toEqual([])
    expect(rowEl('e').querySelector('[role="progressbar"]')).not.toBeNull()
    expect(actionsOf('f')).toEqual([])
    expect(actionsOf('g')).toEqual([vi_.uwActRecheck, vi_.uwActGuide])
    expect(actionsOf('h')).toEqual([vi_.uwActOpenToResolve])
    expect(actionsOf('i')).toEqual([vi_.uwActDetails, vi_.uwActSaveAgain, vi_.uwQueueCancel])
    expect(actionsOf('j')).toEqual([vi_.uwActOpen])
    expect(actionsOf('k')).toEqual([vi_.uwActOpen])
    expect(actionsOf('l')).toEqual([vi_.uwActDiscardDraft])
    expect(rowEl('l').querySelector('th button')).toBeNull()
    expect(actionsOf('m')).toEqual([vi_.uwActSignInAgain])
    expect(rowEl('m').textContent).toContain(
      fill(vi_.uwRowBlocked!, { reason: vi_.uwReasonSession! }),
    )
    await click(button(vi_.uwActSignInAgain!, rowEl('m')))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('Gửi ngay offline stays in the Tab order, aria-disabled with its reason, and does not run', async () => {
    const s = snapshot({ tabs: { attention: [], pending: [row('q', 'queued')], recent: [] } })
    s.header = { ...s.header, online: false, status: 'offline' }
    s.defaultTab = 'pending'
    const api = fakeApi(s)
    await render(api)
    const send = button(vi_.uwActSendNow!, rowEl('q'))
    expect(send.getAttribute('aria-disabled')).toBe('true')
    expect(send.disabled).toBe(false)
    const reason = document.getElementById(send.getAttribute('aria-describedby')!.split(' ')[0]!)
    expect(reason?.textContent).toBe(vi_.uwSyncNowOffline)
    await click(send)
    expect(api.sendNow).not.toHaveBeenCalled()
  })

  it('cancel: confirm in the row with focus on "Quay lại"; back keeps everything', async () => {
    const s = snapshot({
      defaultTab: 'pending',
      tabs: { attention: [], pending: [row('q', 'queued')], recent: [] },
    })
    const api = fakeApi(s)
    await render(api)
    const trigger = button(vi_.uwQueueCancel!, rowEl('q'))
    trigger.focus()
    await click(trigger)
    expect(rowEl('q').textContent).toContain(vi_.uwQueueCancelConfirm)
    const back = button(vi_.uwActBack!, rowEl('q'))
    expect(document.activeElement).toBe(back)
    const sentenceId = back.getAttribute('aria-describedby')!
    expect(document.getElementById(sentenceId)?.textContent).toBe(vi_.uwQueueCancelConfirm)
    expect(button(vi_.uwQueueCancelGo!, rowEl('q')).getAttribute('aria-describedby')).toBe(
      sentenceId,
    )
    await click(back)
    expect(api.cancelSave).not.toHaveBeenCalled()
    expect(document.activeElement?.textContent).toBe(vi_.uwQueueCancel)
  })

  it('cancel: confirming calls cancelSave and announces the kept changes', async () => {
    const s = snapshot({
      defaultTab: 'pending',
      tabs: { attention: [], pending: [row('q', 'queued')], recent: [] },
    })
    const api = fakeApi(s)
    await render(api)
    await click(button(vi_.uwQueueCancel!, rowEl('q')))
    await click(button(vi_.uwQueueCancelGo!, rowEl('q')))
    expect(api.cancelSave).toHaveBeenCalledWith('q')
    expect(status().textContent).toBe(vi_.uwQueueCancelled)
    // main turns the intent into a kept draft: nothing typed is lost
    await act(async () =>
      api.push(
        snapshot({
          tabs: { attention: [row('q', 'kept_draft')], pending: [], recent: [] },
        }),
      ),
    )
    // the user's tab is kept; the draft is listed under "Cần xử lý"
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true')
    await click(tabs()[0]!)
    expect(rowEl('q').querySelector('.sc-badge')?.textContent).toBe(vi_.uwBadgeKeptDraft)
  })

  it('cancel: an error keeps the row and announces it', async () => {
    const s = snapshot({
      defaultTab: 'pending',
      tabs: { attention: [], pending: [row('q', 'queued')], recent: [] },
    })
    const api = fakeApi(s)
    api.cancelSave.mockResolvedValueOnce({ ok: false, code: 'draft_cap' })
    await render(api)
    await click(button(vi_.uwQueueCancel!, rowEl('q')))
    await click(button(vi_.uwQueueCancelGo!, rowEl('q')))
    expect(rowEl('q')).not.toBeNull()
    expect(status().textContent).toContain(fill(vi_.uwConflictDraftCapReached!, { cap: 3 }))
    expect(document.activeElement?.textContent).toBe(vi_.uwQueueCancel)
  })

  it('stuck row: refusals of Bỏ lần lưu… leave the row as it was', async () => {
    const api = fakeApi(snapshot())
    api.discardSave
      .mockResolvedValueOnce({ ok: false, code: 'draft_cap' })
      .mockResolvedValueOnce({ ok: false, code: 'store_full' })
    await render(api)
    for (const sentence of [fill(vi_.uwConflictDraftCapReached!, { cap: 3 }), vi_.uwQueueFull!]) {
      await click(button(vi_.uwActDiscardSave!, rowEl('stuck')))
      expect(rowEl('stuck').textContent).toContain(vi_.uwStuckDiscardConfirm)
      expect(document.activeElement?.textContent).toBe(vi_.uwActBack)
      await click(button(vi_.uwActDiscard!, rowEl('stuck')))
      expect(status().textContent).toContain(sentence)
      expect(buttons(rowEl('stuck').querySelector('.sc-actions')!)).toHaveLength(4)
    }
    expect(api.discardSave).toHaveBeenCalledTimes(2)
    expect(api.discardSave).toHaveBeenCalledWith('stuck')
  })

  it('stuck row: copy support code announces politely; download and recheck call main', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    await click(button(vi_.uwActCopySupport!, rowEl('stuck')))
    expect(api.copySupportCode).toHaveBeenCalledWith('stuck')
    expect(status().textContent).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: 'Tài liệu stuck', state: 'Đã sao chép' }),
    )
    await click(button(vi_.uwActDownloadMine!, rowEl('stuck')))
    expect(api.saveMyCopy).toHaveBeenCalledWith('stuck')
    await click(button(vi_.uwActRecheck!, rowEl('stuck')))
    expect(api.recheck).toHaveBeenCalledWith('stuck')
  })

  it('stuck row without edit access has no download', async () => {
    const s = snapshot()
    s.tabs.attention = [row('stuck', 'reconciling_stuck', { canEdit: false })]
    await render(fakeApi(s))
    expect(buttons(rowEl('stuck').querySelector('.sc-actions')!).map((b) => b.textContent)).toEqual(
      [vi_.uwActRecheck, vi_.uwActCopySupport, vi_.uwActDiscardSave],
    )
  })

  it('kept draft: Mở nháp opens read-only, Bỏ nháp… confirms first', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    await click(button(vi_.uwActOpenDraft!, rowEl('draft')))
    expect(api.openDraft).toHaveBeenCalledWith('draft')
    await click(button(vi_.uwActDiscardDraft!, rowEl('draft')))
    expect(rowEl('draft').textContent).toContain(vi_.uwDiscardDraftConfirm)
    expect(api.discardDraft).not.toHaveBeenCalled()
    await click(button(vi_.uwActDiscard!, rowEl('draft')))
    expect(api.discardDraft).toHaveBeenCalledWith('draft')
  })

  it('failed row: Lưu lại calls saveAgain (not recheck) and a refusal is announced', async () => {
    const s = snapshot()
    s.tabs.attention = [row('bad', 'failed', { failedReason: 'quota' })]
    const api = fakeApi(s)
    await render(api)
    await click(button(vi_.uwActSaveAgain!, rowEl('bad')))
    expect(api.saveAgain).toHaveBeenCalledTimes(1)
    expect(api.saveAgain).toHaveBeenCalledWith('bad')
    expect(api.recheck).not.toHaveBeenCalled()

    api.saveAgain.mockResolvedValueOnce({ ok: false, code: 'store_full' })
    await click(button(vi_.uwActSaveAgain!, rowEl('bad')))
    expect(api.saveAgain).toHaveBeenCalledTimes(2)
    expect(status().textContent).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: 'Tài liệu bad', state: vi_.uwQueueFull! }),
    )
  })

  it('blocked row: Bỏ nháp… confirms first, then calls discardDraft with the row id', async () => {
    const s = snapshot()
    s.tabs.attention = [row('gone', 'blocked', { blockedReason: 'document_deleted' })]
    const api = fakeApi(s)
    await render(api)
    await click(button(vi_.uwActDiscardDraft!, rowEl('gone')))
    expect(rowEl('gone').textContent).toContain(vi_.uwDiscardDraftConfirm)
    expect(api.discardDraft).not.toHaveBeenCalled()
    await click(button(vi_.uwActDiscard!, rowEl('gone')))
    expect(api.discardDraft).toHaveBeenCalledTimes(1)
    expect(api.discardDraft).toHaveBeenCalledWith('gone')
  })

  it('lease_expired row: Kết nối lại only while the offline library is on', async () => {
    const s = snapshot()
    s.tabs.attention = [
      row('lease', 'blocked', { blockedReason: 'lease_expired' }),
      row('lib', 'blocked', { blockedReason: 'lease_expired', libraryOff: true }),
    ]
    await render(fakeApi(s))
    const actionsOf = (id: string) =>
      buttons(rowEl(id).querySelector('.sc-actions')!).map((b) => b.textContent?.trim())
    expect(actionsOf('lease')).toEqual([vi_.uwActReconnect])
    expect(actionsOf('lib')).toEqual([])
    expect(rowEl('lib').textContent).toContain(
      fill(vi_.uwRowBlocked!, { reason: vi_.uwReasonLease! }),
    )
  })

  it('signed out: the count only, no document titles, Đăng nhập', async () => {
    const s = snapshot({
      signedOut: { lockedCount: 3 },
      tabs: { attention: [], pending: [], recent: [] },
    })
    s.header = { ...s.header, status: 'signed_out', account: undefined, storeBudget: undefined }
    await render(fakeApi(s))
    expect(host.textContent).toContain(fill(vi_.uwSyncSignedOut!, { count: 3 }))
    expect(host.textContent).not.toContain('Tài liệu')
    expect(host.querySelector('[role="tablist"]')).toBeNull()
    expect(host.textContent).not.toContain(
      fill(vi_.uwSyncStoreBudget!, { used: '', cap: '' }).slice(0, 10),
    )
    await click(button(vi_.uwActSignIn!))
    expect(onSignIn).toHaveBeenCalled()
  })

  it('store error: the message and Thử lại instead of the table', async () => {
    const api = fakeApi(
      snapshot({ storeError: true, tabs: { attention: [], pending: [], recent: [] } }),
    )
    await render(api)
    expect(host.textContent).toContain(vi_.uwSyncStoreError)
    expect(host.querySelector('table')).toBeNull()
    expect(host.querySelector('[role="tablist"]')).toBeNull()
    await click(button(vi_.uwActRetry!))
    expect(api.retryStore).toHaveBeenCalledTimes(1)
    expect(api.getSnapshot).toHaveBeenCalledTimes(2)
  })

  it('store newer: the S11 panel replaces the whole center', async () => {
    const s = snapshot()
    s.header = { ...s.header, status: 'store_newer' }
    await render(fakeApi(s))
    const region = host.querySelector('[role="region"]')!
    expect(region.textContent).toContain(vi_.uwLockNewerStoreTitle)
    expect(region.textContent).toContain(vi_.uwLockNewerStore)
    expect(host.querySelector('[role="tablist"]')).toBeNull()
  })

  it('header: account, org, budget, Đăng xuất, pause and sync now', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    const head = host.querySelector('.sc-header')!
    expect(head.textContent).toContain('Minh')
    expect(head.textContent).toContain('Vietants')
    expect(head.textContent).toContain(fill(vi_.uwSyncStoreBudget!, { used: '1 MB', cap: '1 GB' }))
    await click(button(vi_.uwSignOutGo!, head))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    await click(button(vi_.uwSyncPause!, head))
    expect(api.setSendingPaused).toHaveBeenCalledWith(true)
    await click(button(vi_.uwSyncNow!, head))
    expect(api.syncNow).toHaveBeenCalledTimes(1)
  })

  it('header offline: Đồng bộ ngay shown, aria-disabled with uwSyncNowOffline, does not run', async () => {
    const s = snapshot()
    s.header = { ...s.header, online: false, paused: true, status: 'offline' }
    const api = fakeApi(s)
    await render(api)
    const now = button(vi_.uwSyncNow!)
    expect(now.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(now.getAttribute('aria-describedby')!)?.textContent).toBe(
      vi_.uwSyncNowOffline,
    )
    await click(now)
    expect(api.syncNow).not.toHaveBeenCalled()
    expect(button(vi_.uwSyncResume!)).toBeTruthy()
    expect(host.querySelector('.sc-status-line')?.textContent).toContain(
      vi_.uwSyncOffline!.split('{')[0]!.trim(),
    )
  })

  it('W10: a stopped feed (resyncFailed) keeps Đồng bộ ngay usable while the header says offline', async () => {
    const s = snapshot()
    s.header = { ...s.header, online: false, resyncFailed: true, status: 'offline' }
    const api = fakeApi(s)
    await render(api)
    const now = button(vi_.uwSyncNow!)
    expect(now.getAttribute('aria-disabled')).toBeNull()
    expect(now.getAttribute('aria-describedby')).toBeNull()
    expect(host.textContent).not.toContain(vi_.uwSyncNowOffline!)
    await click(now)
    expect(api.syncNow).toHaveBeenCalledTimes(1)
  })

  it('other organization line and status changes are announced', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    const next = snapshot()
    next.header = { ...next.header, paused: true, otherOrgHasIntents: true, otherOrgCount: 2 }
    await act(async () => api.push(next))
    expect(host.textContent).toContain(fill(vi_.uwSyncOtherOrg!, { count: 2 }))
    expect(status().textContent).toBe(vi_.uwSyncPaused)
  })

  it('empty tabs say so', async () => {
    await render(
      fakeApi(
        snapshot({ defaultTab: 'pending', tabs: { attention: [], pending: [], recent: [] } }),
      ),
    )
    expect(panel().textContent).toContain(vi_.uwSyncEmptyQueue)
    await click(tabs()[0]!)
    expect(panel().textContent).toContain(vi_.uwSyncEmptyAttention)
    await click(tabs()[2]!)
    expect(panel().textContent).toContain(vi_.uwSyncEmptyRecent)
  })

  it('renders the en copy', async () => {
    await render(fakeApi(snapshot()), 'en')
    expect(tabs().map((t) => t.textContent)).toEqual([
      `${en_.uwSyncTabAttention}2`,
      `${en_.uwSyncTabQueue}1`,
      `${en_.uwSyncTabRecent}1`,
    ])
    expect(host.querySelector('h3')?.textContent).toBe(en_.uwSyncTitle)
    expect(button(en_.uwActCopySupport!)).toBeTruthy()
  })

  it('narrow (< 640px): first action stays, the rest go in the "…" menu', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: ResizeObserverCallback) {}
        observe(el: Element) {
          this.cb(
            [{ target: el, contentRect: { width: 500 } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          )
        }
        unobserve() {}
        disconnect() {}
      },
    )
    const api = fakeApi(snapshot())
    await render(api)
    const cell = rowEl('stuck').querySelector('.sc-actions')!
    const more = button(fill(vi_.uwSyncMoreActions!, { doc: 'Tài liệu stuck' }), cell)
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    expect(buttons(cell).map((b) => b.textContent?.trim() || b.getAttribute('aria-label'))).toEqual(
      [vi_.uwActRecheck, more.getAttribute('aria-label')],
    )
    await click(more)
    const items = Array.from(host.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (el) => el.textContent,
    )
    expect(items).toEqual([vi_.uwActCopySupport, vi_.uwActDownloadMine, vi_.uwActDiscardSave])
    await click(host.querySelectorAll<HTMLElement>('[role="menuitem"]')[0]!)
    expect(api.copySupportCode).toHaveBeenCalledWith('stuck')
  })
})

/** a call that stays pending until the test settles it */
function deferred() {
  let settle!: (r: SyncCenterActionResult) => void
  const promise = new Promise<SyncCenterActionResult>((resolve) => (settle = resolve))
  return { promise, settle }
}

function stubNarrow() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) {
        this.cb(
          [{ target: el, contentRect: { width: 500 } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    },
  )
}

const withAttention = (...rows: SyncCenterRow[]) =>
  snapshot({ tabs: { attention: rows, pending: [], recent: [] } })

const stuckRow = () =>
  row('stuck', 'reconciling_stuck', { reconcileAttempts: 4, supportCode: 'SUP-1' })

describe('SyncCenterPane live announcements (FE-1, FE-5, FE-6, FE-9)', () => {
  it('a new last-sync time alone is not announced again; a status change is read once', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    const line = () => host.querySelector('.sc-status-line')!.textContent
    const before = line()
    const later = snapshot()
    later.header = { ...later.header, lastSyncAt: '2026-10-15T09:45:00.000Z' }
    await act(async () => api.push(later))
    expect(line()).not.toBe(before)
    expect(status().textContent).toBe('')

    const off = snapshot()
    off.header = { ...off.header, online: false, status: 'offline' }
    await act(async () => api.push(off))
    expect(status().textContent).toContain(vi_.uwSyncOffline!.split('{')[0]!.trim())
  })

  it('BE-2n-3: a session with no verdict yet shows the online line without a dangling time', async () => {
    const s = snapshot()
    s.header = { ...s.header, lastSyncAt: undefined }
    await render(fakeApi(s))
    const text = host.querySelector('.sc-status-line')!.textContent!
    expect(text).toContain(vi_.uwSyncOnlineNoTime!)
    expect(text).not.toContain('{')
    expect(text).not.toContain(vi_.uwSyncOnline!.split(' · ')[1]!.split('{')[0]!.trim())
  })

  it('a row the user did not act on that changes state is read once, politely', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    const next = snapshot()
    next.tabs.pending = [row('q', 'failed', { failedReason: 'quota' })]
    await act(async () => api.push(next))
    expect(status().textContent).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: 'Tài liệu q', state: vi_.uwBadgeFailed! }),
    )
  })

  it('copy support leaves the row unmarked: its next real change is announced', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    await click(button(vi_.uwActCopySupport!, rowEl('stuck')))
    await act(async () =>
      api.push(
        withAttention(
          row('stuck', 'failed', { failedReason: 'quota' }),
          row('draft', 'kept_draft'),
        ),
      ),
    )
    expect(status().textContent).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: 'Tài liệu stuck', state: vi_.uwBadgeFailed! }),
    )
  })

  it('a failed call leaves the row unmarked: its next real change is announced', async () => {
    const api = fakeApi(snapshot())
    api.recheck.mockResolvedValueOnce({ ok: false, code: 'store_full' })
    await render(api)
    await click(button(vi_.uwActRecheck!, rowEl('stuck')))
    await act(async () =>
      api.push(
        withAttention(
          row('stuck', 'failed', { failedReason: 'quota' }),
          row('draft', 'kept_draft'),
        ),
      ),
    )
    expect(status().textContent).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: 'Tài liệu stuck', state: vi_.uwBadgeFailed! }),
    )
  })

  it('an ok state change is the user own: not announced, and the mark ends with the next snapshot', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    await click(button(vi_.uwActRecheck!, rowEl('stuck')))
    await act(async () =>
      api.push(
        withAttention(
          row('stuck', 'failed', { failedReason: 'quota' }),
          row('draft', 'kept_draft'),
        ),
      ),
    )
    expect(status().textContent).toBe('')
    await act(async () =>
      api.push(
        withAttention(
          row('stuck', 'blocked', { blockedReason: 'session_expired' }),
          row('draft', 'kept_draft'),
        ),
      ),
    )
    expect(status().textContent).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: 'Tài liệu stuck', state: vi_.uwBadgeBlocked! }),
    )
  })

  it('the same refusal twice in a row is announced twice', async () => {
    const api = fakeApi(withAttention(row('bad', 'failed', { failedReason: 'quota' })))
    api.saveAgain.mockResolvedValue({ ok: false, code: 'store_full' })
    await render(api)
    await click(button(vi_.uwActSaveAgain!, rowEl('bad')))
    const first = status().firstElementChild
    expect(first).not.toBeNull()
    const text = status().textContent
    expect(text).toContain(vi_.uwQueueFull)
    await click(button(vi_.uwActSaveAgain!, rowEl('bad')))
    expect(status().textContent).toBe(text)
    expect(status().firstElementChild).not.toBe(first)
  })
})

describe('SyncCenterPane open confirm (FE-2, FE-4, FE-9)', () => {
  it('a pushed snapshot that drops the confirmed action closes the confirm; nothing runs', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    await click(button(vi_.uwActDiscardDraft!, rowEl('draft')))
    expect(rowEl('draft').textContent).toContain(vi_.uwDiscardDraftConfirm)
    await act(async () =>
      api.push(
        withAttention(stuckRow(), row('draft', 'uploading', { progress: { done: 1, total: 2 } })),
      ),
    )
    expect(host.textContent).not.toContain(vi_.uwDiscardDraftConfirm)
    expect(api.discardDraft).not.toHaveBeenCalled()
  })

  it('a confirm for a row that left and came back does not reappear', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    await click(button(vi_.uwActDiscardDraft!, rowEl('draft')))
    await act(async () => api.push(withAttention(stuckRow())))
    expect(document.activeElement).toBe(panel())
    await act(async () => api.push(snapshot()))
    expect(host.textContent).not.toContain(vi_.uwDiscardDraftConfirm)
    expect(api.discardDraft).not.toHaveBeenCalled()
  })

  it('an unrelated push keeps the confirm the user is reading', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    await click(button(vi_.uwActDiscardDraft!, rowEl('draft')))
    const later = snapshot()
    later.header = { ...later.header, lastSyncAt: '2026-10-15T09:45:00.000Z' }
    await act(async () => api.push(later))
    expect(rowEl('draft').textContent).toContain(vi_.uwDiscardDraftConfirm)
    expect(document.activeElement).toBe(button(vi_.uwActBack!, rowEl('draft')))
  })

  it('Go pressed again while the call runs does not call twice or close the confirm early', async () => {
    const api = fakeApi(snapshot())
    const pending = deferred()
    api.discardDraft.mockImplementationOnce(() => pending.promise)
    await render(api)
    await click(button(vi_.uwActDiscardDraft!, rowEl('draft')))
    const go = button(vi_.uwActDiscard!, rowEl('draft'))
    await click(go)
    await click(go)
    expect(api.discardDraft).toHaveBeenCalledTimes(1)
    expect(go.getAttribute('aria-disabled')).toBe('true')
    expect(rowEl('draft').textContent).toContain(vi_.uwDiscardDraftConfirm)
    await act(async () => pending.settle({ ok: true }))
    await flush()
    expect(rowEl('draft').textContent).not.toContain(vi_.uwDiscardDraftConfirm)
  })

  it('a call that settles does not close the confirm another row opened meanwhile', async () => {
    const api = fakeApi(snapshot())
    const pending = deferred()
    api.discardDraft.mockImplementationOnce(() => pending.promise)
    await render(api)
    await click(button(vi_.uwActDiscardDraft!, rowEl('draft')))
    await click(button(vi_.uwActDiscard!, rowEl('draft')))
    await click(button(vi_.uwActDiscardSave!, rowEl('stuck')))
    expect(rowEl('stuck').textContent).toContain(vi_.uwStuckDiscardConfirm)
    const back = button(vi_.uwActBack!, rowEl('stuck'))
    expect(document.activeElement).toBe(back)
    await act(async () => pending.settle({ ok: true }))
    await flush()
    expect(rowEl('stuck').textContent).toContain(vi_.uwStuckDiscardConfirm)
    expect(document.activeElement).toBe(back)
  })

  it('Escape closes the confirm without reaching the Settings dialog; focus returns to the trigger', async () => {
    const outer = vi.fn()
    document.body.addEventListener('keydown', outer)
    try {
      await render(fakeApi(snapshot()))
      const trigger = button(vi_.uwActDiscardDraft!, rowEl('draft'))
      trigger.focus()
      await click(trigger)
      const back = button(vi_.uwActBack!, rowEl('draft'))
      expect(document.activeElement).toBe(back)
      await key(back, 'Escape')
      expect(outer).not.toHaveBeenCalled()
      expect(rowEl('draft').textContent).not.toContain(vi_.uwDiscardDraftConfirm)
      expect(document.activeElement).toBe(button(vi_.uwActDiscardDraft!, rowEl('draft')))
    } finally {
      document.body.removeEventListener('keydown', outer)
    }
  })

  it('narrow: Back returns focus to the "…" trigger the confirm came from', async () => {
    stubNarrow()
    await render(fakeApi(snapshot()))
    const label = fill(vi_.uwSyncMoreActions!, { doc: 'Tài liệu stuck' })
    await click(button(label, rowEl('stuck')))
    const items = Array.from(host.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    await click(items.find((el) => el.textContent === vi_.uwActDiscardSave)!)
    expect(rowEl('stuck').textContent).toContain(vi_.uwStuckDiscardConfirm)
    await click(button(vi_.uwActBack!, rowEl('stuck')))
    expect(document.activeElement).toBe(button(label, rowEl('stuck')))
    expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('menu')
  })

  it('switching tabs closes the open confirm; it is not there when the tab comes back', async () => {
    const api = fakeApi(snapshot())
    await render(api)
    await click(button(vi_.uwActDiscardDraft!, rowEl('draft')))
    await click(tabs()[1]!)
    expect(host.textContent).not.toContain(vi_.uwDiscardDraftConfirm)
    await click(tabs()[0]!)
    expect(host.textContent).not.toContain(vi_.uwDiscardDraftConfirm)
    expect(api.discardDraft).not.toHaveBeenCalled()
  })
})

describe('SyncCenterPane per-row busy (FE-3)', () => {
  it('while Lưu lại runs, the row other actions are aria-disabled and do nothing', async () => {
    const api = fakeApi(withAttention(row('bad', 'failed', { failedReason: 'quota' })))
    const pending = deferred()
    api.saveAgain.mockImplementationOnce(() => pending.promise)
    await render(api)
    await click(button(vi_.uwActSaveAgain!, rowEl('bad')))
    expect(api.saveAgain).toHaveBeenCalledTimes(1)
    const cancel = button(vi_.uwQueueCancel!, rowEl('bad'))
    expect(cancel.getAttribute('aria-disabled')).toBe('true')
    await click(cancel)
    expect(rowEl('bad').textContent).not.toContain(vi_.uwQueueCancelConfirm)
    expect(api.cancelSave).not.toHaveBeenCalled()
    await act(async () => pending.settle({ ok: true }))
    await flush()
    expect(button(vi_.uwQueueCancel!, rowEl('bad')).getAttribute('aria-disabled')).toBeNull()
    await click(button(vi_.uwQueueCancel!, rowEl('bad')))
    expect(rowEl('bad').textContent).toContain(vi_.uwQueueCancelConfirm)
  })

  it('another row is not held back by a busy row', async () => {
    const api = fakeApi(snapshot())
    const pending = deferred()
    api.recheck.mockImplementationOnce(() => pending.promise)
    await render(api)
    await click(button(vi_.uwActRecheck!, rowEl('stuck')))
    expect(button(vi_.uwActDiscardSave!, rowEl('stuck')).getAttribute('aria-disabled')).toBe('true')
    expect(button(vi_.uwActOpenDraft!, rowEl('draft')).getAttribute('aria-disabled')).toBeNull()
    await click(button(vi_.uwActOpenDraft!, rowEl('draft')))
    expect(api.openDraft).toHaveBeenCalledWith('draft')
    await act(async () => pending.settle({ ok: true }))
  })
})

describe('SyncCenterPane foreign account and loading (FE-8, FE-11)', () => {
  const SECRET = 'Báo cáo mật của tài khoản khác'
  const foreign = () => row('f', 'blocked', { blockedReason: 'foreign_account', title: SECRET })

  it('a blocked foreign_account row shows no title anywhere and no document button', async () => {
    await render(fakeApi(withAttention(foreign())))
    expect(host.querySelector('.sc-doc-btn')).toBeNull()
    expect(host.innerHTML).not.toContain(SECRET)
    expect(rowEl('f').getAttribute('aria-label')).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: vi_.uwLockForeignTitle!, state: vi_.uwBadgeLocked! }),
    )
  })

  it('a row that becomes foreign_account loses its title from the page and the live text', async () => {
    const api = fakeApi(
      withAttention(row('f', 'blocked', { blockedReason: 'session_expired', title: SECRET })),
    )
    await render(api)
    expect(rowEl('f').getAttribute('aria-label')).toContain(SECRET)
    await act(async () => api.push(withAttention(foreign())))
    expect(status().textContent).toBe(
      fill(vi_.uwSyncRowAnnounce!, { doc: vi_.uwLockForeignTitle!, state: vi_.uwBadgeLocked! }),
    )
    expect(host.innerHTML).not.toContain(SECRET)
    expect(host.querySelector('.sc-doc-btn')).toBeNull()
  })

  it('narrow: a foreign_account row has no "…" menu and still no title', async () => {
    stubNarrow()
    await render(fakeApi(withAttention(foreign())))
    expect(host.querySelector('[aria-haspopup="menu"]')).toBeNull()
    expect(host.innerHTML).not.toContain(SECRET)
  })

  it('the loading skeleton has accessible loading text', async () => {
    await render(fakeApi(null))
    const skeleton = host.querySelector('.sc-skeleton')!
    expect(skeleton.getAttribute('aria-busy')).toBe('true')
    expect(wbLoading).not.toBe('')
    expect(skeleton.querySelector('.uw-sr-only')?.textContent).toBe(wbLoading)
  })
})

describe('SyncCenterPane visual review fixes (VIS-1..VIS-8)', () => {
  const css = readFileSync(resolve(__dirname, '../src/renderer/src/sync-center.css'), 'utf8')
  const ruleBody = (selector: string): string => {
    const at = css.indexOf(`${selector} {`)
    if (at < 0) throw new Error(`no css rule "${selector}"`)
    return css.slice(css.indexOf('{', at), css.indexOf('}', at))
  }

  it('VIS-3: the conflict row Mở để xử lý is the primary action, the other actions are not', async () => {
    await render(
      fakeApi(
        snapshot({
          tabs: {
            attention: [
              row('conf', 'conflict', { conflict: { version: 9, author: 'Lan', savedAt: 't' } }),
              row('stuck', 'reconciling_stuck', { reconcileAttempts: 4, supportCode: 'SUP-1' }),
            ],
            pending: [],
            recent: [],
          },
        }),
      ),
    )
    const open = button(vi_.uwActOpenToResolve!, rowEl('conf'))
    expect(open.classList.contains('primary')).toBe(true)
    for (const b of buttons(rowEl('stuck').querySelector('.sc-actions')!)) {
      expect(b.classList.contains('primary')).toBe(false)
    }
  })

  it('VIS-1: the discard actions carry the danger class and the danger rule outranks .set-btn', async () => {
    await render(fakeApi(snapshot()))
    expect(button(vi_.uwActDiscardSave!, rowEl('stuck')).classList.contains('sc-act-danger')).toBe(
      true,
    )
    expect(button(vi_.uwActDiscardDraft!, rowEl('draft')).classList.contains('sc-act-danger')).toBe(
      true,
    )
    expect(button(vi_.uwActRecheck!, rowEl('stuck')).classList.contains('sc-act-danger')).toBe(
      false,
    )
    // `.set-btn` (settings.css) loads later: the danger rule needs more specificity than one class
    const body = ruleBody('.sc .set-btn.sc-act-danger')
    expect(body).toContain('color: var(--danger-text)')
    expect(body).toContain('border: 1px solid var(--danger-border)')
    expect(css).toContain(
      ".sc .set-btn.sc-act-danger:hover:not(:disabled):not([aria-disabled='true'])",
    )
    expect(css).toContain('.sc .set-btn.sc-act-danger:focus-visible')
  })

  it('VIS-2n: a long action wraps inside the fixed actions column instead of overrunning it', () => {
    // `.set-btn` is nowrap at a fixed 28px: the row action rule must outrank it to wrap
    const act = ruleBody('.sc .set-btn.sc-act')
    expect(act).toContain('white-space: normal')
    expect(act).toContain('max-width: 100%')
    expect(act).toContain('height: auto')
    expect(ruleBody('.sc-act-wrap')).toContain('max-width: calc(100% - 6px)')
    expect(ruleBody('.sc-act')).toContain('min-height: 28px')
    // VIS-6: the column widths themselves do not move
    expect(ruleBody('.sc-col-actions')).toContain('width: 25%')
    expect(ruleBody('.sc-col-state')).toContain('width: 148px')
  })

  it('VIS-2 and VIS-6: fixed column widths, a status column that holds a pill, doc wider than details', () => {
    expect(ruleBody('.sc-table')).toContain('table-layout: fixed')
    expect(ruleBody('.sc-col-state')).toMatch(/width: 1[4-9]\d+px/)
    const pct = (sel: string) => Number(/width: (\d+)%/.exec(ruleBody(sel))?.[1])
    expect(pct('.sc-col-doc')).toBeGreaterThan(pct('.sc-col-detail'))
  })

  it('VIS-5: Tài liệu / Trạng thái / Chi tiết are visible real column headers; Hành động stays screen-reader only', async () => {
    await render(fakeApi(snapshot()))
    const heads = Array.from(host.querySelectorAll<HTMLElement>('thead th[scope="col"]'))
    expect(heads.map((h) => h.textContent)).toEqual([
      vi_.uwSyncColDoc,
      vi_.uwSyncColState,
      vi_.uwSyncColDetail,
      vi_.uwSyncColActions,
    ])
    for (const h of heads.slice(0, 3)) {
      expect(h.classList.contains('sc-col-hidden')).toBe(false)
      expect(h.querySelector('.sc-col-hidden')).toBeNull()
    }
    expect(heads[3]!.querySelector('.sc-col-hidden')?.textContent).toBe(vi_.uwSyncColActions)
  })

  it('VIS-4: signed out is an informational line (neutral tone) with Đăng nhập as the primary button', async () => {
    const s = snapshot({
      signedOut: { lockedCount: 3 },
      tabs: { attention: [], pending: [], recent: [] },
    })
    s.header = { ...s.header, status: 'signed_out', account: undefined, storeBudget: undefined }
    await render(fakeApi(s))
    const line = host.querySelector('.sc-status-line')!
    expect(line.getAttribute('data-tone')).toBe('neutral')
    expect(button(vi_.uwActSignIn!, line).classList.contains('primary')).toBe(true)
    expect(css).not.toMatch(/sc-status-line\[data-tone='neutral'\]\s*\{[^}]*danger/)
  })

  it('VIS-8: a store error shows only the notice and Thử lại, no connected line or sync controls', async () => {
    await render(
      fakeApi(snapshot({ storeError: true, tabs: { attention: [], pending: [], recent: [] } })),
    )
    expect(host.querySelector('.sc-store-error')?.textContent).toContain(vi_.uwSyncStoreError)
    expect(host.querySelector('.sc-header')).toBeNull()
    expect(host.querySelector('.sc-status-line')).toBeNull()
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([vi_.uwActRetry])
    expect(ruleBody('.sc-store-error')).toContain('font-size: 13px')
  })

  it('VIS-8: a snapshot that cannot be read leaves no header either', async () => {
    const api = fakeApi(snapshot())
    api.getSnapshot.mockImplementation(() => Promise.reject(new Error('boom')))
    await render(api)
    expect(host.querySelector('.sc-store-error')).not.toBeNull()
    expect(host.querySelector('.sc-header')).toBeNull()
  })
})
