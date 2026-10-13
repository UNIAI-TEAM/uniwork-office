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

  it('reports a workspace or a role change', async () => {
    const p = props()
    await mount(p)
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]')!, 'w1')
    expect(p.onSelectWorkspace).toHaveBeenCalledWith('w1')
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Role"]')!, 'sales')
    expect(p.onSwitchPractice).toHaveBeenCalledWith('sales')
  })

  it('hides the workspace select when there is no workspace (signed out)', async () => {
    await mount(props({ workspaces: [], workspaceId: null }))
    expect(host.querySelector('select[aria-label="Workspace"]')).toBeNull()
    expect(host.querySelector('select[aria-label="Role"]')).not.toBeNull()
  })

  it('+ New lists New task and the file types, and runs the chosen one', async () => {
    const p = props()
    await mount(p)
    expect(host.querySelector('[role="menu"]')).toBeNull()
    act(() => button('+ New')!.click())
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
    act(() => button('New document')!.click())
    expect(p.newItems[0]!.action).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="menu"]')).toBeNull()
    act(() => button('+ New')!.click())
    act(() => button('New task')!.click())
    expect(p.onNewTask).toHaveBeenCalledTimes(1)
  })

  it('Refresh asks the page to reload', async () => {
    const p = props()
    await mount(p)
    act(() => button('Refresh')!.click())
    expect(p.onRefresh).toHaveBeenCalledTimes(1)
  })
})
