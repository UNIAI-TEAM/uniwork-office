/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  UniworkDocListPage,
  UniworkDocSummary,
  UniworkResult,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { Lang, StringKey, TFunc } from '../src/renderer/src/locale'
import { UniworkOpenDialog } from '../src/renderer/src/UniworkOpenDialog'
import {
  MISSING_VALUE,
  docInfoRows,
  initialPickerState,
  pickerBodyOf,
  pickerReducer,
  roleLabel,
  visibleDocs,
  workspaceLabel,
  type DocInfoFields,
  type PickerState,
} from '../src/renderer/src/uniwork-docs-model'
import type { SharedListQuery } from '../src/renderer/src/uniwork-library-api'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'

/**
 * S17: "Shared with me" in the Open from UniWork dialog, the workspace list
 * with my role, and the document details panel. The bridge is a typed fake of
 * the library IPC (uniworkListSharedWithMe, uniworkDocumentProperties); no main runs.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = { ...accountStrings.en, ...uniworkDocumentStrings.en } as Record<string, string>
const t: TFunc = (key: StringKey, params) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

const WORKSPACES = [
  { id: 'w1', name: 'Sales', orgId: 'o1', myRole: 'admin' },
  { id: 'w2', name: 'Ops', orgId: 'o1', myRole: 'member' },
]

function doc(id: string, title: string, extra: Partial<UniworkDocSummary> = {}) {
  return {
    id,
    workspaceId: 'w1',
    title,
    format: 'docx' as const,
    updatedAt: '2026-05-01T10:00:00Z',
    ...extra,
  }
}

const FULL_INFO: DocInfoFields = {
  ownerName: 'Lan Nguyen',
  createdByName: 'Minh Tran',
  createdAt: '2026-04-02T08:15:00Z',
  updatedByName: 'Lan Nguyen',
  updatedAt: '2026-05-01T10:00:00Z',
  myLevel: 'edit',
  version: 4,
  versionByName: 'Lan Nguyen',
}

const EMPTY_INFO: DocInfoFields = {
  ownerName: null,
  createdByName: null,
  createdAt: null,
  updatedByName: null,
  updatedAt: null,
  myLevel: null,
  version: null,
  versionByName: null,
}

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>

function makeApi(opts: { shared?: UniworkDocListPage; info?: DocInfoFields } = {}) {
  const fns = {
    uniworkListWorkspaces: vi.fn(async () => ok(WORKSPACES)),
    uniworkListDocuments: vi.fn(async () =>
      ok<UniworkDocListPage>({
        documents: [doc('d1', 'Plan.docx'), doc('d2', 'Budget.xlsx', { format: 'xlsx' })],
        nextCursor: null,
      }),
    ),
    uniworkListSharedWithMe: vi.fn(async (_q?: SharedListQuery) =>
      ok<UniworkDocListPage>(opts.shared ?? { documents: [], nextCursor: null }),
    ),
    uniworkDocumentProperties: vi.fn(async (_id: string) => ok(opts.info ?? FULL_INFO)),
    uniworkOpenDocument: vi.fn(async () => ok({ path: 'C:\\x\\Plan.docx' })),
  }
  window.aiOffice = fns as unknown as HomeApi
  return fns
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function render(opts: Parameters<typeof makeApi>[0] = {}, lang: Lang = 'en') {
  api = makeApi(opts)
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(UniworkOpenDialog, {
          onClose: () => undefined,
          accountView: 'signed-in',
          onSignIn: () => undefined,
        }),
      ),
    )
  })
  await flush()
}

const select = () => host.querySelector<HTMLSelectElement>('.uw-pick-ws')!
const rows = () => Array.from(host.querySelectorAll<HTMLElement>('.uw-pick-row'))
const infoPanel = () => host.querySelector<HTMLElement>('.uw-info')
const infoButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.uw-pick-info-btn'))
const search = () => host.querySelector<HTMLInputElement>('.uw-pick-search')!

/** type into the search box and press Enter, which searches without waiting for the debounce */
async function searchFor(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(search(), value)
    search().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()
}

