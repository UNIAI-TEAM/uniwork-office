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

async function mount(over: Partial<Parameters<typeof DeskView>[0]> = {}) {
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
          ...over,
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
    const headings = Array.from(host.querySelectorAll('h3')).map((h) => h.textContent)
    for (const s of ['Tools', 'Needs you', 'In progress', 'Frequent forms', 'Today']) {
      expect(headings).toContain(s)
    }
    expect(host.querySelector('button[aria-label="PDF → Word"]')).not.toBeNull()
    expect(api.listDrafts).toHaveBeenCalled()
  })

  it('shows one sign-in banner when signed out; the tray and Today do not repeat it', async () => {
    await mount()
    const banners = host.querySelectorAll('.wb-banner')
    expect(banners).toHaveLength(1)
    expect(banners[0]!.className).toContain('is-info')
    const signIn = Array.from(host.querySelectorAll('button')).filter((b) =>
      /sign in/i.test(b.textContent ?? ''),
    )
    expect(signIn).toHaveLength(1)
    expect(banners[0]!.contains(signIn[0]!)).toBe(true)
    // the banner sits above the Desk grid, so both columns still start at the same line
    expect(host.querySelector('.wb-desk')!.contains(banners[0]!)).toBe(false)
    await act(async () => signIn[0]!.click())
    expect(api.accountLogin).toHaveBeenCalled()
  })

  it('shows one offline banner with Retry when UniWork cannot be reached', async () => {
    const onReload = vi.fn()
    await mount({ workspaceError: 'offline', onReload })
    const banners = host.querySelectorAll('.wb-banner')
    expect(banners).toHaveLength(1)
    expect(banners[0]!.className).toContain('is-warning')
    expect(host.querySelectorAll('.wb-ov-partial')).toHaveLength(0)
    await act(async () => banners[0]!.querySelector('button')!.click())
    expect(onReload).toHaveBeenCalled()
  })

  it('shows the In progress skeleton, not the empty line, until drafts load', async () => {
    api.listDrafts = vi.fn(() => new Promise<unknown[]>(() => undefined))
    await mount()
    const card = Array.from(host.querySelectorAll('section')).find(
      (s) => s.querySelector('h3')?.textContent === 'In progress',
    )!
    expect(card.querySelector('.wb-work-skeleton')).not.toBeNull()
    expect(card.textContent).not.toContain('No documents in progress')
  })

  it('greets by the short name and sums up what waits, from data already loaded', async () => {
    api.listDrafts = vi.fn(async () => [
      { kind: 'unsaved', title: 'A.docx', app: 'docs', tabId: 'a' },
      { kind: 'recovery', title: 'B.xlsx', app: 'sheets', filePath: '/b.xlsx' },
    ])
    await mount({ userName: 'Phan Đức Quang' })
    const text = host.querySelector('.wb-toolbar-text')!.textContent
    expect(text).toMatch(/^Good (morning|afternoon|evening), Quang\. Unsaved documents: 1$/)
  })

  it('drops the greeting when no name is known', async () => {
    await mount()
    expect(host.querySelector('.wb-toolbar-text')).toBeNull()
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

  it("keeps a file drag's enter inside the Desk, so Home's Drop to open overlay stays hidden", async () => {
    await mount()
    const onWindowEnter = vi.fn()
    window.addEventListener('dragenter', onWindowEnter)
    const fileDrag = (target: Element) => {
      const e = new Event('dragenter', { bubbles: true }) as Event & { dataTransfer: unknown }
      e.dataTransfer = { types: ['Files'], files: [] }
      act(() => {
        target.dispatchEvent(e)
      })
    }
    fileDrag(host.querySelector('.wb-desk-main')!)
    expect(onWindowEnter).not.toHaveBeenCalled()
    expect(host.querySelector('.wb-desk.is-dragging')).not.toBeNull()
    // leaving the window mid-drag eats the dragleave: blur drops the highlight
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(host.querySelector('.wb-desk.is-dragging')).toBeNull()
    fileDrag(document.body)
    expect(onWindowEnter).toHaveBeenCalledTimes(1)
    window.removeEventListener('dragenter', onWindowEnter)
  })

  it('shows the newest drafts even when an older listDrafts answer lands last', async () => {
    const answers: Array<(d: unknown[]) => void> = []
    api.listDrafts = vi.fn(() => new Promise<unknown[]>((r) => answers.push(r)))
    await mount()
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    const draft = (title: string) => ({ kind: 'unsaved', title, app: 'docs', tabId: title })
    await act(async () => {
      answers[1]!([draft('Newer.docx')])
    })
    await act(async () => {
      answers[0]!([draft('Older.docx')])
    })
    const text = host.textContent ?? ''
    expect(text).toContain('Newer.docx')
    expect(text).not.toContain('Older.docx')
  })
})
