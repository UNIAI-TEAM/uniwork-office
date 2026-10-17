/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lang } from '@genoffice/i18n'
import type {
  OfflineLibrarySnapshot,
  OfflineResult,
  OfflineRowState,
  OfflineRowView,
  OfflineUnpinResult,
} from '../src/shared/offline-library'
import type {
  SyncCenterActionResult,
  SyncCenterRow,
  SyncCenterSnapshot,
} from '../src/shared/sync-center'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SyncCenterPane } from '../src/renderer/src/SyncCenterPane'
import { openSyncCenter } from '../src/renderer/src/offline-library-model'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

/**
 * G5-05u F1-F4 (UNI-1360): the S3 tab "Dùng khi không có mạng" of the sync
 * center, with real string shards. The Open dialog is replaced by a stub that
 * records its props (the pin mode itself is covered in
 * offline-open-dialog-pin.test.ts).
 */

const dialogProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }))
vi.mock('../src/renderer/src/UniworkOpenDialog', () => ({
  UniworkOpenDialog: (props: Record<string, unknown>) => {
    dialogProps.last = props
    return null
  },
}))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const VI = { ...syncStrings.vi, ...uniworkDocumentStrings.vi } as Record<string, string>
const EN = { ...syncStrings.en, ...uniworkDocumentStrings.en } as Record<string, string>
const fill = (s: string, params: Record<string, string | number> = {}) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
const vi_ = (k: string, p?: Record<string, string | number>) => fill(VI[k]!, p)

const GIB = 1024 ** 3
const MIB = 1024 ** 2

const offRow = (
  id: string,
  state: OfflineRowState,
  over: Partial<OfflineRowView> = {},
): OfflineRowView => ({
  documentId: id,
  workspaceId: 'w1',
  name: `Tệp ${id}.docx`,
  state,
  progress: null,
  version: 4,
  headVersion: null,
  sizeBytes: 2 * MIB,
  leaseUntil: null,
  leaseLevel: 'edit',
  updateKeptReason: null,
  open: false,
  ...over,
})

const library = (over: Partial<OfflineLibrarySnapshot> = {}): OfflineLibrarySnapshot => ({
  visible: true,
  capabilityOn: true,
  quota: { usedBytes: 512 * MIB, maxBytes: 2 * GIB, pins: 1, maxPins: 200 },
  rows: [offRow('a', 'ready')],
  ...over,
})

const syncRow = (id: string): SyncCenterRow => ({
  id,
  documentId: `doc-${id}`,
  documentKey: `key-${id}`,
  title: `Tài liệu ${id}`,
  ext: 'docx',
  state: 'queued',
  savedAt: '2026-10-15T08:00:00.000Z',
  canEdit: true,
})

const snapshot = (
  offline: OfflineLibrarySnapshot,
  over: Partial<SyncCenterSnapshot> = {},
): SyncCenterSnapshot => ({
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
    storeBudget: { used: MIB, cap: GIB },
  },
  storeError: false,
  tabs: { attention: [syncRow('x')], pending: [syncRow('q'), syncRow('r')], recent: [] },
  offline,
  defaultTab: 'attention',
  ...over,
})

function fakeApi(initial: SyncCenterSnapshot) {
  let listener: ((s: SyncCenterSnapshot) => void) | null = null
  const ok = (): Promise<SyncCenterActionResult> => Promise.resolve({ ok: true })
  const done = (): Promise<OfflineResult> => Promise.resolve({ ok: true })
  return {
    getSnapshot: vi.fn(() => Promise.resolve(initial)),
    subscribe: vi.fn((cb: (s: SyncCenterSnapshot) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    }),
    push: (s: SyncCenterSnapshot) => listener?.(s),
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
    offlinePin: vi.fn(done),
    offlineUnpin: vi.fn((): Promise<OfflineUnpinResult> =>
      Promise.resolve({ ok: true, deferred: false }),
    ),
    offlineCancel: vi.fn(done),
    offlineDownloadNow: vi.fn(done),
    offlineOpen: vi.fn(done),
    offlineOpenFolder: vi.fn(done),
    offlineState: vi.fn(),
  }
}

