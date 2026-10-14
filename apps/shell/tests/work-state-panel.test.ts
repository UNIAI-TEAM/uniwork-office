/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  WorkErrorState,
  WorkNoWorkspace,
  WorkStatePanel,
  workLoadState,
} from '../src/renderer/src/WorkErrorState'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

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

async function render(node: ReactElement): Promise<void> {
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, node))
  })
}

const panel = () => host.querySelector<HTMLElement>('.wb-state')!
const tile = () => host.querySelector<HTMLElement>('.wb-state-icon')!
const button = () => host.querySelector<HTMLButtonElement>('.wb-state button')

describe('WorkStatePanel', () => {
  it('shows a tinted tile, the title, one line and one primary action', async () => {
    const onClick = vi.fn()
    await render(
      createElement(WorkStatePanel, {
        tone: 'green',
        icon: createElement('svg'),
        title: 'No open tasks.',
        body: 'Add one above.',
        action: { label: 'Add task', onClick },
        role: 'status',
      }),
    )
    expect(panel().getAttribute('role')).toBe('status')
    expect(tile().style.background).toBe('var(--tint-green)')
    expect(tile().getAttribute('aria-hidden')).toBe('true')
    expect(tile().querySelector('svg')).not.toBeNull()
    expect(panel().querySelector('h3.wb-state-title')?.textContent).toBe('No open tasks.')
    expect(panel().querySelector('p.wb-state-body')?.textContent).toBe('Add one above.')
    expect(panel().querySelectorAll('button')).toHaveLength(1)
    expect(button()!.className).toBe('wb-btn wb-btn-primary')
    await act(async () => button()!.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('paints a signal tone from the signal tokens and leaves out what it is not given', async () => {
    await render(
      createElement(WorkStatePanel, { tone: 'danger', icon: null, title: 'Couldn’t load' }),
    )
    expect(tile().style.background).toBe('var(--danger-bg)')
    expect(tile().style.color).toBe('var(--danger-text)')
    expect(panel().hasAttribute('role')).toBe(false)
    expect(host.querySelector('.wb-state-body')).toBeNull()
    expect(button()).toBeNull()
  })

  it('a secondary action gets the secondary button', async () => {
    await render(
      createElement(WorkStatePanel, {
        tone: 'gray',
        icon: null,
        title: 'All clear',
        action: { label: 'Compose', onClick: () => undefined, variant: 'secondary' },
      }),
    )
    expect(button()!.className).toBe('wb-btn wb-btn-secondary')
  })
})

describe('WorkErrorState and WorkNoWorkspace render through the panel', () => {
  it('server: an alert with a danger tile and a Retry that calls back', async () => {
    const onRetry = vi.fn()
    await render(createElement(WorkErrorState, { state: 'server', onRetry }))
    expect(panel().getAttribute('role')).toBe('alert')
    expect(tile().style.background).toBe('var(--danger-bg)')
    expect(panel().textContent).toContain('Couldn’t load')
    expect(button()!.textContent).toBe('Retry')
    await act(async () => button()!.click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.wb-work-state')).toBeNull()
  })

  it('offline warns with Retry; lost access warns with no action', async () => {
    await render(createElement(WorkErrorState, { state: 'offline', onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('alert')
    expect(tile().style.background).toBe('var(--warning-bg)')
    expect(panel().textContent).toContain('Couldn’t reach UniWork')
    expect(button()!.textContent).toBe('Retry')
    await render(createElement(WorkErrorState, { state: 'forbidden', onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('alert')
    expect(tile().style.background).toBe('var(--warning-bg)')
    expect(panel().textContent).toContain('You no longer have access to this workspace')
    expect(button()).toBeNull()
  })

  it('signed out: a status with an info tile whose button signs in', async () => {
    const accountLogin = vi.fn(async () => true)
    ;(window as unknown as { aiOffice: unknown }).aiOffice = { accountLogin }
    await render(createElement(WorkErrorState, { state: 'signed-out', onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('status')
    expect(tile().style.background).toBe('var(--info-bg)')
    expect(button()!.textContent).toBe('Sign in to UniWork')
    await act(async () => button()!.click())
    expect(accountLogin).toHaveBeenCalledTimes(1)
  })

  it('no workspace: a status that opens web onboarding; with an error it shows that error', async () => {
    const openWeb = vi.fn(async () => true)
    ;(window as unknown as { uniworkWork: unknown }).uniworkWork = { openWeb }
    await render(createElement(WorkNoWorkspace, { error: null, onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('status')
    expect(tile().style.background).toBe('var(--info-bg)')
    expect(panel().textContent).toContain('You are not in a workspace yet')
    expect(button()!.textContent).toBe('Set up on the web')
    await act(async () => button()!.click())
    expect(openWeb).toHaveBeenCalledWith({ kind: 'onboarding' })
    await render(createElement(WorkNoWorkspace, { error: 'offline', onRetry: () => undefined }))
    expect(panel().getAttribute('role')).toBe('alert')
  })
})

describe('workLoadState', () => {
  it('loading: three shimmer rows inside the kept .wb-work-skeleton wrapper', async () => {
    await render(workLoadState({ value: null, error: null, reload: () => undefined })!)
    const skeleton = host.querySelector('.wb-work-skeleton')!
    expect(skeleton.getAttribute('aria-busy')).toBe('true')
    expect(skeleton.querySelectorAll('.wb-skel.wb-skel-row')).toHaveLength(3)
  })

  it('with data: nothing in the way', () => {
    expect(workLoadState({ value: [], error: null, reload: () => undefined })).toBeNull()
  })
})
