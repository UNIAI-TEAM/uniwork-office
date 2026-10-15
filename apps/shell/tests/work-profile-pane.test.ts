/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type { UniworkWorkResult, WorkPerson } from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkProfilePane } from '../src/renderer/src/WorkProfilePane'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = { id: 'w1', name: 'Ops', orgId: 'o1', slug: 'ops', orgSlug: 'acme' }
const PERSON: WorkPerson = {
  user_id: 'u1',
  display_name: 'Lan Nguyen',
  email: 'lan@example.test',
  title: 'Sales lead',
  department: { id: 'd1', name: 'Commercial' },
  manager: { id: 'u0', kind: 'human', display_name: 'Minh Tran' },
  timezone: 'Asia/Ho_Chi_Minh',
}

let host: HTMLDivElement
let root: Root
let api: {
  myProfile: ReturnType<typeof vi.fn>
  openWeb: ReturnType<typeof vi.fn>
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

// the profile cache lives at module level: a test that must start with nothing cached uses its own org
async function mount(workspace: UniworkWorkspaceRef = WS): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WorkProfilePane, {
          workspace,
          workspaceError: null,
          onReload: () => undefined,
          head: { title: 'Profile', summary: 'Your UniWork profile · read-only' },
        }),
      ),
    )
  })
  await flush()
}

const buttonByText = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    myProfile: vi.fn(async (): Promise<UniworkWorkResult<WorkPerson>> => ({
      ok: true,
      value: PERSON,
    })),
    openWeb: vi.fn(async () => true),
  }
  ;(window as unknown as { uniworkWork: unknown }).uniworkWork = api
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Profile tab', () => {
  it('shows the read-only UniWork profile and opens it on the web', async () => {
    await mount()
    const text = host.textContent ?? ''
    for (const v of ['Lan Nguyen', 'Sales lead', 'Commercial', 'Minh Tran', 'Asia/Ho_Chi_Minh']) {
      expect(text).toContain(v)
    }
    expect(host.querySelector('input, textarea')).toBeNull()
    await act(async () => buttonByText('Edit on the web')!.click())
    expect(api.openWeb).toHaveBeenCalledWith({
      kind: 'person',
      orgSlug: 'acme',
      wsSlug: 'ops',
      id: 'u1',
    })
  })

  it('a failed load offers Retry', async () => {
    api.myProfile.mockResolvedValueOnce({ ok: false, error: 'server' })
    await mount({ ...WS, orgId: 'o-fresh' })
    expect(host.textContent).toContain('Couldn’t load')
    await act(async () => buttonByText('Retry')!.click())
    await flush()
    expect(host.textContent).toContain('Lan Nguyen')
  })

  it('toolbar: the read-only summary and a secondary Edit on the web with the external glyph', async () => {
    await mount()
    expect(host.querySelector('.wb-toolbar-text')?.textContent).toBe(
      'Your UniWork profile · read-only',
    )
    const edit = host.querySelector<HTMLButtonElement>('.wb-toolbar-actions button')!
    expect(edit.textContent).toBe('Edit on the web')
    expect(edit.className).toBe('wb-btn wb-btn-secondary')
    expect(edit.querySelector('svg.wb-glyph')).not.toBeNull()
  })

  it('two cards: identity (round avatar, name heading, title, email) and work details as a dl', async () => {
    await mount()
    const grid = host.querySelector('.wb-profile-grid')!
    const [id, work] = Array.from(grid.querySelectorAll(':scope > section.wb-block'))
    expect(id!.getAttribute('aria-label')).toBe('Identity')
    const avatar = id!.querySelector('.wb-profile-avatar')!
    expect(avatar.textContent).toBe('L')
    expect(avatar.getAttribute('aria-hidden')).toBe('true')
    expect(id!.querySelector('h3.wb-profile-name')?.textContent).toBe('Lan Nguyen')
    expect(id!.querySelector('.wb-profile-title')?.textContent).toBe('Sales lead')
    expect(id!.textContent).toContain('lan@example.test')

    expect(work!.querySelector('h3')?.textContent).toBe('Work details')
    const dl = work!.querySelector('dl.wb-profile')!
    expect(Array.from(dl.querySelectorAll('dt')).map((d) => d.textContent)).toEqual([
      'Department',
      'Manager',
      'Email',
      'Time zone',
    ])
    const dd = Array.from(dl.querySelectorAll('dd'))
    expect(dd.map((d) => d.textContent)).toEqual([
      'Commercial',
      'MMinh Tran',
      'lan@example.test',
      'Asia/Ho_Chi_Minh',
    ])
    // the manager gets a small avatar of the same round kind
    expect(dd[1]!.querySelector('.wb-profile-avatar.is-small')?.textContent).toBe('M')
    expect(dl.textContent).not.toContain('Job title')
    expect(work!.querySelector('.wb-profile-foot')?.textContent).toBe(
      'UniAI uses these details to prefill the documents it drafts for you.',
    )
  })

  it('the avatar is round and 64px; the small one 24px', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const rule = (sel: string) => css.split(`\n${sel} {`)[1]?.split('\n}')[0] ?? ''
    expect(rule('.wb-profile-avatar')).toMatch(/width: 64px;[\s\S]*border-radius: 50%;/)
    expect(rule('.wb-profile-avatar.is-small')).toMatch(/width: 24px;/)
    expect(rule('.wb-profile-grid')).toMatch(/grid-template-columns: 340px minmax\(0, 1fr\);/)
  })

  it('loading: the card-shaped skeleton under the toolbar', async () => {
    api.myProfile.mockReturnValueOnce(new Promise(() => undefined))
    await mount({ ...WS, orgId: 'o-loading' })
    expect(host.querySelector('.wb-toolbar')).not.toBeNull()
    expect(host.querySelector('.wb-work-skeleton.is-card .wb-skel-avatar')).not.toBeNull()
  })

  it('a Vietnamese name shows the given-name initial', async () => {
    api.myProfile.mockResolvedValueOnce({
      ok: true,
      value: { ...PERSON, display_name: 'Nguyễn Văn An' },
    })
    await mount({ ...WS, orgId: 'o-vi' })
    expect(host.querySelector('.wb-profile-avatar')?.textContent).toBe('A')
  })
})