type Fake = ReturnType<typeof fakeApi>

let host: HTMLDivElement
let root: Root
let onSignIn: ReturnType<typeof vi.fn>
let onSwitchAccount: ReturnType<typeof vi.fn>

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  onSignIn = vi.fn()
  onSwitchAccount = vi.fn()
  dialogProps.last = null
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
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
          api: api as never,
          onSignIn,
          onSwitchAccount,
        }),
      ),
    )
  })
  await flush()
}

const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
const tabNamed = (label: string) => tabs().find((t) => t.textContent?.startsWith(label))!
const panel = () => host.querySelector<HTMLElement>('[role="tabpanel"]')!
const status = () => host.querySelector<HTMLElement>('[role="status"]')!
const rowEl = (id: string) => host.querySelector<HTMLElement>(`tr[data-row-id="${id}"]`)!
const actionsOf = (id: string) =>
  Array.from(rowEl(id).querySelectorAll<HTMLButtonElement>('.sc-actions button')).map(
    (b) => b.textContent,
  )
const click = async (el: HTMLElement) => {
  await act(async () => el.click())
  await flush()
}
const key = async (el: HTMLElement, k: string) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

/** render the pane with `offline` and open the S3 tab */
async function openS3(offline: OfflineLibrarySnapshot, lang: Lang = 'vi', over = {}) {
  const api = fakeApi(snapshot(offline, over))
  await render(api, lang)
  await click(tabNamed(lang === 'vi' ? VI.uwSyncTabOffline! : EN.uwSyncTabOffline!))
  return api
}

const READY_LEASE = '2026-12-01T09:00:00.000Z'

