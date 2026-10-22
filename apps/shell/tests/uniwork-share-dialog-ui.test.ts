/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { ShareDialog } from '../src/renderer/src/uniwork-share/ShareDialog'
import type { ShareDialogTarget } from '../src/renderer/src/uniwork-share/share-dialog-target'
import {
  createFakeShareApi,
  type FakeShareApi,
  type FakeShareOptions,
} from '../src/renderer/src/uniwork-share/fake-share-api'
import type { UniworkShareApi } from '../src/shared/share-api'
import { uniworkShareStrings } from '../src/renderer/src/i18n/strings-uniwork-share'

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

const target = (partial: Partial<ShareDialogTarget> = {}): ShareDialogTarget => ({
  id: 'doc_1',
  workspaceId: 'ws_1',
  title: 'Q3 plan',
  workspaceName: 'Team',
  organizationName: 'Acme',
  myLevel: 'manage',
  ...partial,
})

describe('ShareDialog (UNI-2047 SD-B)', () => {
  let host: HTMLDivElement
  let root: Root
  let onClose: ReturnType<typeof vi.fn>
  let onChanged: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onClose = vi.fn()
    onChanged = vi.fn()
  })
  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
  })

  async function open(
    options: FakeShareOptions = {},
    row: ShareDialogTarget = target(),
    lang: 'en' | 'vi' = 'en',
    wrap: (fake: FakeShareApi) => UniworkShareApi = (fake) => fake,
    extra: { initialSection?: 'requests' | 'break_glass' } = {},
  ): Promise<FakeShareApi> {
    const api = createFakeShareApi(options)
    const bridge = wrap(api)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(ShareDialog, {
            open: true,
            onClose,
            onChanged,
            row,
            api: bridge,
            ...extra,
          }),
        ),
      )
    })
    await flush()
    return api
  }

  const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E>(sel)
  const qa = (sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel))
  const section = (name: string) => q(`[data-share-section="${name}"]`)
  const button = (scope: ParentNode, label: string) =>
    Array.from(scope.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
    )
  async function click(el: Element | null | undefined) {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
  }
  async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      const set = Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!
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
  const row = (key: string) => q(`[data-share-row="${key}"]`)
  const levelOf = (key: string) => row(key)?.querySelector('select')?.value
  async function pick(name: string) {
    const input = q<HTMLInputElement>('[data-share-section="add"] input[role="combobox"]')!
    await click(input)
    const option = qa('[role="option"]').find((o) => o.textContent?.includes(name))
    await click(option)
  }
  const calls = (api: FakeShareApi, method: string) => api.calls.filter((c) => c.method === method)

  // -------------------------------------------------------------------------------------------

  it('a manager sees every section: header, add, access list, requests, links', async () => {
    const api = await open()
    const dialog = q('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(q('#' + dialog.getAttribute('aria-labelledby'))!.textContent).toBe(
      t('shrTitleNamed', { title: 'Q3 plan' }),
    )
    expect(dialog.textContent).toContain(t('shrStoredIn', { workspace: 'Team' }))
    for (const name of ['add', 'access', 'requests', 'links']) expect(section(name)).toBeTruthy()
    expect(section('break-glass')).toBeNull()

    const access = section('access')!
    expect(access.textContent).toContain(t('shrAclOwner'))
    expect(row('user:u_minh')!.textContent).toContain('Minh Trần')
    expect(row('user:u_an')!.textContent).toContain('An Lê')
    // the home workspace row sits on its own (not repeated among the other workspaces)
    expect(row('home:ws_1')!.textContent).toContain(t('shrHomeBadge'))
    expect(qa('[data-share-row="workspace:ws_1"]')).toHaveLength(0)

    expect(section('links')!.querySelectorAll('[data-link-id]')).toHaveLength(1)
    expect(section('requests')!.textContent).toContain('Dũng Hoàng')
    expect(section('requests')!.textContent).toContain(t('shrReqSectionTitle', { count: 1 }))
    expect(calls(api, 'get').length).toBeGreaterThan(0)
  })

  it('vi copy is the web copy', async () => {
    await open({}, target(), 'vi')
    expect(q('[role="dialog"]')!.textContent).toContain(
      t('shrStoredIn', { workspace: 'Team' }, viText),
    )
    expect(section('links')!.textContent).toContain(t('shrLinksTitle', {}, viText))
  })

  it('a viewer gets the read-only view: own level + source, nothing to change, no extra reads', async () => {
    const api = await open({ myLevel: 'view' }, target({ myLevel: 'view' }))
    expect(section('add')).toBeNull()
    expect(section('links')).toBeNull()
    expect(section('requests')).toBeNull()
    expect(section('break-glass')).toBeNull()
    const access = section('access')!
    expect(access.textContent).toContain(t('shrMyLevel', { level: t('shrLevelView') }))
    expect(access.textContent).toContain(
      t('shrSourceItem', { level: t('shrLevelView'), source: t('shrViaShare') }),
    )
    expect(access.textContent).toContain(t('shrManageOnly'))
    expect(qa('select, input')).toHaveLength(0)
    expect(
      ['update', 'candidates', 'settings', 'requests', 'linkCreate'].flatMap((m) => calls(api, m)),
    ).toEqual([])
  })

  it('invites a person: dry run first, then the write, then the list shows them and the row refreshes', async () => {
    const api = await open()
    await pick('Bình Phạm')
    const chips = qa('[data-share-section="add"] [data-chip]')
    expect(chips.map((c) => c.textContent)).toEqual([expect.stringContaining('Bình Phạm')])
    await click(q('[data-share-submit]'))

    const updates = calls(api, 'update')
    expect(updates).toHaveLength(2)
    expect((updates[0]!.args[0] as { dryRun?: boolean }).dryRun).toBe(true)
    expect((updates[1]!.args[0] as { dryRun?: boolean }).dryRun).toBe(false)
    expect((updates[1]!.args[0] as { items: unknown[] }).items).toEqual([
      expect.objectContaining({ principalType: 'user', principalId: 'u_binh', level: 'view' }),
    ])
    expect(row('user:u_binh')).toBeTruthy()
    expect(qa('[data-share-section="add"] [data-chip]')).toHaveLength(0)
    expect(onChanged).toHaveBeenCalled()
  })

  it('the level select applies to the invite and custom levels override per person', async () => {
    const api = await open()
    await pick('Bình Phạm')
    await pick('Chi Võ')
    await choose(q<HTMLSelectElement>('[data-common-level]')!, 'edit')
    await click(button(host, t('shrCustomLevelsToggle')))
    const chiLevel = q<HTMLSelectElement>(`[aria-label="${t('shrLevelFor', { name: 'Chi Võ' })}"]`)!
    await choose(chiLevel, 'comment')
    await click(q('[data-share-submit]'))
    const items = (
      calls(api, 'update').at(-1)!.args[0] as { items: { principalId: string; level: string }[] }
    ).items
    expect(items.find((i) => i.principalId === 'u_binh')!.level).toBe('edit')
    expect(items.find((i) => i.principalId === 'u_chi')!.level).toBe('comment')
  })

  it('searching asks the server for the typed text', async () => {
    vi.useFakeTimers()
    const api = await open()
    const input = q<HTMLInputElement>('[data-share-section="add"] input[role="combobox"]')!
    await typeInto(input, 'chi')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()
    const searched = calls(api, 'candidates').map((c) => (c.args[0] as { q?: string }).q)
    expect(searched).toContain('chi')
    const names = qa('[role="option"]').map((o) => o.textContent)
    expect(names.some((n) => n?.includes('Chi Võ'))).toBe(true)
    expect(names.some((n) => n?.includes('An Lê'))).toBe(false)
  })

  it('a wide-scope invite waits for the confirm sentence; Cancel writes nothing, Accept writes', async () => {
    const api = await open()
    await pick('Acme')
    await click(q('[data-share-submit]'))
    const confirm = q('[data-testid="share-add-confirm"]')!
    expect(confirm.textContent).toContain('Acme')
    expect(confirm.textContent).toContain('40')
    expect(
      calls(api, 'update').filter((c) => (c.args[0] as { dryRun?: boolean }).dryRun === false),
    ).toHaveLength(0)

    await click(button(confirm, t('shrConfirmCancel')))
    expect(q('[data-testid="share-add-confirm"]')).toBeNull()
    expect(
      calls(api, 'update').filter((c) => (c.args[0] as { dryRun?: boolean }).dryRun === false),
    ).toHaveLength(0)

    await click(q('[data-share-submit]'))
    await click(button(q('[data-testid="share-add-confirm"]')!, t('shrConfirmAccept')))
    expect(row('organization:org_1')).toBeTruthy()
  })

  it('raising a level writes after a dry run; lowering it asks first', async () => {
    const api = await open()
    // An: comment -> edit (a raise, no warning)
    await choose(
      q<HTMLSelectElement>(`[aria-label="${t('shrLevelFor', { name: 'An Lê' })}"]`)!,
      'edit',
    )
    expect(levelOf('user:u_an')).toBe('edit')
    expect(onChanged).toHaveBeenCalledTimes(1)

    // Minh: edit -> view (a downgrade warning)
    await choose(
      q<HTMLSelectElement>(`[aria-label="${t('shrLevelFor', { name: 'Minh Trần' })}"]`)!,
      'view',
    )
    const confirm = q('[data-testid="share-access-confirm"]')!
    expect(confirm).toBeTruthy()
    expect(row('user:u_minh')!.contains(confirm)).toBe(true)
    const before = calls(api, 'update').length
    await click(button(confirm, t('shrConfirmAccept')))
    expect(calls(api, 'update').length).toBe(before + 1)
    expect(levelOf('user:u_minh')).toBe('view')
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('removing a person confirms with the sentence, then drops the row', async () => {
    const api = await open()
    await click(button(host, `${t('shrRevoke')} Minh Trần`))
    const confirm = q('[data-testid="share-access-confirm"]')!
    expect(confirm.textContent).toContain(t('shrRevokeConfirmLose', { name: 'Minh Trần' }))
    await click(button(confirm, t('shrConfirmAccept')))
    expect(row('user:u_minh')).toBeNull()
    const last = calls(api, 'update').at(-1)!.args[0] as {
      items: { level: null }[]
      dryRun: boolean
    }
    expect(last.dryRun).toBe(false)
    expect(last.items[0]!.level).toBeNull()
    expect(onChanged).toHaveBeenCalled()
  })

  it('creates a link with an expiry, shows the URL once, copies it, then revokes the old link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const api = await open()
    const links = section('links')!
    const expiry = links.querySelector<HTMLInputElement>('input[type="number"]')!
    expect(expiry.value).toBe('7')
    await typeInto(expiry, '30')
    await click(button(links, t('shrLinkCreate')))
    expect((calls(api, 'linkCreate')[0]!.args[0] as { expiresInDays: number }).expiresInDays).toBe(
      30,
    )
    const url = q('[data-testid="share-created-url"]')!.textContent!
    expect(url).toContain('https://fake.uniwork.test/p/')
    expect(links.textContent).toContain(t('shrLinkUrlOnce'))
    expect(links.querySelectorAll('[data-link-id]')).toHaveLength(2)

    await click(button(links, t('shrLinkCopy')))
    expect(writeText).toHaveBeenCalledWith(url)
    expect(button(links, t('shrLinkCopied'))).toBeTruthy()

    await click(links.querySelector('[data-link-id="ln_1"] button'))
    expect(links.querySelector('[data-link-id="ln_1"]')).toBeNull()
    expect(calls(api, 'linkRevoke')[0]!.args[0]).toEqual({ documentId: 'doc_1', linkId: 'ln_1' })
  })

  it('shows the org public-link policy line read only (no switch in the app)', async () => {
    await open()
    expect(section('links')!.textContent).toContain(t('shrLinksPolicyEnabled'))
    await act(async () => root.unmount())
    root = createRoot(host)
    await open({ publicLinksEnabled: false })
    const links = section('links')!
    expect(links.textContent).toContain(t('shrLinksPolicyDisabled'))
    // an org switch is the web settings' job: there is no button to open it here
    expect(links.querySelectorAll('button')).toHaveLength(2) // create + revoke of the one link
  })

  it('link refusals use the web copy: limit and switched off', async () => {
    await open({ maxLinks: 1 })
    await click(button(section('links')!, t('shrLinkCreate')))
    expect(section('links')!.querySelector('[role="alert"]')!.textContent).toContain(
      t('shrLinkLimit'),
    )
    await act(async () => root.unmount())
    root = createRoot(host)
    await open({ publicLinksEnabled: false })
    await click(button(section('links')!, t('shrLinkCreate')))
    const alert = section('links')!.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain(t('shrLinksOff'))
  })

  it('approves an access request with the chosen level, then the row is gone', async () => {
    const api = await open()
    const req = q('[data-request-id="rq_1"]')!
    expect(req.textContent).toContain('Em cần sửa phần số liệu.')
    await choose(req.querySelector('select')!, 'view')
    await click(button(req, t('shrReqApprove')))
    expect(calls(api, 'requestApprove')[0]!.args[0]).toEqual({
      documentId: 'doc_1',
      requestId: 'rq_1',
      level: 'view',
    })
    expect(q('[data-request-id="rq_1"]')).toBeNull()
    expect(section('requests')!.textContent).toContain(
      t('shrReqApproved', { name: 'Dũng Hoàng', level: t('shrLevelView') }),
    )
    // the approval created a grant: the list is refetched and shows them
    expect(row('user:u_req')).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('declines an access request', async () => {
    const api = await open()
    await click(button(q('[data-request-id="rq_1"]')!, t('shrReqDecline')))
    expect(calls(api, 'requestDecline')).toHaveLength(1)
    expect(section('requests')!.textContent).toContain(t('shrReqDeclined', { name: 'Dũng Hoàng' }))
  })

  it('a request somebody else already handled says so and reloads', async () => {
    const api = await open()
    api.failNext('requestApprove', { ok: false, error: 'access_request_closed', status: 409 })
    await click(button(q('[data-request-id="rq_1"]')!, t('shrReqApprove')))
    expect(section('requests')!.textContent).toContain(t('shrReqClosed'))
  })

  it('requests are hidden on an archived document and when the server has no such route', async () => {
    await open({}, target({ archived: true }))
    expect(section('requests')).toBeNull()
    await act(async () => root.unmount())
    root = createRoot(host)
    await open({ requestsAvailable: false })
    expect(section('requests')).toBeNull()
  })

  it('break-glass shows only for an administering admin (adminScope), with the admin note', async () => {
    await open({ adminScope: true, myLevel: '' }, target({ myLevel: undefined, adminScope: true }))
    const bg = section('break-glass')!
    expect(bg).toBeTruthy()
    expect(bg.textContent).toContain(t('shrBgNoActiveGrants'))
    expect(q('[role="dialog"]')!.textContent).toContain(t('shrAdminScopeNote'))
    await act(async () => root.unmount())
    root = createRoot(host)
    await open()
    expect(section('break-glass')).toBeNull()
    expect(q('[role="dialog"]')!.textContent).not.toContain(t('shrAdminScopeNote'))
  })

  describe('initialSection (a notice sends the person to one section)', () => {
    it('requests: the requests heading takes focus and scrolls into view', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      await open({}, target(), 'en', (fake) => fake, { initialSection: 'requests' })
      const heading = section('requests')!.querySelector('h3')!
      expect(document.activeElement).toBe(heading)
      expect(scroll).toHaveBeenCalled()
    })

    it('break_glass: the emergency access heading takes focus and scrolls into view', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      await open(
        { adminScope: true, myLevel: '' },
        target({ myLevel: undefined, adminScope: true }),
        'en',
        (fake) => fake,
        { initialSection: 'break_glass' },
      )
      const heading = section('break-glass')!.querySelector('h3')!
      expect(document.activeElement).toBe(heading)
      expect(scroll).toHaveBeenCalled()
    })

    it('without a section the search box keeps the first focus, as before', async () => {
      await open()
      expect(document.activeElement).toBe(q('[data-share-section="add"] input'))
    })

    it('a viewer who cannot manage just sees the read-only list (no section to focus)', async () => {
      await open({ myLevel: 'view' }, target({ myLevel: 'view' }), 'en', (fake) => fake, {
        initialSection: 'requests',
      })
      expect(section('requests')).toBeNull()
      expect(q('[role="dialog"]')).toBeTruthy()
    })
  })

  it('a shelved document says so and only lets access be taken away', async () => {
    const api = await open({}, target({ shelvedAt: '2026-10-01T00:00:00Z' }))
    expect(q('[role="dialog"]')!.textContent).toContain(t('shrShelvedNote'))
    await pick('Bình Phạm').catch(() => undefined)
    expect(qa('[data-share-section="add"] [data-chip]')).toHaveLength(0)
    const create = button(section('links')!, t('shrLinkCreate'))!
    expect(create.getAttribute('aria-disabled')).toBe('true')
    await click(create)
    expect(calls(api, 'linkCreate')).toHaveLength(0)
  })

  describe('row layout (SD-FIX2 SD-01)', () => {
    // `.uw-share-row-main` carries `flex: 1 1 160px`; inside a column container that basis is a
    // HEIGHT, which made every access and link row ~193px tall. The title line inside a column
    // (.stacked / .uw-share-row-text) is `.uw-share-row-head`, which has no flex basis.
    it('no title line inside a column container carries the flex-basis class', async () => {
      await open()
      const dialog = q('[role="dialog"]')!
      expect(dialog.querySelectorAll('.uw-share-row-main .uw-share-row-main')).toHaveLength(0)
      expect(dialog.querySelectorAll('.uw-share-row-text .uw-share-row-main')).toHaveLength(0)
      expect(row('home:ws_1')!.querySelector('.uw-share-row-head')).not.toBeNull()
      expect(row('user:u_minh')!.querySelector('.uw-share-row-head')).not.toBeNull()
      expect(section('links')!.querySelector('[data-link-id] .uw-share-row-head')).not.toBeNull()
    })

    // SW-3: the modal scrolls as a whole, so the header (title + Close) must stay pinned
    it('the dialog header is sticky on the surface so Close stays visible while scrolling', () => {
      const css = readFileSync(
        join(__dirname, '../src/renderer/src/uniwork-share/share-dialog.css'),
        'utf8',
      )
      const rule = css.match(/(?:^|\n)\.uw-share-header\s*\{([^}]*)\}/)?.[1]
      expect(rule).toMatch(/position:\s*sticky/)
      expect(rule).toMatch(/top:\s*-20px/)
      expect(rule).toMatch(/background:\s*var\(--surface\)/)
      const modal = css.match(/(?:^|\n)\.modal\.uw-act\.uw-share\s*\{([^}]*)\}/)?.[1]
      expect(modal).toMatch(/overflow-y:\s*auto/)
    })

    it('the head class has no flex basis and the basis class stays off column children', () => {
      const css = readFileSync(
        join(__dirname, '../src/renderer/src/uniwork-share/share-dialog.css'),
        'utf8',
      )
      const rule = (selector: string) =>
        css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1]
      expect(rule('.uw-share-row-head')).toBeDefined()
      expect(rule('.uw-share-row-head')).not.toMatch(/flex\s*:/)
      expect(rule('.uw-share-row-main')).toMatch(/flex:\s*1 1 160px/)
    })

    // SD2-01: `.uw-share-row` wraps and `.stacked` only flips it to a column; a wrapping column
    // container sized its row-line child at the two-line height (~35 px dead space per row).
    it('the stacked row is a non-wrapping column', () => {
      const css = readFileSync(
        join(__dirname, '../src/renderer/src/uniwork-share/share-dialog.css'),
        'utf8',
      )
      const rule = css.match(/(?:^|\n)\.uw-share-row\.stacked\s*\{([^}]*)\}/)?.[1]
      expect(rule).toMatch(/flex-direction:\s*column/)
      expect(rule).toMatch(/flex-wrap:\s*nowrap/)
    })
  })

  describe('review fixes (SD-FIX1)', () => {
    /** a bridge whose listed methods reject, as `ipcRenderer.invoke` does on a stale preload */
    const rejecting =
      (...methods: (keyof UniworkShareApi)[]) =>
      (fake: FakeShareApi): UniworkShareApi =>
        new Proxy(fake, {
          get(target, prop, receiver) {
            if (methods.includes(prop as keyof UniworkShareApi)) {
              return () => Promise.reject(new Error('invoke failed'))
            }
            return Reflect.get(target, prop, receiver)
          },
        })

    it('#1 a rejected dry run leaves the Share button usable and says it failed', async () => {
      await open({}, target(), 'en', rejecting('update'))
      await pick('Bình Phạm')
      const submit = q<HTMLButtonElement>('[data-share-submit]')!
      await click(submit)
      expect(submit.getAttribute('aria-busy')).toBeNull()
      expect(submit.textContent).toBe(t('shrSubmit'))
      expect(section('add')!.querySelector('[role="alert"]')).toBeTruthy()
    })

    it('#1 a rejected row change shows the error instead of an unhandled rejection', async () => {
      await open({}, target(), 'en', rejecting('update'))
      await choose(
        q<HTMLSelectElement>(`[aria-label="${t('shrLevelFor', { name: 'An Lê' })}"]`)!,
        'edit',
      )
      expect(section('access')!.querySelector('[role="alert"]')).toBeTruthy()
      expect(onChanged).not.toHaveBeenCalled()
    })

    it('#1 a rejected link create and request decision release the section', async () => {
      await open({}, target(), 'en', rejecting('linkCreate', 'requestApprove'))
      const links = section('links')!
      const create = button(links, t('shrLinkCreate'))!
      await click(create)
      expect(links.textContent).toContain(t('shrLinkCreateFailed'))
      expect(create.hasAttribute('disabled') || create.getAttribute('aria-busy') === 'true').toBe(
        false,
      )
      const req = q('[data-request-id="rq_1"]')!
      await click(button(req, t('shrReqApprove')))
      expect(section('requests')!.textContent).toContain(t('shrReqDecisionFailed'))
      expect(q('[data-request-id="rq_1"]')).toBeTruthy()
    })

    it('#2 Manage then a group-only pick keeps Manage in the select and shows the capped hint', async () => {
      await open()
      const select = q<HTMLSelectElement>('[data-common-level]')!
      await choose(select, 'manage')
      await pick('Acme')
      expect(select.value).toBe('manage')
      expect(Array.from(select.options).map((o) => o.value)).toContain('manage')
      expect(section('add')!.textContent).toContain(t('shrLevelManageCappedHint'))
    })

    it('#2 a group-only pick without Manage chosen still hides Manage', async () => {
      await open()
      await pick('Acme')
      const select = q<HTMLSelectElement>('[data-common-level]')!
      expect(Array.from(select.options).map((o) => o.value)).toEqual(['view', 'comment', 'edit'])
    })

    it('#3 the picker asks the server again after a write, so a new grant shows as having access', async () => {
      const api = await open()
      await pick('Bình Phạm')
      const before = calls(api, 'candidates').length
      await click(q('[data-share-submit]'))
      expect(row('user:u_binh')).toBeTruthy()
      expect(calls(api, 'candidates').length).toBeGreaterThan(before)
      const input = q<HTMLInputElement>('[data-share-section="add"] input[role="combobox"]')!
      await click(input)
      await flush()
      const option = qa('[role="option"]').find((o) => o.textContent?.includes('Bình Phạm'))
      expect(option?.textContent).toContain(
        t('shrCandidateHasAccess', { level: t('shrLevelView') }),
      )
    })

    it('#9 a source from an unknown workspace falls back to "workspace member", not the unknown-name line', async () => {
      await open({ myLevel: 'edit' }, target({ myLevel: 'edit' }), 'en', (fake) => {
        const real = fake.get
        fake.get = async (documentId) => {
          const result = await real(documentId)
          if (!result.ok) return result
          return {
            ok: true,
            value: {
              ...result.value,
              mySources: [
                { via: 'member', level: 'edit', principalType: 'workspace', principalId: 'ws_x' },
              ],
            },
          }
        }
        return fake
      })
      const text = section('access')!.textContent!
      expect(text).toContain(
        t('shrSourceItem', { level: t('shrLevelEdit'), source: t('shrViaMember') }),
      )
      expect(text).not.toContain(t('shrWorkspaceUnknown'))
    })
  })

  describe('names come from the organization member list', () => {
    it('resolves the owner and every grant by the members call; no candidate read before the picker opens', async () => {
      const api = await open()
      expect(calls(api, 'members').length).toBeGreaterThan(0)
      expect(calls(api, 'candidates')).toEqual([])
      expect(row('owner:u_owner')!.textContent).toContain('Hoa Nguyễn')
      expect(row('user:u_minh')!.textContent).toContain('Minh Trần')
    })

    it('walks every page (the last has no cursor) and keeps a skeleton, not "unknown", while pages are pending', async () => {
      const api = createFakeShareApi()
      const real = api.members
      let first = true
      api.members = (input) => {
        // two pages of three, whatever the caller asks for
        const page = first ? { limit: 3 } : { cursor: input.cursor, limit: 3 }
        first = false
        return real(page)
      }
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(ShareDialog, { open: true, onClose, row: target(), api }),
          ),
        )
      })
      await flush()
      expect(calls(api, 'members').length).toBeGreaterThan(1)
      expect(row('user:u_minh')!.textContent).toContain('Minh Trần')
      expect(row('user:u_an')!.textContent).toContain('An Lê')
    })

    it('someone who is not a member any more reads as an unknown member once the walk is done', async () => {
      const api = createFakeShareApi()
      const real = api.members
      api.members = async (input) => {
        const result = await real(input)
        return result.ok
          ? {
              ok: true,
              value: {
                ...result.value,
                members: result.value.members.filter((m) => m.userId !== 'u_an'),
              },
            }
          : result
      }
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(ShareDialog, { open: true, onClose, row: target(), api }),
          ),
        )
      })
      await flush()
      expect(row('user:u_an')!.textContent).toContain(t('shrPersonUnknown'))
    })

    it('a failed later page keeps the names read so far and shows the partial line with Retry', async () => {
      const api = createFakeShareApi()
      const real = api.members
      let n = 0
      api.members = (input) => {
        n++
        if (n === 2) return Promise.resolve({ ok: false, error: 'network' } as const)
        return real({ ...input, limit: 3 })
      }
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(ShareDialog, { open: true, onClose, row: target(), api }),
          ),
        )
      })
      await flush()
      const line = q('[data-share-members-error]')!
      expect(line.textContent).toContain(t('shrMembersErrorPartial'))
      await click(button(line, t('shrRetry')))
      expect(q('[data-share-members-error]')).toBeNull()
    })
  })

  describe('emergency access (break-glass)', () => {
    const REASON = 'Audit of the Q3 numbers'
    const openAdmin = () =>
      open({ adminScope: true, myLevel: '' }, target({ myLevel: undefined, adminScope: true }))
    const reasonBox = () => q<HTMLTextAreaElement>('[data-share-section="break-glass"] textarea')

    it('an administering admin gets the reason form; a manager and a viewer do not', async () => {
      await openAdmin()
      const bg = section('break-glass')!
      expect(bg.querySelector('textarea')).toBeTruthy()
      expect(bg.textContent).toContain(t('shrBgReasonHint'))
      expect(bg.textContent).toContain(t('shrBgReasonCounter', { count: 0 }))
      await act(async () => root.unmount())
      root = createRoot(host)
      await open()
      expect(section('break-glass')).toBeNull()
    })

    it('grants after a valid reason, trims it, lists the grant and counts characters live', async () => {
      const api = await openAdmin()
      await typeInto(reasonBox()!, `  ${REASON}  `)
      expect(section('break-glass')!.textContent).toContain(
        t('shrBgReasonCounter', { count: REASON.length }),
      )
      await click(button(section('break-glass')!, t('shrBgConfirmButton')))
      expect(calls(api, 'breakGlassGrant')[0]!.args[0]).toEqual({
        documentId: 'doc_1',
        reason: REASON,
      })
      const rows = qa('[data-break-glass-id]')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.textContent).toContain(REASON)
      expect(section('break-glass')!.textContent).not.toContain(t('shrBgNoActiveGrants'))
      expect(reasonBox()!.value).toBe('')
      expect(onChanged).toHaveBeenCalled()
    })

    it('a reason that is too short or too long is refused in place, nothing is sent', async () => {
      const api = await openAdmin()
      await typeInto(reasonBox()!, 'too short')
      expect(section('break-glass')!.textContent).toContain(t('shrBgReasonTooShort'))
      await click(button(section('break-glass')!, t('shrBgConfirmButton')))
      expect(calls(api, 'breakGlassGrant')).toEqual([])
      await typeInto(reasonBox()!, 'x'.repeat(501))
      expect(section('break-glass')!.textContent).toContain(t('shrBgReasonTooLong'))
      await click(button(section('break-glass')!, t('shrBgConfirmButton')))
      expect(calls(api, 'breakGlassGrant')).toEqual([])
    })

    it('the server verdict reason_invalid reads too short / too long by the typed length; other failures read the generic line', async () => {
      const api = await openAdmin()
      await typeInto(reasonBox()!, REASON)
      api.failNext('breakGlassGrant', {
        ok: false,
        error: 'break_glass_reason_invalid',
        status: 422,
      })
      await click(button(section('break-glass')!, t('shrBgConfirmButton')))
      expect(section('break-glass')!.querySelector('[role="alert"]')!.textContent).toBe(
        t('shrBgReasonTooShort'),
      )
      api.failNext('breakGlassGrant', { ok: false, error: 'network' })
      await click(button(section('break-glass')!, t('shrBgConfirmButton')))
      expect(section('break-glass')!.querySelector('[role="alert"]')!.textContent).toBe(
        t('shrBgSubmitFailed'),
      )
      // the reason stays so the admin can retry
      expect(reasonBox()!.value).toBe(REASON)
    })

    it('Revoke ends one grant by its id and the list refreshes; a failure says so and keeps it', async () => {
      const api = await openAdmin()
      await typeInto(reasonBox()!, REASON)
      await click(button(section('break-glass')!, t('shrBgConfirmButton')))
      const id = qa('[data-break-glass-id]')[0]!.getAttribute('data-break-glass-id')!

      api.failNext('breakGlassRevoke', { ok: false, error: 'network' })
      await click(button(section('break-glass')!, t('shrBgRevokeButton')))
      expect(section('break-glass')!.querySelector('[role="alert"]')!.textContent).toBe(
        t('shrBgRevokeFailed'),
      )
      expect(qa('[data-break-glass-id]')).toHaveLength(1)

      await click(button(section('break-glass')!, t('shrBgRevokeButton')))
      expect(calls(api, 'breakGlassRevoke').at(-1)!.args[0]).toEqual({
        documentId: 'doc_1',
        grantId: id,
      })
      expect(qa('[data-break-glass-id]')).toHaveLength(0)
      expect(section('break-glass')!.textContent).toContain(t('shrBgNoActiveGrants'))
    })

    it('the revoke button names the person it ends', async () => {
      await openAdmin()
      await typeInto(reasonBox()!, REASON)
      await click(button(section('break-glass')!, t('shrBgConfirmButton')))
      const revoke = section('break-glass')!.querySelector<HTMLElement>(
        '[data-break-glass-id] button',
      )!
      expect(revoke.getAttribute('aria-label')).toContain(t('shrBgRevokeButton'))
      expect(revoke.getAttribute('aria-label')!.length).toBeGreaterThan(
        t('shrBgRevokeButton').length,
      )
    })
  })

  describe('error copy per code', () => {
    it('rejected items name the person and the reason on the chip', async () => {
      const api = await open()
      await pick('Bình Phạm')
      api.failNext('update', {
        ok: false,
        error: 'document_access_rejected',
        status: 422,
        rejected: [
          {
            index: 0,
            principalType: 'user',
            principalId: 'u_binh',
            code: 'principal_not_in_organization',
          },
        ],
      })
      await click(q('[data-share-submit]'))
      expect(q('[data-share-section="add"] [role="alert"]')!.textContent).toBe(
        `Bình Phạm: ${t('shrRejectedNotInOrg')}`,
      )
      expect(q('[data-rejected-reason="u_binh"]')!.textContent).toBe(t('shrRejectedNotInOrg'))
      // the chip stays so the person can fix the list
      expect(qa('[data-share-section="add"] [data-chip]')).toHaveLength(1)
    })

    it.each([
      ['document_shelved', 'shrShelvedBlocked'],
      ['my_folder_locked', 'shrErrMyFolderLocked'],
      ['break_glass_required', 'shrBgSelfShareError'],
      ['forbidden', 'shrSubmitFailed'],
      ['network', 'shrSubmitFailed'],
    ] as const)('an invite refused with %s reads %s', async (error, key) => {
      const api = await open()
      await pick('Bình Phạm')
      api.failNext('update', { ok: false, error })
      await click(q('[data-share-submit]'))
      expect(q('[data-share-section="add"] [role="alert"]')!.textContent).toBe(t(key))
    })

    it('a row change refused reads the same copy in the access list', async () => {
      const api = await open()
      api.failNext('update', { ok: false, error: 'my_folder_locked' })
      await choose(
        q<HTMLSelectElement>(`[aria-label="${t('shrLevelFor', { name: 'An Lê' })}"]`)!,
        'edit',
      )
      expect(section('access')!.querySelector('[role="alert"]')!.textContent).toBe(
        t('shrErrMyFolderLocked'),
      )
      expect(levelOf('user:u_an')).toBe('comment')
    })

    it('a failed overview shows the error with Retry that loads it again', async () => {
      const api = createFakeShareApi()
      api.failNext('get', { ok: false, error: 'network' })
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(ShareDialog, { open: true, onClose, row: target(), api }),
          ),
        )
      })
      await flush()
      expect(q('[role="dialog"]')!.textContent).toContain(t('shrError'))
      expect(section('access')).toBeNull()
      await click(button(host, t('shrRetry')))
      expect(section('access')).toBeTruthy()
    })

    it('the member directory failing shows the one line with Retry, the dialog keeps working', async () => {
      const api = createFakeShareApi()
      api.failNext('members', { ok: false, error: 'network' })
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(ShareDialog, { open: true, onClose, row: target(), api }),
          ),
        )
      })
      await flush()
      expect(q('[data-share-members-error]')!.textContent).toContain(t('shrMembersErrorFirst'))
      expect(section('access')).toBeTruthy()
      await click(button(q('[data-share-members-error]')!, t('shrRetry')))
      expect(q('[data-share-members-error]')).toBeNull()
      expect(row('user:u_minh')!.textContent).toContain('Minh Trần')
    })
  })

  describe('modal behaviour', () => {
    it('Escape closes it', async () => {
      await open()
      await act(async () => {
        q('[role="dialog"]')!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        )
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('Tab from the last control wraps to the first (focus trap)', async () => {
      await open()
      const dialog = q('[role="dialog"]')!
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]',
        ),
      )
      const first = focusables[0]!
      const last = focusables.at(-1)!
      last.focus()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      await act(async () => {
        last.dispatchEvent(tab)
      })
      expect(tab.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(first)
    })

    it('renders nothing while closed', async () => {
      const api = createFakeShareApi()
      await act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(ShareDialog, { open: false, onClose, row: target(), api }),
          ),
        )
      })
      expect(q('[role="dialog"]')).toBeNull()
      expect(api.calls).toHaveLength(0)
    })
  })
})
