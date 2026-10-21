/**
 * @vitest-environment jsdom
 */
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
  ): Promise<FakeShareApi> {
    const api = createFakeShareApi(options)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(ShareDialog, { open: true, onClose, onChanged, row, api }),
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
      api.failNext('candidates', { ok: false, error: 'network' })
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