/** EXPERIENCE.md › Offline library rows (S3): one row per state, badge + tone, sub-line, actions */
const S3_TABLE: {
  name: string
  row: OfflineRowView
  badge: string
  tone: string
  sub: (r: OfflineRowView) => string
  actions: string[]
}[] = [
  {
    name: 'waiting-network',
    row: offRow('w', 'waiting-network'),
    badge: 'uwOfflineBadgeWaiting',
    tone: 'info',
    sub: () => vi_('uwOfflineRowWaiting'),
    actions: ['uwOfflineUnpinShort'],
  },
  {
    name: 'downloading',
    row: offRow('d', 'downloading', { progress: { done: MIB, total: 4 * MIB } }),
    badge: 'uwOfflineBadgeDownloading',
    tone: 'info',
    sub: () => vi_('uwOfflineRowProgress', { done: '1 MB', total: '4 MB' }),
    actions: ['uwOfflineCancelDownload'],
  },
  {
    name: 'verifying',
    row: offRow('v', 'verifying'),
    badge: 'uwOfflineBadgeVerifying',
    tone: 'info',
    sub: () => vi_('uwOfflineRowVerifying'),
    actions: [],
  },
  {
    name: 'ready',
    row: offRow('r', 'ready', { version: 7, leaseUntil: null }),
    badge: 'uwOfflineReady',
    tone: 'ok',
    sub: () => vi_('uwOfflineRowReady', { n: 7, size: '2 MB', datetime: '—' }),
    actions: ['uwActOpen', 'uwOfflineUnpinShort'],
  },
  {
    name: 'update-available',
    row: offRow('u', 'update-available', { version: 3, headVersion: 5 }),
    badge: 'uwOfflineBadgeUpdate',
    tone: 'info',
    sub: () => vi_('uwOfflineRowUpdate', { n: 5, old: 3 }),
    actions: ['uwActOpen', 'uwOfflineDownloadNow', 'uwOfflineUnpinShort'],
  },
  {
    name: 'update-kept',
    row: offRow('k', 'update-kept', {
      version: 3,
      headVersion: 5,
      updateKeptReason: 'too_large',
    }),
    badge: 'uwOfflineReady',
    tone: 'ok',
    sub: () => vi_('uwOfflineRowUpdateKept', { n: 5, old: 3, reason: VI.uwReasonTooLarge! }),
    actions: ['uwActOpen', 'uwActRetry'],
  },
  {
    name: 'interrupted',
    row: offRow('i', 'interrupted'),
    badge: 'uwOfflineBadgeInterrupted',
    tone: 'warn',
    sub: () => vi_('uwOfflineRowInterrupted'),
    actions: ['uwActRetry', 'uwOfflineUnpinShort'],
  },
  {
    name: 'disk-full',
    row: offRow('f', 'disk-full', { diskNeededBytes: 3 * MIB }),
    badge: 'uwOfflineBadgeDiskFull',
    tone: 'error',
    sub: () => vi_('uwOfflineRowDiskFull', { size: '3 MB' }),
    actions: ['uwActRetry', 'uwOfflineOpenFolder'],
  },
  {
    name: 'corrupt',
    row: offRow('c', 'corrupt'),
    badge: 'uwOfflineBadgeCorrupt',
    tone: 'error',
    sub: () => vi_('uwOfflineRowCorrupt'),
    actions: ['uwOfflineDownloadNow'],
  },
  {
    name: 'lease-expiring',
    row: offRow('s', 'lease-expiring', { leaseUntil: null }),
    badge: 'uwOfflineBadgeLeaseSoon',
    tone: 'warn',
    sub: () => vi_('uwOfflineRowLeaseSoon', { datetime: '—' }),
    actions: ['uwActOpen', 'uwOfflineUnpinShort'],
  },
  {
    name: 'lease-expired',
    row: offRow('e', 'lease-expired', { lockReason: 'lease_expired' }),
    badge: 'uwBadgeReconnect',
    tone: 'error',
    sub: () => vi_('uwRowBlocked', { reason: VI.uwReasonLease! }),
    actions: ['uwActReconnect'],
  },
  {
    name: 'locked',
    row: offRow('l', 'locked', { lockReason: 'keystore_locked' }),
    badge: 'uwBadgeKeystore',
    tone: 'error',
    sub: () => vi_('uwRowBlocked', { reason: VI.uwReasonKeystore! }),
    actions: ['uwActRetry'],
  },
  {
    name: 'revoked',
    row: offRow('x', 'revoked'),
    badge: 'uwBadgeRevoked',
    tone: 'error',
    sub: () => vi_('uwOfflineRowRevoked'),
    actions: ['uwOfflineUnpinShort'],
  },
  {
    name: 'deleted',
    row: offRow('y', 'deleted'),
    badge: 'uwBadgeDeleted',
    tone: 'error',
    sub: () => vi_('uwOfflineRowDeleted'),
    actions: ['uwOfflineUnpinShort'],
  },
  {
    name: 'archived',
    row: offRow('z', 'archived'),
    badge: 'uwBadgeArchived',
    tone: 'info',
    sub: () => vi_('uwOfflineRowArchived'),
    actions: ['uwActOpen', 'uwOfflineUnpinShort'],
  },
  {
    name: 'moved',
    row: offRow('m', 'moved'),
    badge: 'uwBadgeMoved',
    tone: 'info',
    sub: () => vi_('uwOfflineRowMoved', { workspace: '—' }),
    actions: ['uwActOpen', 'uwOfflineUnpinShort'],
  },
  {
    name: 'view-only',
    row: offRow('o', 'view-only', { version: 2, leaseLevel: 'view' }),
    badge: 'uwOfflineBadgeViewOnly',
    tone: 'ok',
    sub: () => vi_('uwOfflineRowViewOnly', { n: 2, datetime: '—' }),
    actions: ['uwActOpen', 'uwOfflineUnpinShort'],
  },
]

