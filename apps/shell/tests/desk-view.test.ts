/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type { TabsApi } from '../src/shared/tabs-api'
import type { UniworkWorkApi } from '../src/shared/uniwork-work-api'
import { DeskView } from '../src/renderer/src/DeskView'
import { LocaleProvider } from '../src/renderer/src/locale'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    listDrafts: vi.fn(async () => []),
    recents: vi.fn(async () => ({ entries: [], total: 0, totalAll: 0 })),
    uniworkListDocuments: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkListSharedWithMe: vi.fn(async () => ({
      ok: true,
      value: { documents: [], nextCursor: null },
    })),
    uniworkDocStatus: vi.fn(async () => null),
    onUniworkDocStatus: vi.fn(() => () => undefined),
    pathForFile: vi.fn((f: File) => `/drop/${f.name}`),
    accountLogin: vi.fn(async () => true),
  }
  window.aiOffice = api as unknown as HomeApi
  window.uniworkWork = {
    homeSummary: vi.fn(async () => ({ ok: false, error: 'signed-out' })),
  } as unknown as UniworkWorkApi
  window.aiOfficeTabs = {
    onChanged: vi.fn(() => () => undefined),
    activate: vi.fn(),
  } as unknown as TabsApi
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount() {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(DeskView, {
          practiceId: 'legal',
          vi: false,
          workspaces: [],
          workspaceId: null,
          workspaceError: 'signed-out',
          refreshTick: 0,
          packId: null,
          onReload: vi.fn(),
          onOpenTab: vi.fn(),
        }),
      ),
    )
  })
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

describe('DeskView', () => {
  it('lays out tools, tray, work in progress, drawer and Today, even signed out', async () => {
    await mount()
    const text = host.textContent ?? ''
    for (const s of ['PDF → Word', 'Needs you', 'In progress', 'Forms drawer', 'Today']) {
      expect(text).toContain(s)
    }
    expect(api.listDrafts).toHaveBeenCalled()
  })

  it('claims a file drop so the open-on-drop bridge leaves it alone, and offers the tools', async () => {
    await mount()
    const desk = host.querySelector('.wb-desk')!
    const file = new File(['x'], 'a.pdf')
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer: unknown
    }
    drop.dataTransfer = { types: ['Files'], files: [file] }
    await act(async () => {
      desk.dispatchEvent(drop)
    })
    expect(drop.defaultPrevented).toBe(true)
    expect(host.querySelector('.wb-desk-panel')?.textContent).toContain('PDF → Word')
  })
})
