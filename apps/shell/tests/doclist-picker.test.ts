/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocPickerList, type DocPickerListProps } from '../src/renderer/src/doclist/PickerList'
import { PICKER_EDITOR_RUNG } from '../src/renderer/src/doclist/picker'
import type { UniworkDocSummary } from '../src/shared/home-api'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

// 2026-10-21 12:00 local; every date below is relative to it
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0).toISOString()

const doc = (partial: Partial<UniworkDocSummary> & { id: string }): UniworkDocSummary => ({
  workspaceId: 'ws-1',
  title: partial.id,
  format: 'docx',
  updatedAt: iso(2026, 10, 21, 9, 5),
  kind: 'file',
  parentId: null,
  ...partial,
})

const BUDGET = doc({
  id: 'budget',
  title: 'Kế hoạch ngân sách.xlsx',
  format: 'xlsx',
  updatedAt: iso(2026, 10, 21, 9, 5),
  updatedByName: 'Minh Trần',
  // the table's own columns are not the picker's: none of these may surface
  visibility: 'workspace',
  myLevel: 'edit',
  sizeBytes: 2_969,
})
const NOTE = doc({
  id: 'note',
  title: 'Ghi chú họp',
  format: null,
  kind: 'page',
  updatedAt: iso(2026, 10, 20, 16, 30),
  updatedByName: 'Lan Nguyễn',
})
const REPORT = doc({
  id: 'report',
  title: 'Báo cáo Q3.docx',
  updatedAt: iso(2025, 3, 2, 8, 0),
})
const FOLDER = doc({
  id: 'plans',
  title: 'Kế hoạch',
  kind: 'folder',
  format: null,
  updatedAt: iso(2026, 10, 15, 8, 0),
})
// deliberately not in name or date order: the picker lists what the server gave
const DOCS = [REPORT, BUDGET, NOTE]