describe('S3 rows (badge, sub-line, actions per state)', () => {
  it('covers all 17 rows of the S3 table', () => {
    expect(S3_TABLE).toHaveLength(17)
  })

  it.each(S3_TABLE)('$name: badge, tone, sub-line and the exact action set', async (c) => {
    await openS3(library({ rows: [c.row] }))
    const tr = rowEl(c.row.documentId)
    const badge = tr.querySelector<HTMLElement>('.sc-badge')!
    expect(badge.textContent).toBe(VI[c.badge])
    expect(badge.dataset.tone).toBe(c.tone)
    expect(tr.querySelector('.sc-sub')!.textContent).toBe(c.sub(c.row))
    expect(actionsOf(c.row.documentId)).toEqual(c.actions.map((k) => VI[k]))
    // no row offers editing an offline copy (edit-lock alignment)
    expect(tr.textContent).not.toMatch(/Giữ quyền sửa|Bỏ giữ/)
  })

  it('revoked and deleted rows have no "Mở": the name is plain text', async () => {
    await openS3(library({ rows: [offRow('x', 'revoked'), offRow('y', 'deleted')] }))
    for (const id of ['x', 'y']) {
      expect(rowEl(id).querySelector('.sc-doc-btn')).toBeNull()
      expect(rowEl(id).querySelector('.sc-doc-text')!.textContent).toBe(`Tệp ${id}.docx`)
    }
  })

  it('a ready row names its lease expiry, formatted', async () => {
    await openS3(library({ rows: [offRow('r', 'ready', { leaseUntil: READY_LEASE })] }))
    const sub = rowEl('r').querySelector('.sc-sub')!.textContent!
    expect(sub.startsWith(vi_('uwOfflineRowReady', { n: 4, size: '2 MB', datetime: '' }))).toBe(
      true,
    )
    expect(sub).not.toContain('—')
  })

  it('a multi-condition row shows the state main sent (no re-ranking)', async () => {
    // a revoked copy that is also open, has an expired lease and a kept update: main says
    // "interrupted" here, and the row shows exactly that
    await openS3(
      library({
        rows: [
          offRow('mc', 'interrupted', {
            lockReason: 'permission_revoked',
            updateKeptReason: 'too_large',
            headVersion: 9,
            open: true,
          }),
        ],
      }),
    )
    expect(rowEl('mc').querySelector('.sc-badge')!.textContent).toBe(VI.uwOfflineBadgeInterrupted)
    expect(rowEl('mc').querySelector('.sc-sub')!.textContent).toBe(vi_('uwOfflineRowInterrupted'))
  })

  it('lease_expired while the capability is off: same badge and reason, only Bỏ ghim', async () => {
    await openS3(
      library({
        capabilityOn: false,
        rows: [offRow('e', 'lease-expired', { lockReason: 'lease_expired', libraryOff: true })],
      }),
    )
    expect(rowEl('e').querySelector('.sc-badge')!.textContent).toBe(VI.uwBadgeReconnect)
    expect(actionsOf('e')).toEqual([VI.uwOfflineUnpinShort])
  })

  it('the S3 actions call main with the row id (download, retry, cancel, folder, open)', async () => {
    const api = await openS3(
      library({
        rows: [
          offRow('u', 'update-available', { headVersion: 5 }),
          offRow('i', 'interrupted'),
          offRow('d', 'downloading', { progress: { done: 1, total: 2 } }),
          offRow('f', 'disk-full'),
        ],
      }),
    )
    const act_ = (id: string, label: string) =>
      Array.from(rowEl(id).querySelectorAll<HTMLButtonElement>('.sc-actions button')).find(
        (b) => b.textContent === label,
      )!
    await click(act_('u', VI.uwOfflineDownloadNow!))
    expect(api.offlineDownloadNow).toHaveBeenLastCalledWith('u')
    await click(act_('i', VI.uwActRetry!))
    expect(api.offlineDownloadNow).toHaveBeenLastCalledWith('i')
    await click(act_('d', VI.uwOfflineCancelDownload!))
    expect(api.offlineCancel).toHaveBeenCalledWith('d')
    await click(act_('f', VI.uwOfflineOpenFolder!))
    expect(api.offlineOpenFolder).toHaveBeenCalledTimes(1)
    await click(act_('u', VI.uwActOpen!))
    expect(api.offlineOpen).toHaveBeenCalledWith('u')
  })
})

