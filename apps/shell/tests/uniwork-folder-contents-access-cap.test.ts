/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { FolderContentsAccessDialog } from '../src/renderer/src/uniwork-share/FolderContentsAccessDialog'
import { resetFolderBatchesForTest } from '../src/renderer/src/uniwork-share/folder-contents-access-store'
import {
  createFakeShareApi,
  type FakeShareApi,
} from '../src/renderer/src/uniwork-share/fake-share-api'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import type { UniworkShareApi } from '../src/shared/share-api'

// the server takes 100 items; the cap is shrunk to 3 so the dialog's own limit can be driven with
// the fake's few candidates (R1-3: the dialog stops adding and says so, the home row keeps a slot)
vi.mock('../src/shared/share-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/share-api')>()),
  FOLDER_CONTENTS_ACCESS_MAX_ITEMS: 3,
}))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkShareStrings.en as Record<string, string>
const text = (key: string, params: Record<string, string | number> = {}) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (w, n: string) => (n in params ? String(params[n]) : w))

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function withFolderCandidates(api: FakeShareApi): FakeShareApi {
  return Object.assign(Object.create(api) as FakeShareApi, {
    candidates: (input: Parameters<UniworkShareApi['candidates']>[0]) =>
      api.candidates({ ...input, documentId: 'doc_1' }),
  })
}

describe('FolderContentsAccessDialog item cap (UNI-2244, R1-3)', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    resetFolderBatchesForTest()
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(FolderContentsAccessDialog, {
            open: true,
            folder: { id: 'fld_1', workspaceId: 'ws_1', title: 'Plans' },
            workspaceName: 'Team',
            api: withFolderCandidates(createFakeShareApi({ folderContents: { total: 4 } })),
            onClose: () => {},
          }),
        ),
      )
    })
    await flush()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E>(sel)
  const qa = (sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel))
  async function click(el: Element | null | undefined) {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
  }
  async function pick(name: string) {
    await click(q('[data-fca-form] input[role="combobox"]'))
    await click(qa('[role="option"]').find((o) => o.textContent?.includes(name)))
  }
  const search = () => q<HTMLInputElement>('[data-fca-form] input[role="combobox"]')!
  const confirm = () => q<HTMLButtonElement>('[data-fca-confirm]')!

  it('merge: at the cap the search is off and a short message says how many fit', async () => {
    await pick('Minh')
    await pick('Design')
    expect(q('[data-fca-cap]')).toBeNull()
    expect(search().disabled).toBe(false)
    await pick('Acme')
    expect(q('[data-fca-cap]')!.textContent).toBe(text('shrFcTooMany', { max: 3 }))
    expect(search().disabled).toBe(true)
    // three items are allowed: Confirm is live
    expect(confirm().getAttribute('aria-disabled')).toBeNull()
    // removing one gives the slot back
    await click(q('.uw-share-chip-x'))
    expect(q('[data-fca-cap]')).toBeNull()
    expect(search().disabled).toBe(false)
  })

  it('replace keeps a slot for the home row: the cap is one lower', async () => {
    await click(q('[data-fca-mode="replace"]'))
    await pick('Minh')
    expect(q('[data-fca-cap]')).toBeNull()
    await pick('Design')
    expect(q('[data-fca-cap]')!.textContent).toBe(text('shrFcTooMany', { max: 2 }))
    expect(search().disabled).toBe(true)
  })

  it('switching to replace with a full list blocks Confirm until one is removed', async () => {
    await pick('Minh')
    await pick('Design')
    await pick('Acme')
    await click(q('[data-fca-mode="replace"]'))
    const home = q<HTMLSelectElement>('[data-fca-home-level]')!
    await act(async () => {
      home.value = 'edit'
      home.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    // 3 picked + the home row = 4 items: over the cap
    expect(q('[data-fca-cap]')!.textContent).toBe(text('shrFcTooMany', { max: 2 }))
    expect(confirm().getAttribute('aria-disabled')).toBe('true')
    await click(q('.uw-share-chip-x'))
    expect(confirm().getAttribute('aria-disabled')).toBeNull()
  })
})