describe('DocPickerList: the compact picker variant (UNI-2047 B2)', () => {
  let host: HTMLDivElement
  let root: Root
  let width = 0

  beforeEach(() => {
    width = 0
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const w = this.classList.contains('dh-picker') ? width : 0
      return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: 0, width: w, height: 0 } as DOMRect
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function mount(
    docs: readonly UniworkDocSummary[] = DOCS,
    extra: Partial<DocPickerListProps> = {},
    lang: 'vi' | 'en' = 'vi',
  ) {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(DocPickerList, {
            docs,
            label: 'Tài liệu gần đây',
            activeId: null,
            ...extra,
          }),
        ),
      )
    })
  }

  const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'))
  const optionOf = (id: string) => options().find((el) => el.dataset.id === id)!
  const cell = (id: string, col: string) =>
    optionOf(id).querySelector<HTMLElement>(`[data-col="${col}"]`)
  const headerCells = () =>
    Array.from(host.querySelectorAll<HTMLElement>('.dh-picker-head [data-col]')).map((el) =>
      el.getAttribute('data-col'),
    )

  it('is one listbox of options in the order it was given, never re-sorted', async () => {
    await mount()
    const box = host.querySelector('[role="listbox"]')!
    expect(box.getAttribute('aria-label')).toBe('Tài liệu gần đây')
    expect(box.tagName).toBe('UL')
    expect(options().map((el) => el.dataset.id)).toEqual(['report', 'budget', 'note'])
    // each option sits in a presentation item, like the list it replaces
    for (const el of options()) expect(el.parentElement?.getAttribute('role')).toBe('presentation')
    // the table's roles do not leak into the listbox
    expect(host.querySelector('[role="table"], [role="row"], [role="cell"]')).toBeNull()
  })

  it('carries the host id, describedby and class on the listbox', async () => {
    await mount(DOCS, { id: 'uw-pick-list', describedBy: 'hint', className: 'uwf-contents' })
    const box = host.querySelector('[role="listbox"]')!
    expect(box.id).toBe('uw-pick-list')
    expect(box.getAttribute('aria-describedby')).toBe('hint')
    expect(box.classList.contains('uwf-contents')).toBe(true)
    expect(box.classList.contains('uw-pick-list')).toBe(true)
  })

  it('has a quiet header Tên · Người sửa gần nhất · Cập nhật that is not a control', async () => {
    await mount()
    expect(headerCells()).toEqual(['name', 'editor', 'updated'])
    const head = host.querySelector<HTMLElement>('.dh-picker-head')!
    expect(head.textContent).toBe('TênNgười sửa gần nhấtCập nhật')
    // visual only: the rows already say it all to a screen reader, and a header is not a listbox child
    expect(head.getAttribute('aria-hidden')).toBe('true')
    expect(head.closest('[role="listbox"]')).toBeNull()
    expect(host.querySelector('button, input, [aria-sort], [role="columnheader"]')).toBeNull()
  })

  it('has no Chọn, Truy cập, Dung lượng or Thao tác column', async () => {
    await mount()
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    expect(host.querySelector('.dh-vis-badge, .dh-level-sub')).toBeNull()
    for (const col of ['select', 'access', 'size', 'actions']) {
      expect(host.querySelector(`[data-col="${col}"]`)).toBeNull()
    }
    // the size and the access of the row are in the data and still do not show
    expect(optionOf('budget').textContent).not.toMatch(/KB|Workspace|Chủ sở hữu|Bạn:/)
  })

  it('writes Cập nhật with the shared date format in vi', async () => {
    await mount()
    expect(cell('budget', 'updated')!.textContent).toBe('09:05')
    expect(cell('note', 'updated')!.textContent).toBe('Hôm qua, 16:30')
    expect(cell('report', 'updated')!.textContent).toBe('02/03/2025')
  })

  it('writes Cập nhật with the shared date format in en', async () => {
    await mount(DOCS, {}, 'en')
    expect(cell('budget', 'updated')!.textContent).toBe('09:05')
    expect(cell('note', 'updated')!.textContent).toBe('Yesterday, 16:30')
    expect(cell('report', 'updated')!.textContent).toBe('Mar 2, 2025')
  })

  it('writes Người sửa as the shared avatar and name, — when the row has none', async () => {
    await mount()
    const minh = cell('budget', 'editor')!
    expect(minh.querySelector('.dh-avatar')?.textContent).toBe('MT')
    expect(minh.querySelector('.dh-person-name')?.textContent).toBe('Minh Trần')
    expect(cell('report', 'editor')!.textContent).toBe('—')
  })

  it('shows Tên as a badge, the title and an optional second line', async () => {
    await mount(DOCS, {
      sublineFor: (d) => (d.id === 'budget' ? { short: 'Pháp chế', full: 'Pháp chế' } : null),
    })
    const budget = cell('budget', 'name')!
    expect(budget.querySelector('.uw-pick-row-title')?.textContent).toBe('Kế hoạch ngân sách.xlsx')
    expect(budget.querySelector('.uw-pick-row-meta')?.textContent).toBe('Pháp chế')
    expect(budget.querySelector('img, svg')).not.toBeNull()
    expect(cell('note', 'name')!.querySelector('.uw-pick-row-meta')).toBeNull()
  })

  it('reads a path second line left-truncated, with the full path for a screen reader', async () => {
    await mount(DOCS, {
      sublineFor: (d) =>
        d.id === 'budget' ? { short: '…/Contracts', full: 'Alpha / Contracts', path: true } : null,
    })
    const meta = cell('budget', 'name')!.querySelector<HTMLElement>('.uw-pick-row-meta')!
    expect(meta.classList.contains('uwf-path')).toBe(true)
    expect(meta.querySelector('[aria-hidden="true"]')?.textContent).toBe('…/Contracts')
    expect(meta.querySelector('.uw-sr-only')?.textContent).toContain('Alpha / Contracts')
  })

  it('draws a folder with the folder glyph and still dates it', async () => {
    await mount([FOLDER, ...DOCS])
    const name = cell('plans', 'name')!
    expect(name.querySelector('.uwf-row-icon')).not.toBeNull()
    expect(name.querySelector('.uw-pick-row-title')?.textContent).toBe('Kế hoạch')
    expect(cell('plans', 'updated')!.textContent).toBe('15/10')
  })

  it('titleOf renames a row on screen only (My Folder), nameFor replaces the title (rename)', async () => {
    await mount(DOCS, {
      titleOf: (d) => (d.id === 'note' ? 'Thư mục của tôi' : d.title),
      nameFor: (d) => (d.id === 'report' ? createElement('input', { className: 'rn' }) : null),
    })
    expect(cell('note', 'name')!.querySelector('.uw-pick-row-title')?.textContent).toBe(
      'Thư mục của tôi',
    )
    expect(cell('report', 'name')!.querySelector('input.rn')).not.toBeNull()
    expect(cell('report', 'name')!.querySelector('.uw-pick-row-title')).toBeNull()
  })

  it('iconFor stands in for the file badge of a row that is not a file', async () => {
    await mount(DOCS, {
      iconFor: (d) => (d.id === 'note' ? createElement('i', { className: 'mark' }) : null),
    })
    expect(cell('note', 'name')!.querySelector('i.mark')).not.toBeNull()
    expect(cell('note', 'name')!.querySelector('svg, img')).toBeNull()
    // a null keeps the badge
    expect(cell('report', 'name')!.querySelector('i.mark')).toBeNull()
    expect(cell('report', 'name')!.querySelector('img, svg')).not.toBeNull()
  })

  it('marks only the active option selected', async () => {
    await mount(DOCS, { activeId: 'budget' })
    expect(options().map((el) => el.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])
    expect(optionOf('budget').classList.contains('active')).toBe(true)
    expect(optionOf('note').classList.contains('active')).toBe(false)
  })

  it('flags disabled, archived and opening rows with the classes the dialog styles', async () => {
    await mount(DOCS, {
      stateOf: (d) =>
        d.id === 'report'
          ? { disabled: true }
          : d.id === 'budget'
            ? { archived: true }
            : d.id === 'note'
              ? { opening: true }
              : {},
    })
    expect(optionOf('report').classList.contains('disabled')).toBe(true)
    expect(optionOf('budget').classList.contains('archived')).toBe(true)
    expect(optionOf('note').classList.contains('opening')).toBe(true)
    expect(optionOf('budget').classList.contains('disabled')).toBe(false)
  })

  it('hands the host its own attributes and handlers: id, roving tabindex, click, keys', async () => {
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    await mount(DOCS, {
      activeId: 'budget',
      optionProps: (d, index) => ({
        id: `uw-doc-${index}`,
        tabIndex: d.id === 'budget' ? 0 : -1,
        title: `t-${d.id}`,
        'aria-disabled': d.id === 'report' ? true : undefined,
        onClick: () => onClick(d.id),
        onKeyDown: () => onKeyDown(d.id),
      }),
    })
    expect(options().map((el) => el.id)).toEqual(['uw-doc-0', 'uw-doc-1', 'uw-doc-2'])
    expect(options().map((el) => el.tabIndex)).toEqual([-1, 0, -1])
    expect(optionOf('report').getAttribute('aria-disabled')).toBe('true')
    expect(optionOf('budget').title).toBe('t-budget')
    // the picker keeps its own class beside the host's
    expect(optionOf('budget').classList.contains('uw-pick-row')).toBe(true)
    await act(async () => {
      optionOf('note').click()
      optionOf('note').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledWith('note')
    expect(onKeyDown).toHaveBeenCalledWith('note')
  })

  it('puts a row\u2019s buttons beside the option, never inside it', async () => {
    await mount(DOCS, {
      trailing: (d) => createElement('button', { type: 'button', 'data-info-for': d.id }, 'i'),
    })
    const item = optionOf('budget').parentElement!
    const button = item.querySelector('button[data-info-for="budget"]')!
    expect(button.parentElement).toBe(item)
    expect(button.closest('[role="option"]')).toBeNull()
    expect(item.classList.contains('uw-pick-item')).toBe(true)
  })

  it('hides Người sửa below the rung and names the editor under the title instead', async () => {
    width = PICKER_EDITOR_RUNG - 1
    await mount(DOCS, {
      sublineFor: (d) => (d.id === 'budget' ? { short: 'Pháp chế', full: 'Pháp chế' } : null),
    })
    expect(headerCells()).toEqual(['name', 'updated'])
    expect(host.querySelector('[data-col="editor"]')).toBeNull()
    expect(cell('budget', 'name')!.querySelector('.uw-pick-row-meta')?.textContent).toBe(
      'Pháp chế · Minh Trần',
    )
    expect(cell('note', 'name')!.querySelector('.uw-pick-row-meta')?.textContent).toBe('Lan Nguyễn')
    expect(cell('report', 'name')!.querySelector('.uw-pick-row-meta')).toBeNull()
    // Cập nhật is always there
    expect(cell('budget', 'updated')!.textContent).toBe('09:05')
  })

  it('shows Người sửa again at the rung', async () => {
    width = PICKER_EDITOR_RUNG
    await mount()
    expect(headerCells()).toEqual(['name', 'editor', 'updated'])
  })
})