describe('S3 progress', () => {
  it('a downloading row has a named progressbar with aria-valuetext and visible bytes', async () => {
    await openS3(
      library({ rows: [offRow('d', 'downloading', { progress: { done: MIB, total: 4 * MIB } })] }),
    )
    const bar = rowEl('d').querySelector<HTMLElement>('[role="progressbar"]')!
    const nameId = bar.getAttribute('aria-labelledby')!
    expect(host.querySelector(`[id="${nameId}"]`)!.textContent).toBe('Tệp d.docx')
    expect(bar.getAttribute('aria-valuenow')).toBe(String(MIB))
    expect(bar.getAttribute('aria-valuemax')).toBe(String(4 * MIB))
    expect(bar.getAttribute('aria-valuetext')).toBe(
      vi_('uwOfflineRowProgressAria', { done: '1 MB', total: '4 MB' }),
    )
    expect(rowEl('d').querySelector('.sc-sub')!.textContent).toBe(
      vi_('uwOfflineRowProgress', { done: '1 MB', total: '4 MB' }),
    )
  })

  it('reaching ready is announced once, politely; progress steps are not', async () => {
    const downloading = library({
      rows: [offRow('d', 'downloading', { progress: { done: 1, total: 4 } })],
    })
    const api = await openS3(downloading)
    await act(async () =>
      api.push(
        snapshot(
          library({ rows: [offRow('d', 'downloading', { progress: { done: 3, total: 4 } })] }),
        ),
      ),
    )
    expect(status().textContent).toBe('')
    await act(async () => api.push(snapshot(library({ rows: [offRow('d', 'ready')] }))))
    expect(status().textContent).toBe(vi_('uwOfflineReadyAnnounce', { doc: 'Tệp d.docx' }))
    const said = status().textContent
    await act(async () =>
      api.push(snapshot(library({ rows: [offRow('d', 'ready', { version: 5 })] }))),
    )
    expect(status().textContent).toBe(said)
    expect(status().querySelectorAll('span')).toHaveLength(1)
  })

  it('first snapshot with a row already ready is not announced', async () => {
    await openS3(library({ rows: [offRow('r', 'ready')] }))
    expect(status().textContent).toBe('')
  })

  it('a new row that arrives already ready is not announced', async () => {
    const api = await openS3(library({ rows: [offRow('a', 'ready')] }))
    await act(async () =>
      api.push(snapshot(library({ rows: [offRow('a', 'ready'), offRow('b', 'ready')] }))),
    )
    expect(status().textContent).toBe('')
  })

  it('two rows downloading->ready in one push are both announced', async () => {
    const api = await openS3(
      library({
        rows: [
          offRow('a', 'downloading', { progress: { done: 1, total: 2 } }),
          offRow('b', 'downloading', { progress: { done: 1, total: 2 } }),
        ],
      }),
    )
    await act(async () =>
      api.push(snapshot(library({ rows: [offRow('a', 'ready'), offRow('b', 'ready')] }))),
    )
    expect(status().textContent).toContain(vi_('uwOfflineReadyAnnounce', { doc: 'Tệp a.docx' }))
    expect(status().textContent).toContain(vi_('uwOfflineReadyAnnounce', { doc: 'Tệp b.docx' }))
  })

  it('lease-expiring->ready and update-available->ready are silent', async () => {
    const api = await openS3(
      library({
        rows: [
          offRow('s', 'lease-expiring'),
          offRow('u', 'update-available', { version: 1, headVersion: 2 }),
        ],
      }),
    )
    await act(async () =>
      api.push(snapshot(library({ rows: [offRow('s', 'ready'), offRow('u', 'ready')] }))),
    )
    expect(status().textContent).toBe('')
  })

  it('total <= 0 or unknown renders an indeterminate progressbar without aria-valuenow/max', async () => {
    await openS3(
      library({
        rows: [
          offRow('d', 'downloading', { progress: null, sizeBytes: null }),
          offRow('z', 'downloading', { progress: { done: 512, total: 0 } }),
        ],
      }),
    )
    for (const id of ['d', 'z']) {
      const bar = rowEl(id).querySelector<HTMLElement>('[role="progressbar"]')!
      const nameId = bar.getAttribute('aria-labelledby')!
      expect(host.querySelector(`[id="${nameId}"]`)!.textContent).toBe(`Tệp ${id}.docx`)
      expect(bar.getAttribute('aria-valuemin')).toBeNull()
      expect(bar.getAttribute('aria-valuenow')).toBeNull()
      expect(bar.getAttribute('aria-valuemax')).toBeNull()
      expect(bar.getAttribute('aria-valuetext')).toBeNull()
      expect(rowEl(id).textContent).not.toContain('0 B')
    }
    expect(rowEl('z').querySelector('.sc-sub')!.textContent).toBe('512 B')
  })
})

