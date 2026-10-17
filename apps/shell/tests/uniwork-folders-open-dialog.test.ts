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
  UniworkFolderQuery,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkOpenDialog } from '../src/renderer/src/UniworkOpenDialog'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkSaveStrings } from '../src/renderer/src/i18n/strings-uniwork-save'

/**
 * FD-11 S1/S2 inside "Open from UniWork": the dialog's body is the browser.
 * Recent and Shared with me stay as views above the tree; a folder shows its
 * contents; the search box searches titles in the folder view and Escape
 * returns to the open folder before it closes the dialog.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkFolderStrings.en
const ok = <T>(value: T) => ({ ok: true as const, value })

function entry(
  id: string,
  title: string,
  extra: Partial<UniworkDocSummary> = {},
): UniworkDocSummary {
  return {
    id,
    workspaceId: 'w1',
    title,
    format: 'docx',
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'file',
    parentId: null,
    ...extra,
  }
}

let host: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn>
let api: ReturnType<typeof makeApi>

function makeApi() {
  const fns = {
    uniworkListWorkspaces: vi.fn(async () =>
      ok([{ id: 'w1', name: 'Sales', orgId: 'o1', myRole: 'admin' }]),
    ),
    uniworkListDocuments: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: [entry('r1', 'Recent.docx')], nextCursor: null }),
    ),
    uniworkListSharedWithMe: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: [entry('s1', 'Shared.docx')], nextCursor: null }),
    ),
    uniworkFolderTree: vi.fn(async () =>
      ok([{ id: 'a', parentId: null, title: 'Alpha', position: 0, children: [] }]),
    ),
    uniworkListChildren: vi.fn(async (q: UniworkFolderQuery) =>
      ok<UniworkFolderChildren>({
        items:
          q.parentId === 'a'
            ? [entry('d2', 'Inside.docx', { parentId: 'a' })]
            : [entry('a', 'Alpha', { kind: 'folder', format: null }), entry('d1', 'Top.docx')],
        nextCursor: null,
      }),
    ),
    uniworkSearchDocuments: vi.fn(async () =>
      ok<UniworkFolderChildren>({
        items: [entry('d2', 'Inside.docx', { path: [{ id: 'a', title: 'Alpha' }] })],
        nextCursor: null,
      }),
    ),
    uniworkOpenDocument: vi.fn(async () => ok({ path: '/cache/Inside.docx' })),
    uniworkCreateDocument: vi.fn(async () => ok(entry('n1', 'New.docx'))),
    onUniworkDocRenamed: vi.fn(() => () => undefined),
    onUniworkUploadProgress: vi.fn(() => () => undefined),
    onUniworkTreeChanged: vi.fn(() => () => undefined),
  }
  window.aiOffice = fns as unknown as HomeApi
  return fns
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))
const button = (text: string) =>
  $$<HTMLButtonElement>('button').find((b) => b.textContent === text)!
const treeItem = (title: string) =>
  $$('[role="treeitem"]').find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)!

async function click(el: Element | null | undefined) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function search(text: string) {
  const input = $<HTMLInputElement>('.uw-pick-search')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // the dialog debounces its search box
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
  await flush()
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  api = makeApi()
  onClose = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkOpenDialog, {
          onClose,
          accountView: 'signed-in',
          onSignIn: () => undefined,
        }),
      ),
    )
  })
  await flush()
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('Open from UniWork as the browser', () => {
  it('starts on Recent, with Recent / Shared with me above the folder tree', async () => {
    expect($('.modal.uw-pick')?.classList.contains('with-browser')).toBe(true)
    expect(button(en.ufRecent).getAttribute('aria-pressed')).toBe('true')
    expect(button(en.ufShared).getAttribute('aria-pressed')).toBe('false')
    expect($('[role="tree"]')).toBeTruthy()
    expect($('.uw-pick-body')?.textContent).toContain('Recent.docx')
    // no tree row reads as the open folder while Recent is shown
    expect(treeItem('UniWork').getAttribute('aria-selected')).toBe('false')
  })

  it('a tree folder shows its contents; Recent comes back from its view button', async () => {
    await click(treeItem('UniWork'))
    expect(button(en.ufRecent).getAttribute('aria-pressed')).toBe('false')
    expect($$('.uwf-contents [role="option"]').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Top.docx'),
    ])
    await click(treeItem('Alpha'))
    expect($('.uwf-crumb-current')?.textContent).toBe('Alpha')
    await click(button(en.ufRecent))
    expect($('.uw-pick-body')?.textContent).toContain('Recent.docx')
  })

  it('Shared with me is a view above the tree', async () => {
    await click(button(en.ufShared))
    expect(api.uniworkListSharedWithMe).toHaveBeenCalled()
    expect(button(en.ufShared).getAttribute('aria-pressed')).toBe('true')
    expect($('.uw-pick-body')?.textContent).toContain('Shared.docx')
  })

  it('in a folder the search box searches titles; Escape returns to the folder first', async () => {
    await click(treeItem('UniWork'))
    expect($<HTMLInputElement>('.uw-pick-search')!.placeholder).toBe(en.ufSearchPh)
    const recentCalls = api.uniworkListDocuments.mock.calls.length
    await search('ins')
    expect(api.uniworkSearchDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'w1', query: 'ins', kind: 'all' }),
    )
    expect(api.uniworkListDocuments.mock.calls.length).toBe(recentCalls)
    expect($('[role="radiogroup"]')).toBeTruthy()
    await act(async () => {
      $('.uw-pick-search')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect($<HTMLInputElement>('.uw-pick-search')!.value).toBe('')
    expect($('[role="radiogroup"]')).toBeNull()
    await act(async () => {
      $('.uw-pick-search')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('New document defaults to the folder open in the browser (S4)', async () => {
    await click(treeItem('Alpha'))
    await click(button('New document'))
    const location = $<HTMLButtonElement>('.modal.uw-act .uwf-location-btn')!
    expect(location.textContent).toContain('UniWork › Alpha')
    // Recent: no folder, which is My Folder since SAVE-01 Q1 (main sends destination my_folder)
    await click(button('Cancel'))
    await click(button(en.ufRecent))
    await click(button('New document'))
    expect($('.modal.uw-act .uwf-location-btn')!.textContent).toContain(
      uniworkSaveStrings.en.usMyFolder,
    )
  })

  it('a file in a folder opens through the existing open path', async () => {
    await click(treeItem('Alpha'))
    const row = $$('.uwf-contents [role="option"]').find((o) =>
      o.textContent?.includes('Inside.docx'),
    )!
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d2')
  })
})
