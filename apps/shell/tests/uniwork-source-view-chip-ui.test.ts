// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkSourceViewChip } from '../src/renderer/src/UniworkSourceViewChip'
import type { SourceViewState } from '../src/shared/source-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The tab-strip chip of a source view ("View only · From Chat"): presentational,
 * not wired into the tab bar yet. Copy is pinned in en and vi, the origin names
 * follow the web (Chat, Tasks / Công việc, Meetings / Cuộc họp, Email).
 */

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function state(over: Partial<SourceViewState> = {}): SourceViewState {
  return { name: 'Plan.docx', origin: 'chat', parentTitle: '', ...over }
}

async function mount(s: SourceViewState | null, lang: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        // the provider keeps its first language, so a new language is a new provider
        { initial: lang, key: lang },
        createElement(UniworkSourceViewChip, { state: s }),
      ),
    )
  })
}

const chip = () => host.querySelector<HTMLElement>('.uw-pill')
const label = () => host.querySelector('.uw-pill-label')?.textContent ?? ''
const tip = () => host.querySelector('.uw-sr-only')?.textContent ?? ''

describe('UniworkSourceViewChip', () => {
  it('renders nothing without a source view', async () => {
    await mount(null)
    expect(host.innerHTML).toBe('')
  })

  it.each<[string, string, string]>([
    ['chat', 'View only · From Chat', 'Chỉ xem · Từ Chat'],
    ['task', 'View only · From Tasks', 'Chỉ xem · Từ Công việc'],
    ['meeting', 'View only · From Meetings', 'Chỉ xem · Từ Cuộc họp'],
    ['email', 'View only · From Email', 'Chỉ xem · Từ Email'],
  ])('%s: says where the file comes from in en and vi', async (origin, en, vi) => {
    await mount(state({ origin }), 'en')
    expect(label()).toBe(en)
    await mount(state({ origin }), 'vi')
    expect(label()).toBe(vi)
  })

  it('explains in the tooltip, with the parent title when there is one', async () => {
    await mount(state({ origin: 'meeting', parentTitle: 'Weekly sync' }), 'en')
    expect(chip()?.getAttribute('title')).toBe(tip())
    expect(tip()).toBe(
      "This file is attached in Meetings · Weekly sync. Changes won't be saved. To get a copy, use Download in the Documents list.",
    )
    await mount(state({ origin: 'task', parentTitle: 'Fix login' }), 'vi')
    expect(tip()).toBe(
      'Đây là tệp đính kèm trong Công việc · Fix login. Thay đổi sẽ không được lưu. Muốn có bản sao, dùng Tải xuống ở danh sách Tài liệu.',
    )
  })

  it.each(['', '   '])(
    'leaves the parent out when the title is %j',
    async (parentTitle) => {
      await mount(state({ origin: 'email', parentTitle }), 'en')
      expect(tip()).toBe(
        "This file is attached in Email. Changes won't be saved. To get a copy, use Download in the Documents list.",
      )
      expect(tip()).not.toContain('·')
    },
  )

  it('is one labelled, focusable-by-description group that never prints ids or internal codes', async () => {
    await mount(state({ name: 'UNI-1993-spec.docx', origin: 'chat', parentTitle: 'Standup' }), 'en')
    const el = chip()!
    expect(el.getAttribute('role')).toBe('group')
    expect(el.getAttribute('aria-label')).toBe(label())
    expect(el.getAttribute('aria-describedby')).toBe(host.querySelector('.uw-sr-only')?.id)
    expect(el.getAttribute('data-tone')).toBe('neutral')
    // the file name is the tab title, not part of the chip
    expect(el.textContent).not.toContain('UNI-')
    expect(el.textContent).not.toContain('Plan')
  })

  // USR-fe-3: the shared state keeps the origin as the server sent it; an origin this build has no
  // name for reads as the generic view-only chip (no new copy), never as a broken key
  it.each(['doc', 'crm', ''])(
    'an origin the chip does not know (%j) falls back to the generic view-only chip and tip',
    async (origin) => {
      await mount(state({ origin, parentTitle: 'Q4 deck' }), 'en')
      expect(label()).toBe('View only')
      expect(tip()).toBe('You can view this document but not change it.')
      expect(chip()?.getAttribute('title')).toBe(tip())
      expect(chip()?.getAttribute('aria-label')).toBe('View only')
      expect(chip()?.textContent).not.toMatch(/undefined|uwSource|From/)
      await mount(state({ origin, parentTitle: 'Q4 deck' }), 'vi')
      expect(label()).toBe('Chỉ xem')
      expect(chip()?.textContent).not.toMatch(/undefined|uwSource/)
    },
  )

  it('uses theme tokens only: no inline colour', async () => {
    await mount(state(), 'en')
    for (const node of host.querySelectorAll<HTMLElement>('*')) {
      expect(node.getAttribute('style') ?? '').not.toMatch(/#[0-9a-f]{3,8}|rgb|hsl/i)
    }
  })

  it('follows the language it is mounted in', async () => {
    await mount(state({ origin: 'chat' }), 'en')
    expect(label()).toBe('View only · From Chat')
    await mount(state({ origin: 'chat' }), 'vi')
    expect(label()).toBe('Chỉ xem · Từ Chat')
  })
})