describe('S3 tab in the tablist', () => {
  it('four tabs in order attention, pending, offline, recent; the S3 count is its rows', async () => {
    await render(
      fakeApi(snapshot(library({ rows: [offRow('a', 'ready'), offRow('b', 'corrupt')] }))),
    )
    expect(tabs().map((t) => t.textContent?.replace(/\d+$/, ''))).toEqual([
      VI.uwSyncTabAttention,
      VI.uwSyncTabQueue,
      VI.uwSyncTabOffline,
      VI.uwSyncTabRecent,
    ])
    expect(tabs()[2]!.getAttribute('aria-label')).toBe(
      vi_('uwSyncTabCount', { label: VI.uwSyncTabOffline!, count: 2 }),
    )
  })

  it('arrows, Home and End move across the four tabs with a roving tabindex', async () => {
    await render(fakeApi(snapshot(library())))
    await key(tabs()[0]!, 'ArrowRight')
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true')
    await key(tabs()[1]!, 'ArrowRight')
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1])
    expect(document.activeElement).toBe(tabs()[2])
    await key(tabs()[2]!, 'ArrowRight')
    expect(tabs()[3]!.getAttribute('aria-selected')).toBe('true')
    await key(tabs()[3]!, 'ArrowRight')
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true')
    await key(tabs()[0]!, 'End')
    expect(tabs()[3]!.getAttribute('aria-selected')).toBe('true')
    await key(tabs()[3]!, 'ArrowLeft')
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true')
    expect(panel().getAttribute('aria-labelledby')).toBe(tabs()[2]!.id)
    await key(tabs()[2]!, 'Home')
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('hidden while main says the library is not visible: three tabs as before', async () => {
    await render(fakeApi(snapshot(library({ visible: false, capabilityOn: false, rows: [] }))))
    expect(tabs()).toHaveLength(3)
    expect(tabs().some((t) => t.textContent?.startsWith(VI.uwSyncTabOffline!))).toBe(false)
  })

  it('the usage line and "Thêm tài liệu…" sit inside the tabpanel, above the table', async () => {
    await openS3(library())
    const usage = panel().querySelector<HTMLElement>('.sc-usage')!
    expect(usage).not.toBeNull()
    expect(usage.textContent).toContain(vi_('uwOfflineUsage', { used: '512 MB', cap: '2 GB' }))
    expect(usage.querySelector('button')!.textContent).toBe(VI.uwOfflineAdd)
    const table = panel().querySelector('table')!
    expect(usage.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(table.querySelector('caption')!.textContent).toBe(VI.uwSyncTabOffline)
  })

  it('vi formats the usage with a decimal comma; 2 GiB reads "2 GB"', async () => {
    await openS3(
      library({ quota: { usedBytes: 1.5 * GIB, maxBytes: 2 * GIB, pins: 3, maxPins: 200 } }),
    )
    expect(panel().querySelector('.sc-usage-text')!.textContent).toBe(
      vi_('uwOfflineUsage', { used: '1,5 GB', cap: '2 GB' }),
    )
  })

  it('opens on the S3 tab when the opener asked for it (the Open card offline)', async () => {
    const onOpen = vi.fn()
    window.addEventListener('uniwork:open-settings', onOpen)
    openSyncCenter('offline')
    window.removeEventListener('uniwork:open-settings', onOpen)
    expect(onOpen).toHaveBeenCalledTimes(1)
    await render(fakeApi(snapshot(library())))
    expect(tabNamed(VI.uwSyncTabOffline!).getAttribute('aria-selected')).toBe('true')
  })

  it('a mounted pane switches to S3 on the event and clears requestedTab so the next mount opens on its default tab', async () => {
    await render(fakeApi(snapshot(library())))
    expect(tabNamed(VI.uwSyncTabAttention!).getAttribute('aria-selected')).toBe('true')
    await act(async () => openSyncCenter('offline'))
    expect(tabNamed(VI.uwSyncTabOffline!).getAttribute('aria-selected')).toBe('true')
    act(() => root.unmount())
    root = createRoot(host)
    await render(fakeApi(snapshot(library())))
    expect(tabNamed(VI.uwSyncTabAttention!).getAttribute('aria-selected')).toBe('true')
  })
})

describe('S3 capability off, signed out, empty', () => {
  it('capability off: a read-only list (Mở while the lease holds, Bỏ ghim), no Add, no downloads', async () => {
    await openS3(
      library({
        capabilityOn: false,
        rows: [
          offRow('r', 'ready'),
          offRow('u', 'update-available', { headVersion: 5 }),
          offRow('i', 'interrupted'),
          offRow('v', 'verifying'),
        ],
      }),
    )
    expect(panel().querySelector('.sc-usage button')).toBeNull()
    expect(actionsOf('r')).toEqual([VI.uwActOpen, VI.uwOfflineUnpinShort])
    expect(actionsOf('u')).toEqual([VI.uwActOpen, VI.uwOfflineUnpinShort])
    expect(actionsOf('i')).toEqual([VI.uwOfflineUnpinShort])
    expect(actionsOf('v')).toEqual([])
  })

  it.each([
    { name: 'disk-full', row: offRow('f', 'disk-full') },
    { name: 'corrupt', row: offRow('c', 'corrupt') },
    {
      name: 'permission_revoked',
      row: offRow('p', 'locked', { lockReason: 'permission_revoked' }),
    },
    { name: 'clock_rollback', row: offRow('k', 'locked', { lockReason: 'clock_rollback' }) },
  ])('capability off keeps Bỏ ghim on $name when no other action survives', async ({ row }) => {
    await openS3(library({ capabilityOn: false, rows: [row] }))
    expect(actionsOf(row.documentId)).toEqual([VI.uwOfflineUnpinShort])
  })

  it('signed out: the S3 tab alone, its count is the kept items, and no name is in the DOM', async () => {
    const api = fakeApi(
      snapshot(library({ rows: [], signedOutLockedCount: 3 }), {
        header: { ...snapshot(library()).header, status: 'signed_out', account: undefined },
        signedOut: { lockedCount: 3 },
        tabs: { attention: [], pending: [], recent: [] },
      }),
    )
    await render(api)
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0]!.getAttribute('aria-label')).toBe(
      vi_('uwSyncTabCount', { label: VI.uwSyncTabOffline!, count: 3 }),
    )
    expect(panel().textContent).toBe(vi_('uwSyncSignedOut', { count: 3 }))
    expect(host.querySelector('table')).toBeNull()
    expect(host.textContent).not.toContain('.docx')
  })

  it('empty: uwOfflineEmpty under the usage line', async () => {
    await openS3(library({ rows: [] }))
    expect(panel().querySelector('.sc-empty')!.textContent).toBe(VI.uwOfflineEmpty)
    expect(panel().querySelector('.sc-usage')).not.toBeNull()
  })
})

