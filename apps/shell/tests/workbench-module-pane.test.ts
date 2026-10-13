/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchModuleId } from '@uniwork/practice-core'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/renderer/src/workbench-store-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/workbench-store-client')>()),
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
  wbStoreRemove: (key: string) => {
    store.delete(key)
  },
  wbStoreRead: <T>(key: string, fallback: T): T => {
    const raw = store.get(key)
    return raw === undefined ? fallback : (JSON.parse(raw) as T)
  },
  wbStoreWrite: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value))
  },
}))

import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkbenchModulePane } from '../src/renderer/src/WorkbenchModulePanes'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(moduleId: WorkbenchModuleId, contextTitle?: string) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WorkbenchModulePane, {
          moduleId,
          practiceId: 'sales',
          vi: false,
          contextTitle,
          workspace: null,
          workspaceError: null,
          onReload: () => undefined,
        }),
      ),
    )
  })
}

describe('Workbench module pane frame (redesign spec 4.2)', () => {
  it('a local tab: one header with the module name, its hint as meta and the device tag', async () => {
    await mount('notes', 'Acme deal')
    expect(host.querySelector('section.wb-pane')?.getAttribute('aria-label')).toBe('Notes')
    expect(host.querySelector('.wb-panel, .wb-detail')).toBeNull()
    expect(Array.from(host.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Notes'])
    expect(host.querySelector('.wb-pane-meta')?.textContent).toBe(
      'Quick notes, stored on this device · Acme deal',
    )
    expect(host.querySelector('.wb-pane-aside .wb-local-tag')?.textContent).toBe('On this device')
  })

  it('a server tab gets the header without the device tag', async () => {
    await mount('calendar')
    expect(host.querySelectorAll('.wb-pane-head')).toHaveLength(1)
    expect(host.querySelector('.wb-pane-meta')?.textContent).toBe(
      'Due tasks and meetings in the next 14 days',
    )
    expect(host.querySelector('.wb-local-tag')).toBeNull()
  })

  it('Tasks gets exactly one header, drawn by the Tasks pane (no count before a list)', async () => {
    await mount('tasks')
    expect(host.querySelectorAll('.wb-pane-head')).toHaveLength(1)
    expect(host.querySelector('.wb-pane-title')?.textContent).toBe('Tasks')
    expect(host.querySelector('.wb-pane-aside')).toBeNull()
  })
})