async function choose(value: string) {
  await act(async () => {
    const el = select()
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

async function click(el: Element) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('library model', () => {
  it('labels a workspace with my role, and falls back to the name', () => {
    expect(workspaceLabel(WORKSPACES[0]!, t)).toBe('Sales · Admin')
    expect(workspaceLabel({ id: 'w', name: 'Plain', orgId: 'o' }, t)).toBe('Plain')
    // contract: myRole null = the role read failed; a dash after the middot reads as unfinished
    expect(workspaceLabel({ id: 'w', name: 'Ops', orgId: 'o', myRole: null } as never, t)).toBe(
      'Ops',
    )
    expect(workspaceLabel({ id: 'w', name: 'Ops', orgId: 'o', myRole: '' } as never, t)).toBe('Ops')
    expect(roleLabel('owner', t)).toBe('Owner')
    expect(roleLabel('auditor', t)).toBe('auditor')
  })

  it('shows the shared-empty state, and filters the shared list by title in place', () => {
    let s: PickerState = pickerReducer(initialPickerState(), {
      type: 'workspaces-loaded',
      result: ok(WORKSPACES),
    })
    s = pickerReducer(s, { type: 'select-shared' })
    expect(s.source).toBe('shared')
    const id = s.list.requestId
    s = pickerReducer(s, {
      type: 'list-loaded',
      requestId: id,
      append: false,
      result: ok({ documents: [], nextCursor: null }),
    })
    expect(pickerBodyOf(s)).toEqual({ kind: 'shared-empty' })
    s = pickerReducer(s, {
      type: 'list-loaded',
      requestId: id,
      append: false,
      result: ok({ documents: [doc('a', 'Alpha'), doc('b', 'Beta')], nextCursor: null }),
    })
    s = pickerReducer(s, { type: 'set-query', query: 'bet' })
    // no refetch: the server has no search on this list
    expect(s.list.requestId).toBe(id)
    expect(visibleDocs(s).map((d) => d.id)).toEqual(['b'])
    expect(s.activeId).toBe('b')
    s = pickerReducer(s, { type: 'set-query', query: 'zzz' })
    expect(pickerBodyOf(s)).toEqual({ kind: 'no-results', query: 'zzz' })
    // back to a workspace: a fresh server list
    s = pickerReducer(s, { type: 'select-workspace', id: 'w1' })
    expect(s.source).toBe('workspace')
    expect(s.list.requestId).toBe(id + 1)
  })

  it('details rows: every field, and "—" for each field the server left out', () => {
    const full = docInfoRows(FULL_INFO, t, 'en-US')
    expect(full.map((r) => r.labelKey)).toEqual([
      'uwDocInfoOwner',
      'uwDocInfoCreated',
      'uwDocInfoUpdated',
      'uwDocInfoMyAccess',
      'uwDocInfoVersion',
    ])
    expect(full[0]!.value).toBe('Lan Nguyen')
    expect(full[1]!.value).toMatch(/^Minh Tran, .*2026/)
    expect(full[3]!.value).toBe('Edit')
    expect(full[4]!.value).toBe('4 · Lan Nguyen')
    expect(docInfoRows(EMPTY_INFO, t, 'en-US').map((r) => r.value)).toEqual(
      Array(5).fill(MISSING_VALUE),
    )
    const partial = docInfoRows(
      { ...EMPTY_INFO, createdAt: '2026-04-02T08:15:00Z', version: 2, myLevel: 'owner?' },
      t,
      'en-US',
    )
    expect(partial[1]!.value).toMatch(/2026/)
    expect(partial[1]!.value).not.toContain(',  ')
    expect(partial[3]!.value).toBe(MISSING_VALUE)
    expect(partial[4]!.value).toBe('2')
  })
})

describe('Open from UniWork: workspaces and Shared with me', () => {
  it('lists each workspace with my role and offers Shared with me beside them', async () => {
    await render()
    const options = Array.from(select().querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual(['Sales · Admin', 'Ops · Member', en.uwLibShared])
  })

  it('Shared with me lists the documents shared directly, with their workspace', async () => {
    await render({
      shared: {
        documents: [
          { ...doc('s1', 'Contract.docx', { workspaceId: 'w9' }), workspaceName: 'Legal' },
        ] as unknown as UniworkDocSummary[],
        nextCursor: null,
      },
    })
    await choose(Array.from(select().options).at(-1)!.value)
    expect(api.uniworkListSharedWithMe).toHaveBeenCalledTimes(1)
    expect(api.uniworkListSharedWithMe.mock.calls[0]![0]).toEqual({ cursor: undefined, limit: 50 })
    expect(host.querySelector('.uw-pick-heading')?.textContent).toBe(en.uwLibShared)
    expect(rows().map((r) => r.querySelector('.uw-pick-row-title')?.textContent)).toEqual([
      'Contract.docx',
    ])
    // UNI-2047 B2: the workspace is the second line; the editor and the date are columns now
    expect(rows()[0]!.querySelector('.uw-pick-row-meta')?.textContent).toBe('Legal')
    expect(rows()[0]!.querySelector('[data-col="updated"]')).not.toBeNull()
  })

  it('an empty shared list says nothing was shared yet', async () => {
    await render()
    await choose(Array.from(select().options).at(-1)!.value)
    expect(host.querySelector('.uw-pick-body')?.textContent).toBe(en.uwLibSharedEmpty)
  })
})

describe('Open from UniWork: details panel', () => {
  it('offers Details on every row at rest, not only on the hovered or active row', async () => {
    await render()
    const buttons = infoButtons()
    expect(buttons.length).toBeGreaterThan(1)
    for (const btn of buttons) {
      expect(btn).not.toBeNull()
      expect(btn!.getAttribute('aria-label')).toMatch(/^Details for /)
    }
    // the stylesheet: shown at rest (never opacity 0), full size and strength on a coarse pointer
    const css = readFileSync(resolve(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const block = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`)
      expect(start).toBeGreaterThan(-1)
      return css.slice(start, css.indexOf('}', start))
    }
    const rest = block('.uw-pick-info-btn')
    // full strength in the muted text token (>= 3:1 non-text contrast), never faded
    expect(rest).not.toMatch(/opacity/)
    expect(rest).toMatch(/color:\s*var\(--text-muted\);/)
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {\n  .uw-pick-row'))
    expect(coarse.slice(0, coarse.indexOf('\n}'))).toMatch(/\.uw-pick-info-btn \{\s*width: 44px;/)
  })

  it('opens a non-modal panel named by the document with a dl of its properties', async () => {
    await render()
    const btn = infoButtons()[0]!
    expect(btn.getAttribute('aria-label')).toBe('Details for “Plan.docx”')
    await click(btn)
    expect(api.uniworkDocumentProperties).toHaveBeenCalledWith('d1')
    // the row did not open the document
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    const panel = infoPanel()!
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('false')
    const title = document.getElementById(panel.getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe('Plan.docx')
    expect(document.activeElement).toBe(title)
    const terms = Array.from(panel.querySelectorAll('dl dt')).map((d) => d.textContent)
    expect(terms).toEqual(['Owner', 'Created', 'Updated', 'My access', 'Version'])
    const values = Array.from(panel.querySelectorAll('dl dd')).map((d) => d.textContent)
    expect(values[0]).toBe('Lan Nguyen')
    expect(values[3]).toBe('Edit')
    expect(values[4]).toBe('4 · Lan Nguyen')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('UNI-1958 rows 2-3: My access names the web levels (vi: Nhận xét / Chỉ xem; en: Comment / View)', async () => {
    const levelOf = async (myLevel: 'comment' | 'view', lang: Lang) => {
      await render({ info: { ...FULL_INFO, myLevel } }, lang)
      await click(infoButtons()[0]!)
      const values = Array.from(infoPanel()!.querySelectorAll('dl dd')).map((d) => d.textContent)
      act(() => root.unmount())
      root = createRoot(host)
      return values[3]
    }
    expect(await levelOf('comment', 'vi')).toBe('Nhận xét')
    expect(await levelOf('view', 'vi')).toBe('Chỉ xem')
    expect(await levelOf('comment', 'en')).toBe('Comment')
    expect(await levelOf('view', 'en')).toBe('View')
  })

  it('shows "—" for every field the server did not send', async () => {
    await render({ info: EMPTY_INFO })
    await click(infoButtons()[1]!)
    const values = Array.from(infoPanel()!.querySelectorAll('dl dd')).map((d) => d.textContent)
    expect(values).toEqual(Array(5).fill('—'))
  })

  it('Escape closes the panel first and gives focus back to its Details button', async () => {
    await render()
    const btn = infoButtons()[0]!
    await click(btn)
    await act(async () => {
      infoPanel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(infoPanel()).toBeNull()
    expect(host.querySelector('.uw-pick')).not.toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('a failed details read says why and retries', async () => {
    await render()
    api.uniworkDocumentProperties.mockResolvedValueOnce({ ok: false, error: 'network' } as never)
    await click(infoButtons()[0]!)
    expect(infoPanel()!.querySelector('[role="alert"]')?.textContent).toContain(en.uwErrNetwork)
    await click(
      Array.from(infoPanel()!.querySelectorAll('button')).find(
        (b) => b.textContent === en.acctRetry,
      )!,
    )
    expect(infoPanel()!.querySelectorAll('dl dd')).toHaveLength(5)
  })
})

describe('Open from UniWork: review fixes', () => {
  it('keeps the Details button out of the option, still named and reachable', async () => {
    await render()
    const list = host.querySelector('[role="listbox"]')!
    const options = Array.from(list.querySelectorAll('[role="option"]'))
    expect(options).toHaveLength(2)
    for (const option of options) {
      expect(option.querySelector('button')).toBeNull()
      expect(option.parentElement?.getAttribute('role')).toBe('presentation')
    }
    const buttons = infoButtons()
    expect(buttons).toHaveLength(2)
    for (const btn of buttons) {
      expect(btn.closest('[role="option"]')).toBeNull()
      expect(btn.parentElement).toBe(options[buttons.indexOf(btn)]!.parentElement)
      expect(btn.getAttribute('aria-label')).toMatch(/^Details for /)
    }
    // roving tab stop: the live row's button is in the tab order
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1])
    // the panel's own close control has its own name
    await click(buttons[0]!)
    const close = infoPanel()!.querySelector('.uw-pick-close')!
    expect(close.getAttribute('aria-label')).toBe(en.uwDocInfoClose)
    expect(en.uwDocInfoClose).not.toBe(en.uwPickClose)
  })

  it('a details read that returns after the source changed does not re-open the panel', async () => {
    await render()
    let release!: (r: UniworkResult<DocInfoFields>) => void
    api.uniworkDocumentProperties.mockImplementationOnce(
      () => new Promise<UniworkResult<DocInfoFields>>((resolve) => (release = resolve)) as never,
    )
    await click(infoButtons()[0]!)
    expect(infoPanel()).not.toBeNull()
    await choose(Array.from(select().options).at(-1)!.value)
    expect(infoPanel()).toBeNull()
    await act(async () => {
      release(ok(FULL_INFO))
    })
    await flush()
    expect(infoPanel()).toBeNull()
  })

  it('a search with no loaded match on a multi-page shared list can load the next page', async () => {
    await render()
    const page1: UniworkDocListPage = {
      documents: [doc('s1', 'Alpha.docx')],
      nextCursor: 'c2',
    }
    const page2: UniworkDocListPage = {
      documents: [doc('s2', 'Zebra plan.docx')],
      nextCursor: null,
    }
    api.uniworkListSharedWithMe.mockResolvedValueOnce(ok(page1)).mockResolvedValueOnce(ok(page2))
    await choose(Array.from(select().options).at(-1)!.value)
    await searchFor('zebra')
    // nothing loaded matches, but more pages exist: say so and keep Load more reachable
    const body = host.querySelector('.uw-pick-body')!
    expect(body.textContent).toContain(en.uwLibSharedPartial)
    const more = Array.from(body.querySelectorAll('button')).find(
      (b) => b.textContent === en.uwPickLoadMore,
    )!
    expect(more).toBeDefined()
    await click(more)
    expect(api.uniworkListSharedWithMe.mock.calls[1]![0]).toEqual({ cursor: 'c2', limit: 50 })
    expect(rows().map((r) => r.querySelector('.uw-pick-row-title')?.textContent)).toEqual([
      'Zebra plan.docx',
    ])
  })

  it('without more pages the shared no-results state carries no partial hint', async () => {
    await render({ shared: { documents: [doc('s1', 'Alpha.docx')], nextCursor: null } })
    await choose(Array.from(select().options).at(-1)!.value)
    await searchFor('zebra')
    const body = host.querySelector('.uw-pick-body')!
    expect(body.textContent).toContain('zebra')
    expect(body.textContent).not.toContain(en.uwLibSharedPartial)
    expect(body.querySelector('.uw-pick-more')).toBeNull()
  })
})