describe('S3 unpin, cap and Add', () => {
  it('unpins at once when main does not ask for a confirm', async () => {
    const api = await openS3(library())
    await click(rowEl('a').querySelector<HTMLButtonElement>('[data-action="unpin"]')!)
    expect(api.offlineUnpin).toHaveBeenCalledTimes(1)
    expect(api.offlineUnpin).toHaveBeenCalledWith('a', undefined)
    expect(host.querySelector('.sc-confirm')).toBeNull()
  })

  it('needs_confirm opens the in-row confirm (focus on Quay lại), then unpins confirmed', async () => {
    const api = await openS3(library())
    api.offlineUnpin.mockResolvedValueOnce({ ok: false, code: 'needs_confirm' })
    await click(rowEl('a').querySelector<HTMLButtonElement>('[data-action="unpin"]')!)
    const box = rowEl('a').querySelector<HTMLElement>('.sc-confirm')!
    expect(box.querySelector('.sc-confirm-text')!.textContent).toBe(VI.uwOfflineUnpinConfirm)
    expect(document.activeElement?.textContent).toBe(VI.uwActBack)
    const go = Array.from(box.querySelectorAll('button')).find(
      (b) => b.textContent === VI.uwOfflineUnpinShort,
    )!
    expect(go.getAttribute('aria-describedby')).toBe(box.querySelector('.sc-confirm-text')!.id)
    await click(go)
    expect(api.offlineUnpin).toHaveBeenLastCalledWith('a', { confirmed: true })
    expect(host.querySelector('.sc-confirm')).toBeNull()
    expect(document.activeElement).toBe(rowEl('a').querySelector('[data-action="unpin"]'))
  })

  it('Quay lại (or Escape) closes the confirm without unpinning; focus back on Bỏ ghim', async () => {
    const api = await openS3(library())
    api.offlineUnpin.mockResolvedValueOnce({ ok: false, code: 'needs_confirm' })
    await click(rowEl('a').querySelector<HTMLButtonElement>('[data-action="unpin"]')!)
    await key(document.activeElement as HTMLElement, 'Escape')
    await flush()
    expect(host.querySelector('.sc-confirm')).toBeNull()
    expect(api.offlineUnpin).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(rowEl('a').querySelector('[data-action="unpin"]'))
  })

  it('"Thêm tài liệu…" opens the Open dialog in pin mode; a chosen document is pinned', async () => {
    const api = await openS3(library())
    await click(panel().querySelector<HTMLButtonElement>('.sc-usage button')!)
    expect(dialogProps.last).not.toBeNull()
    const onPick = dialogProps.last!.onPick as (d: {
      id: string
      title: string
      workspaceId: string
    }) => Promise<string | null>
    let refused: string | null = 'x'
    await act(async () => {
      refused = await onPick({ id: 'd9', title: 'Mới.docx', workspaceId: 'w2' })
    })
    expect(refused).toBeNull()
    expect(api.offlinePin).toHaveBeenCalledWith({ documentId: 'd9', workspaceId: 'w2' })
    expect(api.offlineOpen).not.toHaveBeenCalled()
  })

  it('cap reached: uwOfflineCapReached with {cap} and {maxDocs}; Add stays enabled', async () => {
    const api = await openS3(library())
    api.offlinePin.mockResolvedValueOnce({
      ok: false,
      code: 'offline_cap_reached',
      cap: 2 * GIB,
      maxDocs: 200,
    })
    const add = panel().querySelector<HTMLButtonElement>('.sc-usage button')!
    await click(add)
    const onPick = dialogProps.last!.onPick as (d: {
      id: string
      title: string
      workspaceId: string
    }) => Promise<string | null>
    let refused: string | null = null
    await act(async () => {
      refused = await onPick({ id: 'd9', title: 'Mới.docx', workspaceId: 'w2' })
    })
    await flush()
    const text = vi_('uwOfflineCapReached', { cap: '2 GB', maxDocs: 200 })
    expect(refused).toBe(text)
    expect(panel().querySelector('.sc-notice')!.textContent).toBe(text)
    expect(add.disabled).toBe(false)
    expect(add.getAttribute('aria-disabled')).toBeNull()
  })
})
