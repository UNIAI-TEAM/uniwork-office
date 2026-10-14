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
import { createStickyNote, writeForms } from '../src/renderer/src/workbench-pins'

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

async function mount(moduleId: WorkbenchModuleId, packId: string | null = null) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WorkbenchModulePane, {
          moduleId,
          practiceId: 'sales',
          vi: false,
          packId,
          workspace: null,
          workspaceError: null,
          onReload: () => undefined,
        }),
      ),
    )
  })
}

describe('Forms tab (redesign spec 4.6)', () => {
  it('one add row, a one-line hint, the empty state panel and no pill button', async () => {
    await mount('forms')
    expect(host.querySelector('.wb-forms-hint')).not.toBeNull()
    const add = host.querySelector('.wb-forms-add')!
    expect(
      Array.from(add.querySelectorAll('input')).map((i) => i.getAttribute('aria-label')),
    ).toEqual(['Form title', 'Note (optional)'])
    expect(add.querySelector('.wb-btn-secondary')?.textContent).toBe('Upload template file…')
    expect(add.querySelector('.wb-btn-primary')?.textContent).toBe('Add to library')
    expect(host.querySelector('.btn')).toBeNull()
    expect(host.querySelector('.wb-state')?.textContent).toContain('No forms yet.')
  })

  it('a saved form is a list row; with no pack the hint shows beside the locked Draft, outside the hover-only actions', async () => {
    writeForms('sales', [{ id: 'f1', title: 'Leave request', note: 'HR' }])
    await mount('forms')
    const row = host.querySelector('.wb-block > li.wb-row')!
    expect(row.querySelector('.wb-forms-text')?.textContent).toBe('Leave requestHR')
    expect(row.querySelector(':scope > .wb-forms-locked')?.textContent).toBe(
      'Select a Knowledge pack before drafting.',
    )
    expect(row.querySelector('.wb-row-actions .wb-forms-locked')).toBeNull()
    expect(row.querySelector<HTMLButtonElement>('button[aria-label="Draft"]')!.disabled).toBe(true)
  })

  it('with a pack selected, Draft is enabled and the hint is gone', async () => {
    writeForms('sales', [{ id: 'f1', title: 'Leave request' }])
    await mount('forms', 'p1')
    expect(host.querySelector('.wb-forms-locked')).toBeNull()
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Draft"]')!.disabled).toBe(
      false,
    )
  })
})

describe('Notes tab (redesign spec 4.7)', () => {
  it('empty: the state panel and a primary Add note button', async () => {
    await mount('notes')
    expect(host.querySelector('.wb-notes-add .wb-btn-primary')?.textContent).toBe('Add note')
    expect(host.querySelector('.wb-state')?.textContent).toContain('No notes yet.')
  })

  it('a note is a list row with an edited caption; delete is a row action', async () => {
    createStickyNote('sales', 'Call the notary')
    await mount('notes')
    const row = host.querySelector('.wb-block > li.wb-row.wb-notes-card')!
    expect(row.querySelector('textarea')?.value).toBe('Call the notary')
    expect(row.querySelector('.wb-notes-edited')?.textContent).toMatch(/^Edited /)
    await act(async () =>
      row
        .querySelector<HTMLButtonElement>('.wb-row-actions button[aria-label="Delete note"]')!
        .click(),
    )
    expect(host.querySelector('.wb-notes-card')).toBeNull()
    expect(host.querySelector('.wb-state')?.textContent).toContain('No notes yet.')
  })
})
