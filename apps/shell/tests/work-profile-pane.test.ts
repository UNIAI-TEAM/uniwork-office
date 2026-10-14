/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
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

  it('a card: initial tile, name, job title as caption, fields in a grid, a secondary web button', async () => {
    await mount()
    expect(host.querySelector('section.wb-block.wb-profile-card')).not.toBeNull()
    expect(host.querySelector('.wb-profile-avatar')?.textContent).toBe('L')
    expect(host.querySelector('.wb-profile-name')?.textContent).toBe('Lan Nguyen')
    expect(host.querySelector('.wb-profile-title')?.textContent).toBe('Sales lead')
    expect(host.querySelector('dl.wb-profile')?.textContent).not.toContain('Job title')
    expect(buttonByText('Edit on the web')!.className).toBe('wb-btn wb-btn-secondary')
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
