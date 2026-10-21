/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocList } from '../src/renderer/src/doclist/DocList'
import { bulkActionsFor } from '../src/renderer/src/doclist/bulk'
import { BulkBar } from '../src/renderer/src/doclist/BulkBar'
import {
  buildRowMenu,
  type RowMenuActionId,
  type RowMenuItem,
} from '../src/renderer/src/doclist/row-menu'
import type {
  DocumentsHomeDoc,
  DocumentsHomeTableRow,
} from '../src/renderer/src/uniwork-home/documents-home-model'

/**
 * UNI-2047 SD-C: the Share entry points of the Documents list: the Access cell as one
 * button, the row menu's "Chia sẻ" and the bulk bar's "Chia sẻ". Every entry follows the
 * gate (doclist/share-gate.ts); the bulk one also needs every row manageable.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const doc = (partial: Partial<DocumentsHomeDoc> & { id: string }): DocumentsHomeDoc => ({
  workspaceId: 'ws-1',
  title: `${partial.id}.docx`,
  format: 'docx',
  updatedAt: '2026-10-21T02:00:00.000Z',
  kind: 'file',
  parentId: null,
  visibility: 'workspace',
  myLevel: 'manage',
  canEdit: true,
  canManage: true,
  ...partial,
})
const rowOf = (d: DocumentsHomeDoc): DocumentsHomeTableRow => ({ type: 'doc', id: d.id, doc: d })
const ids = (items: RowMenuItem[]) => items.map((i) => i.id)

describe('row menu: Chia sẻ', () => {
  const menu = (d: DocumentsHomeDoc, run: Partial<Record<RowMenuActionId, () => void>>) =>
    buildRowMenu({
      screen: 'workspace',
      doc: d,
      run: { open: () => {}, 'copy-link': () => {}, ...run },
      offlineLabel: null,
      label: (key) => key,
    })

  it('offers share right after Open, before Copy link, when the host can run it', () => {
    const onShare = vi.fn()
    const items = menu(doc({ id: 'a' }), { share: onShare })
    expect(ids(items).indexOf('share')).toBe(1)
    expect(ids(items).indexOf('share')).toBeLessThan(ids(items).indexOf('copy-link'))
    const share = items.find((i) => i.id === 'share')!
    expect(share.label).toBe('dlActShare')
    share.onSelect()
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  it('a viewer still gets it (the dialog shows their own level)', () => {
    const items = menu(doc({ id: 'v', myLevel: 'view', canManage: false, canEdit: false }), {
      share: () => {},
    })
    expect(ids(items)).toContain('share')
  })

  it('no entry for a folder, another module document, a trashed or My Folder row', () => {
    const share = () => {}
    expect(ids(menu(doc({ id: 'f', kind: 'folder' }), { share }))).not.toContain('share')
    expect(ids(menu(doc({ id: 'o', ownerKind: 'work_product' }), { share }))).not.toContain('share')
    expect(ids(menu(doc({ id: 't', archived: true }), { share }))).not.toContain('share')
    expect(ids(menu(doc({ id: 'm', systemKind: 'my_folder' }), { share }))).not.toContain('share')
  })

  it('no entry when the host gives no share handler (never a dead item)', () => {
    expect(ids(menu(doc({ id: 'a' }), {}))).not.toContain('share')
  })

  it('the shelved screen keeps its own menu (open, unshelve, trash)', () => {
    const items = buildRowMenu({
      screen: 'shelved',
      doc: doc({ id: 's', shelvedAt: '2026-10-19T08:00:00Z' }),
      run: { open: () => {}, unshelve: () => {}, trash: () => {}, share: () => {} },
      offlineLabel: null,
      label: (key) => key,
    })
    expect(ids(items)).not.toContain('share')
  })
})

describe('bulk bar: Chia sẻ', () => {
  const manage = (id: string, extra: Partial<DocumentsHomeDoc> = {}) => doc({ id, ...extra })

  it('is offered first when every selected row passes the gate and is manageable', () => {
    expect(bulkActionsFor('workspace', [manage('a'), manage('b')], true)).toEqual([
      'share',
      'shelve',
      'trash',
    ])
  })

  it('an administering workspace admin (no level, adminScope) counts as manageable', () => {
    const admin = manage('adm', { myLevel: undefined, adminScope: true })
    expect(bulkActionsFor('workspace', [manage('a'), admin], true)).toContain('share')
  })

  it('is hidden when one row is a viewer, a folder, another module, or shelved', () => {
    const viewer = manage('v', { myLevel: 'edit', canManage: false })
    const folder = manage('f', { kind: 'folder' })
    const owned = manage('o', { ownerKind: 'work_product' })
    const shelved = manage('s', { shelvedAt: '2026-10-19T08:00:00Z' })
    for (const bad of [viewer, folder, owned, shelved]) {
      expect(bulkActionsFor('workspace', [manage('a'), bad], true)).not.toContain('share')
    }
  })

  it('is hidden without the share bridge and on the trash and shelved screens', () => {
    expect(bulkActionsFor('workspace', [manage('a')])).not.toContain('share')
    expect(bulkActionsFor('workspace', [manage('a')], false)).not.toContain('share')
    expect(
      bulkActionsFor('shelved', [manage('s', { shelvedAt: '2026-10-19T08:00:00Z' })], true),
    ).not.toContain('share')
    expect(bulkActionsFor('trash', [manage('t', { archived: true })], true)).not.toContain('share')
  })
})

describe('BulkBar renders the Chia sẻ button', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('shows "Chia sẻ" and reports the action id', async () => {
    const onAction = vi.fn()
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(BulkBar, {
            screen: 'workspace',
            docs: [doc({ id: 'a' }), doc({ id: 'b' })],
            busy: false,
            canShare: true,
            onAction,
            onClear: () => {},
          }),
        ),
      )
    })
    const button = host.querySelector<HTMLButtonElement>('[data-bulk-action="share"]')
    expect(button?.textContent).toBe('Chia sẻ')
    await act(async () => button!.click())
    expect(onAction).toHaveBeenCalledWith('share')
  })

  it('no button without the bridge flag', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(BulkBar, {
            screen: 'workspace',
            docs: [doc({ id: 'a' })],
            busy: false,
            onAction: () => {},
            onClear: () => {},
          }),
        ),
      )
    })
    expect(host.querySelector('[data-bulk-action="share"]')).toBeNull()
  })
})

describe('Access cell: one button when the row passes the gate', () => {
  let host: HTMLDivElement
  let root: Root
  let onShare: ReturnType<typeof vi.fn>
  let onOpen: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onShare = vi.fn()
    onOpen = vi.fn()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  async function mount(docs: DocumentsHomeDoc[], withShare = true, lang: 'vi' | 'en' = 'vi') {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(DocList, {
            screen: 'workspace',
            rows: docs.map(rowOf),
            sort: null,
            onSortChange: () => {},
            selected: new Set<string>(),
            onSelectedChange: () => {},
            label: 'Tài liệu',
            openMenuId: null,
            onOpenMenuChange: () => {},
            menuFor: () => [],
            onOpen,
            ...(withShare ? { onShare } : {}),
          }),
        ),
      )
    })
  }
  const cell = (id: string) =>
    host.querySelector<HTMLElement>(`[data-doc-id="${id}"] [data-col="access"]`)!

  it('a manager reads "Quản lý quyền truy cập của …" (the web string), the pill stays visible', async () => {
    await mount([doc({ id: 'a', title: 'Hợp đồng.docx' })])
    const button = cell('a').querySelector<HTMLButtonElement>('button')!
    expect(button).not.toBeNull()
    expect(button.getAttribute('type')).toBe('button')
    // the name is the command plus the visible text (label in name)
    const named = host.querySelector(`[data-doc-id="a"] [data-col="access"] button`)
    expect(named!.getAttribute('aria-labelledby')).toBeTruthy()
    const name = (named!.getAttribute('aria-labelledby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    expect(name).toContain('Quản lý quyền truy cập của Hợp đồng.docx')
    expect(name).toContain('Workspace')
    expect(button.querySelector('.dh-vis-badge')?.textContent).toBe('Workspace')
    expect(button.querySelector('.dh-level-sub')?.textContent).toBe('Bạn: Quản lý')
  })

  it('the name keeps the pill and the level line apart with a separator (SD-04)', async () => {
    await mount([doc({ id: 'a', title: 'Hợp đồng.docx' })])
    const b = cell('a').querySelector('button')!
    const content = document.getElementById(
      (b.getAttribute('aria-labelledby') ?? '').split(' ')[1],
    )!
    // the accessible name joins inline spans without whitespace: the separator is in the text
    expect(content.textContent).toBe('Workspace, Bạn: Quản lý')
    expect(content.querySelector('.uw-sr-only')?.textContent).toBe(', ')
  })

  it('a workspace admin without a level also reads manage; everyone else reads view', async () => {
    await mount([
      doc({ id: 'adm', title: 'A', myLevel: undefined, adminScope: true }),
      doc({ id: 'v', title: 'V', myLevel: 'view', canManage: false, canEdit: false }),
    ])
    const nameOf = (id: string) => {
      const b = cell(id).querySelector('button')!
      return (b.getAttribute('aria-labelledby') ?? '')
        .split(' ')
        .map((x) => document.getElementById(x)?.textContent ?? '')
        .join(' ')
    }
    expect(nameOf('adm')).toContain('Quản lý quyền truy cập của A')
    expect(nameOf('v')).toContain('Xem quyền truy cập của V')
  })

  it('english copy', async () => {
    await mount([doc({ id: 'a', title: 'Plan' })], true, 'en')
    const b = cell('a').querySelector('button')!
    const name = (b.getAttribute('aria-labelledby') ?? '')
      .split(' ')
      .map((x) => document.getElementById(x)?.textContent ?? '')
      .join(' ')
    expect(name).toContain('Manage access for Plan')
  })

  it('a click opens the share dialog target and never opens the document', async () => {
    const d = doc({ id: 'a' })
    await mount([d])
    await act(async () => cell('a').querySelector<HTMLButtonElement>('button')!.click())
    expect(onShare).toHaveBeenCalledTimes(1)
    expect(onShare.mock.calls[0]![0]).toMatchObject({ id: 'a' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('the click does not toggle the row selection or bubble to the row', async () => {
    const rowClick = vi.fn()
    document.body.addEventListener('click', rowClick)
    await mount([doc({ id: 'a' })])
    await act(async () => cell('a').querySelector<HTMLButtonElement>('button')!.click())
    // stopPropagation: nothing above the React root hears the click
    expect(rowClick).not.toHaveBeenCalled()
    document.body.removeEventListener('click', rowClick)
  })

  it('is a real button, so Enter / Space work and it sits in the tab order', async () => {
    await mount([doc({ id: 'a' })])
    const b = cell('a').querySelector<HTMLButtonElement>('button')!
    expect(b.tagName).toBe('BUTTON')
    expect(b.tabIndex).toBe(0)
    expect(b.disabled).toBe(false)
  })

  it('rows that fail the gate keep plain text (folder, another module, trashed)', async () => {
    await mount([
      doc({ id: 'f', kind: 'folder' }),
      doc({ id: 'o', ownerKind: 'work_product' }),
      doc({ id: 't', archived: true }),
    ])
    for (const id of ['f', 'o', 't']) {
      expect(cell(id).querySelector('button')).toBeNull()
    }
    // UNI-2066 A1: a folder row shows no pill at all; the others keep their text
    expect(cell('f').querySelector('.dh-vis-badge')).toBeNull()
    for (const id of ['o', 't']) {
      expect(cell(id).querySelector('.dh-vis-badge')).not.toBeNull()
    }
  })

  it('no share handler from the host = plain text as before', async () => {
    await mount([doc({ id: 'a' })], false)
    expect(cell('a').querySelector('button')).toBeNull()
    expect(cell('a').querySelector('.dh-vis-badge')).not.toBeNull()
  })
})
