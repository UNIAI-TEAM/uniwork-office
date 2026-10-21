/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  BulkShareDialog,
  type BulkShareDoc,
} from '../src/renderer/src/uniwork-share/BulkShareDialog'
import {
  createFakeShareApi,
  type FakeShareApi,
  type FakeShareOptions,
} from '../src/renderer/src/uniwork-share/fake-share-api'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'
import type { ShareBulkPlan } from '../src/shared/share-api'

/**
 * UNI-2047 SD-C: the bulk Share dialog (web bulk-share-dialog.tsx, W13): one picker and one
 * level for every document, "update existing", the home-workspace choice, the link choice,
 * a sequential run through `window.uniworkShare.bulk`, a per-document result list and the
 * created links shown once with "copy all".
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkShareStrings.en as Record<string, string>
const viText = uniworkShareStrings.vi as Record<string, string>
const t = (key: string, params?: Record<string, string | number>, table = en) =>
  (table[key] ?? key).replace(/\{(\w+)\}/g, (w, n: string) =>
    params && n in params ? String(params[n]) : w,
  )

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const DOCS: BulkShareDoc[] = [
  { id: 'doc_1', workspaceId: 'ws_1', title: 'Doc One' },
  { id: 'doc_2', workspaceId: 'ws_1', title: 'Doc Two' },
]

describe('BulkShareDialog (UNI-2047 SD-C)', () => {
  let host: HTMLDivElement
  let root: Root
  let onClose: ReturnType<typeof vi.fn>
  let onChanged: ReturnType<typeof vi.fn>
  let onApplied: ReturnType<typeof vi.fn>
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onClose = vi.fn()
    onChanged = vi.fn()
    onApplied = vi.fn()
    writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })
  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
  })

  async function open(
    options: FakeShareOptions = {},
    docs: BulkShareDoc[] = DOCS,
    lang: 'en' | 'vi' = 'en',
  ): Promise<FakeShareApi> {
    const api = createFakeShareApi(options)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(BulkShareDialog, { open: true, docs, api, onClose, onChanged, onApplied }),
        ),
      )
    })
    await flush()
    return api
  }

  const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E>(sel)
  const qa = (sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel))
  async function click(el: Element | null | undefined) {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
  }
  async function typeInto(input: HTMLInputElement, value: string) {
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }
  async function pick(name: string) {
    const input = q<HTMLInputElement>('[data-bulk-share] input[role="combobox"]')!
    await click(input)
    await click(qa('[role="option"]').find((o) => o.textContent?.includes(name)))
  }
  const submit = () => q<HTMLButtonElement>('[data-bulk-submit]')
  const plans = (api: FakeShareApi) =>
    api.calls.filter((c) => c.method === 'bulk').map((c) => c.args[0] as ShareBulkPlan)

  it('title, applies-to line and the three choices, in the web copy', async () => {
    await open()
    const dialog = q('[role="dialog"]')!
    expect(q('#' + dialog.getAttribute('aria-labelledby'))!.textContent).toBe(
      t('shrBulkTitleOther', { count: 2 }),
    )
    expect(dialog.textContent).toContain(t('shrBulkAppliesToOther', { count: 2 }))
    expect(dialog.textContent).toContain(t('shrAddTitle'))
    expect(q('[data-bulk-workspace]')).toBeTruthy()
    expect(q('[data-bulk-link]')).toBeTruthy()
    // the workspace select: keep first, then the levels, then "only people it is shared with"
    expect(
      Array.from(q<HTMLSelectElement>('[data-bulk-workspace]')!.options).map((o) => o.value),
    ).toEqual(['keep', 'view', 'comment', 'edit', 'none'])
    expect(
      Array.from(q<HTMLSelectElement>('[data-bulk-link]')!.options).map((o) => o.value),
    ).toEqual(['keep', 'create', 'revoke'])
    expect(q('[data-bulk-expiry]')).toBeNull()
  })

  it('one document reads the singular title; vi is the web copy', async () => {
    await open({}, [DOCS[0]!], 'vi')
    expect(q('[role="dialog"]')!.textContent).toContain(t('shrBulkTitleOne', { count: 1 }, viText))
    expect(viText.shrBulkTitleOne).toBe('Chia sẻ {count} tài liệu')
    expect(en.shrBulkCopyAll).toBe('Copy all')
  })

  it('nothing to apply (no person, workspace and link on keep): the button is inert', async () => {
    const api = await open()
    expect(submit()!.getAttribute('aria-disabled')).toBe('true')
    await click(submit())
    expect(plans(api)).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('candidates are asked from the first document only, once the picker opens', async () => {
    const api = await open()
    expect(api.calls.filter((c) => c.method === 'candidates')).toEqual([])
    await pick('Minh Trần')
    const asked = api.calls.filter((c) => c.method === 'candidates')
    expect(asked.length).toBeGreaterThan(0)
    for (const call of asked) {
      expect((call.args[0] as { documentId: string }).documentId).toBe('doc_1')
    }
  })

  it('runs one plan for every document: people at the chosen level, keep by default', async () => {
    const api = await open()
    await pick('Minh Trần')
    await pick('An Lê')
    await choose(q<HTMLSelectElement>('[data-bulk-level]')!, 'edit')
    await click(submit())
    expect(plans(api)).toEqual([
      {
        docs: [
          { id: 'doc_1', workspaceId: 'ws_1' },
          { id: 'doc_2', workspaceId: 'ws_1' },
        ],
        people: [
          { principalType: 'user', principalId: 'u_minh', level: 'edit' },
          { principalType: 'user', principalId: 'u_an', level: 'edit' },
        ],
        onExisting: 'keep',
        workspace: 'keep',
        link: 'keep',
      },
    ])
  })

  it('"update existing" moves people who already have access', async () => {
    const api = await open()
    await pick('Minh Trần')
    await click(q('[data-bulk-update-existing]'))
    await click(submit())
    expect(plans(api)[0]!.onExisting).toBe('update')
  })

  it('a group that cannot manage is capped at edit when the common level is manage', async () => {
    const api = await open()
    await pick('Acme')
    await choose(q<HTMLSelectElement>('[data-bulk-level]')!, 'manage')
    await click(submit())
    expect(plans(api)[0]!.people).toEqual([
      expect.objectContaining({ principalType: 'organization', level: 'edit' }),
    ])
  })

  it('a chip can be removed before applying', async () => {
    const api = await open()
    await pick('Minh Trần')
    await pick('An Lê')
    const chips = qa('[data-bulk-share] [data-chip]')
    expect(chips).toHaveLength(2)
    await click(chips[0]!.querySelector('button'))
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'view')
    await click(submit())
    expect(plans(api)[0]!.people.map((p) => p.principalId)).toEqual(['u_an'])
  })

  it('the home-workspace choice alone is enough, with no person', async () => {
    const api = await open()
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'comment')
    expect(submit()!.getAttribute('aria-disabled')).toBeNull()
    await click(submit())
    expect(plans(api)[0]).toMatchObject({ people: [], workspace: 'comment', link: 'keep' })
  })

  it('"only people it is shared with" removes the workspace row', async () => {
    const api = await open()
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'none')
    await click(submit())
    expect(plans(api)[0]!.workspace).toBe('none')
  })

  it('link revoke is enough on its own; no expiry field then', async () => {
    const api = await open()
    await choose(q<HTMLSelectElement>('[data-bulk-link]')!, 'revoke')
    expect(q('[data-bulk-expiry]')).toBeNull()
    await click(submit())
    expect(plans(api)[0]).toMatchObject({ link: 'revoke' })
    expect(plans(api)[0]!.expiresInDays).toBeUndefined()
  })

  it('link create shows an expiry (default 7) clamped to 1-90', async () => {
    const api = await open()
    await choose(q<HTMLSelectElement>('[data-bulk-link]')!, 'create')
    const expiry = q<HTMLInputElement>('[data-bulk-expiry]')!
    expect(expiry.value).toBe('7')
    expect(expiry.min).toBe('1')
    expect(expiry.max).toBe('90')
    await typeInto(expiry, '200')
    await click(submit())
    expect(plans(api)[0]).toMatchObject({ link: 'create', expiresInDays: 90 })
  })

  it('an expiry of 0 or text is clamped to 1 or the default', async () => {
    const api = await open()
    await choose(q<HTMLSelectElement>('[data-bulk-link]')!, 'create')
    await typeInto(q<HTMLInputElement>('[data-bulk-expiry]')!, '0')
    await click(submit())
    expect(plans(api)[0]!.expiresInDays).toBe(1)
  })

  it('all went through, no link: reports once, closes, and the list refetches once', async () => {
    const api = await open()
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'view')
    await click(submit())
    expect(plans(api)).toHaveLength(1)
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(onApplied.mock.calls[0]![0]).toMatchObject({ ok: ['doc_1', 'doc_2'], failed: [] })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a refused document is named with its reason; the others still count', async () => {
    await open({ bulkRefuses: { doc_2: 'forbidden' } })
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'view')
    await click(submit())
    // the dialog stays on the result list until Done
    expect(onClose).not.toHaveBeenCalled()
    const result = q('[data-bulk-result]')!
    expect(result.textContent).toContain(t('shrBulkDone', { ok: 1, total: 2 }))
    // SW-4: a partial failure is a warning banner, never the green success one
    expect(result.querySelector('[role="status"]')!.className).toBe('uw-share-notice warn')
    const lines = qa('[data-bulk-result] [data-bulk-failure]')
    expect(lines.map((l) => l.textContent)).toEqual([
      t('shrBulkErrorLine', { title: 'Doc Two', reason: t('shrBulkErrForbidden') }),
    ])
    expect(onChanged).toHaveBeenCalledTimes(1)
    await click(q('[data-bulk-close]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the result view keeps focus in the dialog (Close) so Esc still closes it', async () => {
    await open({ bulkRefuses: { doc_2: 'forbidden' } })
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'view')
    await click(submit())
    expect(q('[data-bulk-result]')).toBeTruthy()
    expect(document.activeElement).toBe(q('[data-bulk-close]'))
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('names each failure by its own reason (not found, busy, folder, unknown)', async () => {
    await open({
      bulkRefuses: {
        doc_1: 'not_found',
        doc_2: 'server_error',
      },
    })
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'view')
    await click(submit())
    const text = qa('[data-bulk-failure]').map((l) => l.textContent)
    expect(text).toEqual([
      t('shrBulkErrorLine', { title: 'Doc One', reason: t('shrBulkErrNotFound') }),
      t('shrBulkErrorLine', { title: 'Doc Two', reason: t('shrBulkErrFailed') }),
    ])
    expect(qa('[data-bulk-result]')[0]!.textContent).toContain(
      t('shrBulkDone', { ok: 0, total: 2 }),
    )
  })

  it('created links are shown once with a title each and "Copy all" (tab-separated)', async () => {
    const api = await open()
    await choose(q<HTMLSelectElement>('[data-bulk-link]')!, 'create')
    await click(submit())
    expect(plans(api)[0]!.link).toBe('create')
    // the dialog stays open on the links
    expect(onClose).not.toHaveBeenCalled()
    // SW-4: everything worked, so the banner keeps the success tone
    expect(q('[data-bulk-result] [role="status"]')!.className).toBe('uw-share-notice')
    const created = q('[data-bulk-links]')!
    expect(created.textContent).toContain(t('shrBulkLinksCreated'))
    expect(created.textContent).toContain(t('shrLinkUrlOnce'))
    const items = qa('[data-bulk-links] li').map((li) => li.textContent)
    expect(items).toEqual([
      'Doc Onehttps://fake.uniwork.test/p/bulk-doc_1',
      'Doc Twohttps://fake.uniwork.test/p/bulk-doc_2',
    ])
    await click(q('[data-bulk-copy-all]'))
    expect(writeText).toHaveBeenCalledWith(
      'Doc One\thttps://fake.uniwork.test/p/bulk-doc_1\nDoc Two\thttps://fake.uniwork.test/p/bulk-doc_2',
    )
    expect(q('[data-bulk-copy-all]')!.textContent).toContain(t('shrLinkCopied'))
    expect(onChanged).toHaveBeenCalledTimes(1)
    await click(q('[data-bulk-close]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an untitled document reads "Untitled" in the copy-all text', async () => {
    await open({}, [{ id: 'doc_1', workspaceId: 'ws_1', title: '' }])
    await choose(q<HTMLSelectElement>('[data-bulk-link]')!, 'create')
    await click(submit())
    await click(q('[data-bulk-copy-all]'))
    expect(writeText).toHaveBeenCalledWith(
      `${t('shrBulkUntitled')}\thttps://fake.uniwork.test/p/bulk-doc_1`,
    )
  })

  it('a failed copy says so', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true })
    await open()
    await choose(q<HTMLSelectElement>('[data-bulk-link]')!, 'create')
    await click(submit())
    await click(q('[data-bulk-copy-all]'))
    expect(q('[data-bulk-links]')!.textContent).toContain(t('shrBulkCopyFailed'))
  })

  it('the bridge failing outright is one inline error and the dialog stays editable', async () => {
    const api = await open()
    api.failNext('bulk', { ok: false, error: 'network' })
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'view')
    await click(submit())
    expect(q('[role="alert"]')!.textContent).toBe(t('shrSubmitFailed'))
    expect(onClose).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalledTimes(1)
    // a second try goes through
    await click(submit())
    expect(plans(api)).toHaveLength(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a second click while the run is in flight sends nothing more', async () => {
    const api = createFakeShareApi()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = {
      ...api,
      bulk: async (plan: ShareBulkPlan) => {
        await gate
        return api.bulk(plan)
      },
    }
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(BulkShareDialog, {
            open: true,
            docs: DOCS,
            api: slow,
            onClose,
            onChanged,
            onApplied,
          }),
        ),
      )
    })
    await flush()
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'view')
    await click(submit())
    expect(submit()!.getAttribute('aria-busy')).toBe('true')
    expect(submit()!.textContent).toBe(t('shrSubmitting'))
    await click(submit())
    release()
    await flush()
    expect(api.calls.filter((c) => c.method === 'bulk')).toHaveLength(1)
    expect(onApplied).toHaveBeenCalledTimes(1)
  })

  it('Cancel closes without running; Esc closes too', async () => {
    const api = await open()
    await choose(q<HTMLSelectElement>('[data-bulk-workspace]')!, 'view')
    await click(q('[data-bulk-cancel]'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(plans(api)).toEqual([])
    await act(async () => {
      q('[role="dialog"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closed renders nothing', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(BulkShareDialog, {
            open: false,
            docs: DOCS,
            api: createFakeShareApi(),
            onClose,
          }),
        ),
      )
    })
    expect(q('[role="dialog"]')).toBeNull()
  })
})
