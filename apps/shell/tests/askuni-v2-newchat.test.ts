// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/askuni/en'
import type { AskUniContext, AskUniFlags } from '../src/shared/askuni-api'

// the v2 panel is tested on its own; here only the My AI wiring around it
vi.mock('../src/renderer/src/askuni-v2/AskUniPanel', async () => {
  const { createElement } = await import('react')
  return {
    AskUniPanel: (props: Record<string, unknown>) =>
      createElement(
        'section',
        { 'data-testid': 'v2-panel', hidden: !props.visible },
        createElement('textarea', { 'aria-label': 'composer' }),
      ),
  }
})
import { NewChatPane } from '../src/renderer/src/NewChatPane'
import { requestAskUniOpen, resetAskUniEntryForTests } from '../src/renderer/src/askuni-entry'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('My AI pane with the Ask UNI v2 flag', () => {
  let host: HTMLDivElement
  let root: Root
  let flags: ReturnType<typeof vi.fn<() => Promise<AskUniFlags>>>

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
  }
  async function mount(): Promise<void> {
    await act(async () => {
      root.render(
        h(LocaleProvider, {
          initial: 'en',
          children: h(NewChatPane, {
            practiceId: 'general' as never,
            ensureWorkbench: () => undefined,
          }),
        }),
      )
    })
    await flush()
  }
  const modeBtn = (label: string) =>
    [...host.querySelectorAll('.new-chat-bar button')].find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    resetAskUniEntryForTests()
    flags = vi.fn(async () => ({ streamEnabled: true }))
    const ctx: AskUniContext = {
      workspaces: [{ id: 'ws-a', name: 'Marketing team' }],
      currentWorkspaceId: 'ws-a',
      signedIn: true,
    }
    ;(window as unknown as { aiOffice: unknown }).aiOffice = new Proxy(
      {
        uniworkAskUni: vi.fn(),
        uniworkAskUniContext: vi.fn(async () => ctx),
        askUniFlags: flags,
        recents: async () => ({ items: [], total: 0 }),
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

  it('the Ask UNI toggle mounts the v2 panel when the flag is on', async () => {
    await mount()
    expect(host.querySelector('[data-testid="v2-panel"]')).toBeNull()
    await act(async () => modeBtn(en.askUniModeAsk)!.click())
    await flush()
    expect(host.querySelector('[data-testid="v2-panel"]')).not.toBeNull()
    expect(host.querySelector('.askuni-pane')).toBeNull()
  })

  it('keeps the v2 panel mounted (hidden) when the chat mode comes back', async () => {
    await mount()
    await act(async () => modeBtn(en.askUniModeAsk)!.click())
    await flush()
    await act(async () => modeBtn(en.askUniModeChat)!.click())
    const panel = host.querySelector('[data-testid="v2-panel"]') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel.hidden).toBe(true)
  })

  it('an open request switches to Ask UNI and focuses the composer', async () => {
    await mount()
    expect(modeBtn(en.askUniModeAsk)!.getAttribute('aria-pressed')).toBe('false')
    await act(async () => requestAskUniOpen())
    await flush()
    expect(modeBtn(en.askUniModeAsk)!.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[data-testid="v2-panel"]')).not.toBeNull()
    expect(document.activeElement).toBe(host.querySelector('textarea[aria-label="composer"]'))
  })

  it('a request made before the pane existed is applied when it mounts', async () => {
    requestAskUniOpen()
    await mount()
    expect(modeBtn(en.askUniModeAsk)!.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(host.querySelector('textarea[aria-label="composer"]'))
  })

  it('without an Ask UNI bridge a request changes nothing', async () => {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = new Proxy(
      { recents: async () => ({ items: [], total: 0 }), setLanguage: async () => null } as Record<
        string,
        unknown
      >,
      { get: (t, p: string) => (p in t ? t[p] : undefined) },
    )
    await mount()
    await act(async () => requestAskUniOpen())
    await flush()
    expect(modeBtn(en.askUniModeAsk)).toBeUndefined()
    expect(host.querySelector('[data-testid="v2-panel"]')).toBeNull()
  })
})
