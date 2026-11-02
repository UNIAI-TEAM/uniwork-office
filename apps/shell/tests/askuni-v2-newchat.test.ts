// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/askuni/en'
import type { AskUniContext, AskUniFlags } from '../src/shared/askuni-api'

// the v2 panel is tested on its own; here only the Home chat pane around it
vi.mock('../src/renderer/src/askuni-v2/AskUniPanel', async () => {
  const { createElement } = await import('react')
  return {
    AskUniPanel: (props: Record<string, unknown>) =>
      createElement(
        'section',
        { 'data-testid': 'v2-panel', hidden: !props.visible },
        createElement(
          'footer',
          { 'data-slot': 'askuni-composer' },
          createElement('textarea', { 'aria-label': 'composer' }),
        ),
      ),
  }
})
import { NewChatPane } from '../src/renderer/src/NewChatPane'
import { requestAskUniOpen, resetAskUniEntryForTests } from '../src/renderer/src/askuni-entry'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Home chat pane (Ask UNI v2)', () => {
  let host: HTMLDivElement
  let root: Root

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
  }
  async function mount(): Promise<void> {
    await act(async () => {
      root.render(h(LocaleProvider, { initial: 'en', children: h(NewChatPane) }))
    })
    await flush()
  }
  const composer = () => host.querySelector('textarea[aria-label="composer"]')

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    resetAskUniEntryForTests()
    const ctx: AskUniContext = {
      workspaces: [{ id: 'ws-a', name: 'Marketing team' }],
      currentWorkspaceId: 'ws-a',
      signedIn: true,
    }
    ;(window as unknown as { aiOffice: unknown }).aiOffice = new Proxy(
      {
        uniworkAskUni: vi.fn(),
        uniworkAskUniContext: vi.fn(async () => ctx),
        askUniFlags: vi.fn(async (): Promise<AskUniFlags> => ({ streamEnabled: true })),
        setLanguage: async () => null,
      } as Record<string, unknown>,
      { get: (t, p: string) => (p in t ? t[p] : undefined) },
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  it('renders the v2 panel at once, with no mode switch', async () => {
    await mount()
    const panel = host.querySelector('[data-testid="v2-panel"]') as HTMLElement | null
    expect(panel).not.toBeNull()
    expect(panel!.hidden).toBe(false)
    expect(host.querySelector('.askuni-modes')).toBeNull()
    expect(host.querySelector('.new-chat-bar button')).toBeNull()
    expect(host.querySelector('.askuni-pane')).toBeNull()
  })

  it('is titled Ask UNI', async () => {
    await mount()
    expect(host.querySelector('.new-chat-title')?.textContent).toBe(en.askUniTitle)
    expect(host.querySelector('main')?.getAttribute('aria-label')).toBe(en.askUniTitle)
  })

  it('an open request (Ctrl/Cmd+J) puts the caret in the composer', async () => {
    await mount()
    await act(async () => requestAskUniOpen())
    await flush()
    expect(document.activeElement).toBe(composer())
  })

  it('a request made before the pane existed is applied when it mounts', async () => {
    requestAskUniOpen()
    await mount()
    expect(document.activeElement).toBe(composer())
  })

  it('still shows the Ask UNI states when the shell bridge has no Ask UNI', async () => {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = new Proxy({} as Record<string, unknown>, {
      get: (t, p: string) => t[p],
    })
    await mount()
    expect(host.querySelector('.askuni-pane')).not.toBeNull()
    expect(host.querySelector('.askuni-modes')).toBeNull()
  })
})
