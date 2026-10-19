/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkDocListPage,
} from '../src/shared/home-api'
import type { OfflineLibrarySnapshot } from '../src/shared/offline-library'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkOpenDialog } from '../src/renderer/src/UniworkOpenDialog'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'

/**
 * UNI-1953 CT1-2 / CT1-3: a UniNote page row in the Open dialog's folder
 * browser carries the UniNote mark (not a file-type tile), offers no "keep
 * offline" (a page cannot be downloaded) and is not listed at all when the
 * dialog is a picker (`onPick`: a page cannot be picked). A page row still
 * opens on the web through openWeb.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const EN = syncStrings.en as Record<string, string>
const ok = <T>(value: T) => ({ ok: true as const, value })

const entry = (id: string, title: string, extra: Partial<UniworkDocSummary> = {}) =>
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
let openWeb: ReturnType<typeof vi.fn>

function setup(offline: Partial<OfflineLibrarySnapshot> = {}) {
  api = {
    uniworkListWorkspaces: vi.fn(async () =>
      ok([
        { id: 'w1', name: 'Sales', orgId: 'o1', myRole: 'admin', slug: 'sales', orgSlug: 'acme' },
      ]),
    ),
    uniworkListDocuments: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: [entry('r1', 'Recent.docx')], nextCursor: null }),
    ),
    uniworkListSharedWithMe: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: [], nextCursor: null }),
    ),
    uniworkFolderTree: vi.fn(async () => ok([])),
    // a page whose title ends in a known extension: the parsed format is `docx`
    uniworkListChildren: vi.fn(async () =>
      ok<UniworkFolderChildren>({
        items: [entry('d1', 'Top.docx'), entry('p1', 'Plan.docx', { kind: 'page', canEdit: true })],
        nextCursor: null,
      }),
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
  openWeb = vi.fn(async () => true)
  ;(window as unknown as { uniworkWork: unknown }).uniworkWork = { openWeb }
  ;(window as unknown as { uniworkSyncCenter: unknown }).uniworkSyncCenter = {
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
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))

async function mountInFolder(props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkOpenDialog, {
          onClose: vi.fn(),
          accountView: 'signed-in',
          onSignIn: () => undefined,
          ...props,
        }),
      ),
    )
  })
  await flush()
  await act(async () => $$<HTMLElement>('[role="treeitem"]')[0]!.click())
  await flush()
}

const rowOf = (id: string) =>
  $$<HTMLElement>('.uwf-contents [role="option"]').find((o) => o.dataset.id === id)

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

describe('UniNote page rows in the Open dialog folder browser (UNI-1953)', () => {
  it('CT1-2: a page row carries the UniNote mark, a file row does not', async () => {
    setup()
    await mountInFolder()
    expect(rowOf('p1')!.querySelector('rect[style*="tint-blue"]')).not.toBeNull()
    expect(rowOf('d1')!.querySelector('rect[style*="tint-blue"]')).toBeNull()
    // not the docx tile its title extension would pick
    expect(rowOf('p1')!.querySelector('img')).toBeNull()
  })

  it('CT1-2: a page row offers no "keep offline", a file row still does', async () => {
    setup()
    await mountInFolder()
    const menuItems = async (id: string) => {
      const button = $$<HTMLButtonElement>(`[data-folder-menu-for="${id}"]`)[0]!
      await act(async () => button.click())
      await flush()
      const labels = $$<HTMLButtonElement>('.uw-row-menu-list [role="menuitem"]').map(
        (b) => b.textContent,
      )
      await act(async () => button.click())
      await flush()
      return labels
    }
    expect(await menuItems('p1')).toEqual(['Move to…'])
    expect(await menuItems('d1')).toEqual(['Move to…', EN.uwOfflinePin])
  })

  it('CT1-3: the picker (onPick) lists no page row; the file row stays', async () => {
    setup()
    await mountInFolder({ onPick: vi.fn(async () => null) })
    expect(rowOf('d1')).toBeDefined()
    expect(rowOf('p1')).toBeUndefined()
    // a page is not a "hidden format": no count line for it
    expect(document.querySelector('#uwf-hidden')).toBeNull()
  })

  it('CT1-3: outside the picker the page row is listed and opens on the web, never the file flow', async () => {
    setup()
    await mountInFolder()
    expect(rowOf('p1')).toBeDefined()
    await act(async () => {
      rowOf('p1')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(openWeb).toHaveBeenCalledWith({
      kind: 'document',
      orgSlug: 'acme',
      wsSlug: 'sales',
      id: 'p1',
    })
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
  })
})
