/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  UniworkDocListPage,
  UniworkDocSummary,
  UniworkFolderChildren,
} from '../src/shared/home-api'
import type { OfflineLibrarySnapshot, OfflineRowView } from '../src/shared/offline-library'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkOpenDialog } from '../src/renderer/src/UniworkOpenDialog'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { hasRowActions, rowActionsOf } from '../src/renderer/src/uniwork-docs-model'

/**
 * G5-05u (UNI-1360) Q2 and F5: "Thêm tài liệu…" opens "Open from UniWork" in a
 * pin mode - choosing a document hands it to `onPick` (offlinePin) instead of
 * opening it, and the dialog stays; the dialog's row menu gets
 * "Dùng khi không có mạng" / "Bỏ dùng khi không có mạng".
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const EN = syncStrings.en as Record<string, string>
const ok = <T>(value: T) => ({ ok: true as const, value })

const doc = (id: string, title: string, extra: Partial<UniworkDocSummary> = {}) =>
  ({
    id,
    workspaceId: 'w1',
    title,
    format: 'docx',
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'file',
    parentId: null,
    ...extra,
  }) as UniworkDocSummary

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>
let sync: {
  getSnapshot: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  offlinePin: ReturnType<typeof vi.fn>
  offlineUnpin: ReturnType<typeof vi.fn>
}

const pinned = (documentId: string): OfflineRowView => ({
  documentId,
  workspaceId: 'w1',
  name: 'x.docx',
  state: 'ready',
  progress: null,
  version: 1,
  headVersion: null,
  sizeBytes: 1,
  leaseUntil: null,
  leaseLevel: 'edit',
  updateKeptReason: null,
  open: false,
})

function setup(offline: Partial<OfflineLibrarySnapshot> = {}) {
  api = {
    uniworkListWorkspaces: vi.fn(async () =>
      ok([{ id: 'w1', name: 'Sales', orgId: 'o1', myRole: 'admin' }]),
    ),
    uniworkListDocuments: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: [doc('r1', 'Recent.docx')], nextCursor: null }),
    ),
    uniworkListSharedWithMe: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: [], nextCursor: null }),
    ),
    uniworkFolderTree: vi.fn(async () => ok([])),
    uniworkListChildren: vi.fn(async () =>
      ok<UniworkFolderChildren>({ items: [doc('d1', 'Top.docx')], nextCursor: null }),
    ),
    uniworkSearchDocuments: vi.fn(async () =>
      ok<UniworkFolderChildren>({ items: [], nextCursor: null }),
    ),
    uniworkOpenDocument: vi.fn(async () => ok({ path: '/cache/Top.docx' })),
    onUniworkDocRenamed: vi.fn(() => () => undefined),
    onUniworkUploadProgress: vi.fn(() => () => undefined),
    onUniworkTreeChanged: vi.fn(() => () => undefined),
  }
  window.aiOffice = api as unknown as HomeApi as Window['aiOffice']
  sync = {
    getSnapshot: vi.fn(async () => ({
      offline: {
        visible: true,
        capabilityOn: true,
        quota: { usedBytes: 0, maxBytes: 1, pins: 0, maxPins: 200 },
        rows: [],
        ...offline,
      },
    })),
    subscribe: vi.fn(() => () => undefined),
    offlinePin: vi.fn(async () => ({ ok: true })),
    offlineUnpin: vi.fn(async () => ({ ok: true, deferred: false })),
  }
  ;(window as unknown as { uniworkSyncCenter: unknown }).uniworkSyncCenter = sync
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function mount(props: Record<string, unknown> = {}) {
  const onClose = vi.fn()
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkOpenDialog, {
          onClose,
          accountView: 'signed-in',
          onSignIn: () => undefined,
          ...props,
        }),
      ),
    )
  })
  await flush()
  return onClose
}

const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))

async function choose(title: string) {
  const option = $$('.uw-pick-row[role="option"]').find((o) => o.textContent?.includes(title))!
  await act(async () => option.click())
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
  delete (window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter
})

describe('Open dialog pin mode (Q2)', () => {
  it('choosing a document pins it through onPick, never opens it, and the dialog stays', async () => {
    setup()
    const onPick = vi.fn(async () => null)
    const onClose = await mount({ onPick })
    await choose('Recent.docx')
    expect(onPick).toHaveBeenCalledWith({ id: 'r1', title: 'Recent.docx', workspaceId: 'w1' })
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('.modal.uw-pick')).not.toBeNull()
  })

  it('a refusal returned by onPick (cap reached) is the dialog toast', async () => {
    setup()
    const text = 'The offline library on this computer is at its limit'
    const onPick = vi.fn(async () => text)
    await mount({ onPick })
    await choose('Recent.docx')
    expect(document.querySelector('.uw-act-toast')!.textContent).toContain(text)
  })

  it('without onPick the same choice opens the document (unchanged)', async () => {
    setup()
    await mount()
    await choose('Recent.docx')
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('r1')
  })
})

describe('Open dialog RowMenu offline item', () => {
  it('rowActionsOf carries the offline item; an archived row is not pinned anew', () => {
    expect(rowActionsOf(doc('a', 'A.docx'), 'pin').offline).toBe('pin')
    expect(rowActionsOf(doc('a', 'A.docx', { archived: true }), 'pin').offline).toBeNull()
    expect(rowActionsOf(doc('a', 'A.docx', { archived: true }), 'unpin').offline).toBe('unpin')
    expect(hasRowActions(doc('a', 'A.docx'))).toBe(false)
    expect(hasRowActions(doc('a', 'A.docx'), 'pin')).toBe(true)
  })

  async function openRowMenu() {
    await mount()
    const button = $$<HTMLButtonElement>('[data-menu-for="r1"]')[0]!
    await act(async () => button.click())
    await flush()
    return $$<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]')
  }

  it('a row of the Recent list offers "Make available offline" and pins it', async () => {
    setup()
    const items = await openRowMenu()
    expect(items.map((b) => b.textContent)).toEqual([EN.uwOfflinePin])
    await act(async () => items[0]!.click())
    await flush()
    expect(sync.offlinePin).toHaveBeenCalledWith({ documentId: 'r1', workspaceId: 'w1' })
  })

  it('a pinned row offers "Remove offline copy"', async () => {
    setup({ rows: [pinned('r1')] })
    const items = await openRowMenu()
    expect(items.map((b) => b.textContent)).toEqual([EN.uwOfflineUnpin])
    await act(async () => items[0]!.click())
    await flush()
    expect(sync.offlineUnpin).toHaveBeenCalledWith('r1', undefined)
  })

  it('capability off: no pin, and a row with no other action has no "…" at all', async () => {
    setup({ capabilityOn: false })
    await mount()
    expect($$('[data-menu-for="r1"]')).toHaveLength(0)
  })
})
