/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkbenchTopBar } from '../src/renderer/src/WorkbenchTopBar'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WORKSPACES: UniworkWorkspaceRef[] = [
  { id: 'w1', name: 'Team', orgId: 'o1', slug: 'team', orgSlug: 'acme' },
  { id: 'w2', name: 'Sales', orgId: 'o1', slug: 'sales', orgSlug: 'acme' },
]

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

function props(over: Partial<Parameters<typeof WorkbenchTopBar>[0]> = {}) {
  return {
    practice: requirePractice('entrepreneur'),
    onSwitchPractice: vi.fn(),
    workspaces: WORKSPACES,
    workspaceId: 'w2' as string | null,
    onSelectWorkspace: vi.fn(),
    newItems: [{ ext: 'docx', title: 'New document', action: vi.fn() }],
    onNewTask: vi.fn(),
    onRefresh: vi.fn(),
    ...over,
  }
}

async function mount(p: ReturnType<typeof props>): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(WorkbenchTopBar, p)))
  })
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const button = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )

describe('WorkbenchTopBar', () => {
  it('shows the title, the selected workspace and the role', async () => {
    await mount(props())
    expect(host.querySelector('h1')?.textContent).toBe('Workbench')
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]')!.value).toBe(
      'w2',
    )
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Role"]')!.value).toBe(
      'entrepreneur',
    )
  })

  it('page head: the title, then the workspace chip with its initial, then the role chip', async () => {
    const p = props()
    await mount(p)
    const header = host.querySelector('header.wb-topbar')!
    expect(header.firstElementChild?.tagName).toBe('H1')
    const ws = host.querySelector('.wb-crumb-ws')!
    expect(header.children[1]).toBe(ws)
    expect(ws.querySelector('.wb-crumb-mark')?.textContent).toBe('S')
    expect(ws.querySelector('.wb-crumb-name')?.textContent).toBe('Sales')
    expect(ws.querySelector('.wb-crumb-caret')?.classList.contains('is-muted')).toBe(false)
    // the chevron is a drawn glyph, not a ▾ character
    expect(ws.querySelector('.wb-crumb-caret svg')).not.toBeNull()
    expect(host.textContent).not.toContain('▾')
    expect(host.querySelector('.wb-crumb-sep')).toBeNull()
    expect(ws.querySelector(':scope > select[aria-label="Workspace"]')).not.toBeNull()
    const role = host.querySelector('.wb-crumb-role')!
    expect(header.children[2]).toBe(role)
    expect(role.querySelector('.wb-crumb-name')?.textContent).toBe(p.practice.labelEn)
    expect(role.querySelector(':scope > select[aria-label="Role"]')).not.toBeNull()
    // the chips' visible text is decorative: the select carries the name and value
    expect(ws.querySelector('.wb-crumb-name')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keyboard reaches each chip through its select; the chip text is not a second stop', async () => {
    await mount(props())
    const selects = Array.from(host.querySelectorAll<HTMLSelectElement>('.wb-crumb > select'))
    expect(selects).toHaveLength(2)
    for (const s of selects) {
      expect(s.tabIndex).toBe(0)
      expect(s.disabled).toBe(false)
    }
    expect(
      host.querySelectorAll('.wb-crumb button, .wb-crumb a, .wb-crumb [tabindex]'),
    ).toHaveLength(0)
    for (const span of Array.from(host.querySelectorAll('.wb-crumb > span'))) {
      expect(span.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('mutes the workspace caret when there is only one workspace', async () => {
    await mount(props({ workspaces: [WORKSPACES[0]!], workspaceId: 'w1' }))
    expect(host.querySelector('.wb-crumb-ws .wb-crumb-caret')?.classList.contains('is-muted')).toBe(
      true,
    )
  })

  it('reports a workspace or a role change', async () => {
    const p = props()
    await mount(p)
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]')!, 'w1')
    expect(p.onSelectWorkspace).toHaveBeenCalledWith('w1')
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Role"]')!, 'sales')
    expect(p.onSwitchPractice).toHaveBeenCalledWith('sales')
  })

  it('signed out: no workspace chip, only the role chip', async () => {
    await mount(props({ workspaces: [], workspaceId: null }))
    expect(host.querySelector('select[aria-label="Workspace"]')).toBeNull()
    expect(host.querySelector('.wb-crumb-ws')).toBeNull()
    expect(host.querySelector('.wb-crumb-role select[aria-label="Role"]')).not.toBeNull()
  })

  it('New lists New task and the file types in the shared menu, and runs the chosen one', async () => {
    const p = props()
    await mount(p)
    const newBtn = button('New')!
    expect(newBtn.className).toBe('wb-btn wb-btn-primary')
    // a plus and a chevron drawn as glyphs around the label, no "+" character
    expect(newBtn.querySelectorAll('svg')).toHaveLength(2)
    expect(host.querySelector('[role="menu"]')).toBeNull()
    act(() => newBtn.click())
    const menu = host.querySelector('[role="menu"]')!
    expect(menu.className).toContain('wb-menu')
    expect(document.activeElement?.textContent).toBe('New task')
    act(() => button('New document')!.click())
    expect(p.newItems[0]!.action).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="menu"]')).toBeNull()
    act(() => newBtn.click())
    act(() => button('New task')!.click())
    expect(p.onNewTask).toHaveBeenCalledTimes(1)
  })

  it('Refresh is a bordered icon button named for screen readers and asks the page to reload', async () => {
    const p = props()
    await mount(p)
    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!
    expect(refresh.title).toBe('Refresh')
    expect(refresh.className).toBe('wb-btn wb-btn-secondary wb-btn-icon')
    expect(refresh.textContent).toBe('')
    act(() => refresh.click())
    expect(p.onRefresh).toHaveBeenCalledTimes(1)
  })
})
