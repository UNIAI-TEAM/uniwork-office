// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { findShortcut } from '@genoffice/shortcuts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/askuni/en'
import type { AskUniContext, AskUniFlags } from '../src/shared/askuni-api'

// the two panes are tested on their own: the host only chooses between them
const mocks = vi.hoisted(() => ({
  panelProps: { current: null as Record<string, unknown> | null },
  paneProps: { current: null as Record<string, unknown> | null },
}))
vi.mock('../src/renderer/src/askuni-v2/AskUniPanel', async () => {
  const { createElement } = await import('react')
  return {
    AskUniPanel: (props: Record<string, unknown>) => {
      mocks.panelProps.current = props
      return createElement(
        'section',
        { 'data-testid': 'v2-panel', 'data-ws': String(props.workspaceId), hidden: !props.visible },
        createElement('textarea', { 'aria-label': 'composer' }),
      )
    },
  }
})
vi.mock('../src/renderer/src/AskUniPane', async () => {
  const { createElement } = await import('react')
  return {
    hasAskUniBridge: () => {
      const b = (window as unknown as { aiOffice?: Record<string, unknown> }).aiOffice
      return typeof b?.uniworkAskUni === 'function' && typeof b?.uniworkAskUniContext === 'function'
    },
    AskUniPane: (props: Record<string, unknown>) => {
      mocks.paneProps.current = props
      return createElement(
        'section',
        { 'data-testid': 'p1-pane', hidden: props.visible === false },
        createElement('textarea', { 'aria-label': 'p1-composer' }),
      )
    },
  }
})

import { AskUniHost } from '../src/renderer/src/AskUniHost'
import {
  ASKUNI_FLAGS_REFRESH_MS,
  consumeAskUniOpen,
  isAskUniShortcut,
  refreshAskUniFlags,
  requestAskUniOpen,
  resetAskUniEntryForTests,
  useAskUniOpenRequest,
  useAskUniShortcut,
  useAskUniStreamFlag,
} from '../src/renderer/src/askuni-entry'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WS_A = { id: 'ws-a', name: 'Marketing team' }
const WS_B = { id: 'ws-b', name: 'Finance team' }
const ctx = (over: Partial<AskUniContext> = {}): AskUniContext => ({
  workspaces: [WS_A],
  currentWorkspaceId: WS_A.id,
  signedIn: true,
  ...over,
})

describe('Ask UNI v2 entry points', () => {
  let host: HTMLDivElement
  let root: Root
  let flags: ReturnType<typeof vi.fn<() => Promise<AskUniFlags>>>
  let context: ReturnType<typeof vi.fn<() => Promise<AskUniContext>>>
  let activate: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>

  function installBridge(extra: Record<string, unknown> = {}, withFlags = true): void {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      uniworkAskUni: vi.fn(),
      uniworkAskUniContext: context,
      ...(withFlags ? { askUniFlags: flags } : {}),
      setLanguage: vi.fn(async () => undefined),
      ...extra,
    }
  }
  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
  }
  async function render(node: ReturnType<typeof h>): Promise<void> {
    await act(async () => {
      root.render(h(LocaleProvider, { initial: 'en', children: node }))
    })
    await flush()
  }
  const mountHost = (props: { visible?: boolean; focusToken?: number } = {}) =>
    render(h(AskUniHost, props))
  const panel = () => host.querySelector('[data-testid="v2-panel"]') as HTMLElement | null
  const p1 = () => host.querySelector('[data-testid="p1-pane"]') as HTMLElement | null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    resetAskUniEntryForTests()
    mocks.panelProps.current = null
    mocks.paneProps.current = null
    flags = vi.fn(async () => ({ streamEnabled: true }))
    context = vi.fn(async () => ctx())
    activate = vi.fn(async () => undefined)
    ;(window as unknown as { aiOfficeTabs: unknown }).aiOfficeTabs = { activate }
    installBridge()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
    delete (window as unknown as { aiOfficeTabs?: unknown }).aiOfficeTabs
  })

  describe('flag store', () => {
    it('reads streamEnabled from the bridge', async () => {
      await refreshAskUniFlags({ force: true })
      expect(flags).toHaveBeenCalledTimes(1)
    })

    it('a bridge without askUniFlags is a settled "off", not a wait', async () => {
      installBridge({}, false)
      function Probe() {
        const f = useAskUniStreamFlag()
        return h('p', { 'data-testid': 'probe' }, `${f.loaded}:${f.enabled}`)
      }
      await render(h(Probe))
      expect(host.querySelector('[data-testid="probe"]')?.textContent).toBe('true:false')
      expect(flags).not.toHaveBeenCalled()
    })

    it('does not ask again within 60 s unless forced, and asks again after', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-22T03:00:00Z'))
      await refreshAskUniFlags()
      await refreshAskUniFlags()
      expect(flags).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + ASKUNI_FLAGS_REFRESH_MS - 1000)
      await refreshAskUniFlags()
      expect(flags).toHaveBeenCalledTimes(1)
      await refreshAskUniFlags({ force: true })
      expect(flags).toHaveBeenCalledTimes(2)
      vi.setSystemTime(Date.now() + ASKUNI_FLAGS_REFRESH_MS + 1000)
      await refreshAskUniFlags()
      expect(flags).toHaveBeenCalledTimes(3)
    })

    it('shares one in-flight call between callers', async () => {
      let release: (f: AskUniFlags) => void = () => undefined
      flags.mockImplementationOnce(() => new Promise((res) => (release = res)))
      const a = refreshAskUniFlags({ force: true })
      const b = refreshAskUniFlags({ force: true })
      release({ streamEnabled: true })
      await Promise.all([a, b])
      expect(flags).toHaveBeenCalledTimes(1)
    })

    it('keeps the last answer when a refresh fails', async () => {
      function Probe() {
        const f = useAskUniStreamFlag()
        return h('p', { 'data-testid': 'probe' }, `${f.loaded}:${f.enabled}`)
      }
      await render(h(Probe))
      expect(host.querySelector('[data-testid="probe"]')?.textContent).toBe('true:true')
      flags.mockRejectedValueOnce(new Error('boom'))
      await act(async () => {
        await refreshAskUniFlags({ force: true })
      })
      expect(host.querySelector('[data-testid="probe"]')?.textContent).toBe('true:true')
    })

    it('refreshes when the window regains focus, at most every 60 s', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-22T03:00:00Z'))
      function Probe() {
        useAskUniStreamFlag()
        return null
      }
      await render(h(Probe))
      expect(flags).toHaveBeenCalledTimes(1)
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await flush()
      expect(flags).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + ASKUNI_FLAGS_REFRESH_MS + 1000)
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await flush()
      expect(flags).toHaveBeenCalledTimes(2)
    })
  })

  describe('host: which version shows', () => {
    it('flag on mounts the v2 panel for the current workspace and not the P1 pane', async () => {
      await mountHost()
      expect(panel()).not.toBeNull()
      expect(panel()!.dataset.ws).toBe('ws-a')
      expect(p1()).toBeNull()
    })

    it('flag off keeps the P1 pane exactly as today', async () => {
      flags.mockResolvedValue({ streamEnabled: false })
      await mountHost({ visible: true })
      expect(p1()).not.toBeNull()
      expect(panel()).toBeNull()
      expect(mocks.paneProps.current).toMatchObject({ visible: true })
    })

    it('a bridge with no askUniFlags is the P1 pane at once', async () => {
      installBridge({}, false)
      await mountHost()
      expect(p1()).not.toBeNull()
      expect(panel()).toBeNull()
    })

    it('shows neither pane while the first flag answer is on its way', async () => {
      let release: (f: AskUniFlags) => void = () => undefined
      flags.mockImplementationOnce(() => new Promise((res) => (release = res)))
      await mountHost()
      expect(p1()).toBeNull()
      expect(panel()).toBeNull()
      expect(host.textContent).toContain(en.askUniLoading)
      await act(async () => release({ streamEnabled: true }))
      await flush()
      expect(panel()).not.toBeNull()
    })

    it('swaps the pane when a refresh flips the flag', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-22T03:00:00Z'))
      await mountHost()
      expect(panel()).not.toBeNull()
      flags.mockResolvedValue({ streamEnabled: false })
      vi.setSystemTime(Date.now() + ASKUNI_FLAGS_REFRESH_MS + 1000)
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await flush()
      expect(p1()).not.toBeNull()
      expect(panel()).toBeNull()
    })

    it('passes visibility through and keeps the v2 panel mounted while hidden', async () => {
      await mountHost({ visible: true })
      await mountHost({ visible: false })
      expect(panel()).not.toBeNull()
      expect(panel()!.hidden).toBe(true)
      expect(mocks.panelProps.current).toMatchObject({ visible: false })
    })

    it('forces a flag refresh when the signed-in workspace changes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-22T03:00:00Z'))
      context.mockResolvedValueOnce(
        ctx({ signedIn: false, workspaces: [], currentWorkspaceId: null }),
      )
      await mountHost()
      expect(flags).toHaveBeenCalledTimes(1)
      context.mockResolvedValue(ctx())
      const retry = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Try again',
      ) as HTMLButtonElement | undefined
      // signed out shows no retry; a hidden -> visible comes back and picks the sign-in up (P1 rule)
      expect(retry).toBeUndefined()
      await mountHost({ visible: false })
      await mountHost({ visible: true })
      expect(panel()).not.toBeNull()
      expect(flags.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('host: gate around the v2 panel (P1 states and wording)', () => {
    it('shows the loading note while the context is on its way', async () => {
      let release: (c: AskUniContext) => void = () => undefined
      context.mockImplementationOnce(() => new Promise((res) => (release = res)))
      await mountHost()
      expect(host.textContent).toContain(en.askUniLoading)
      expect(panel()).toBeNull()
      await act(async () => release(ctx()))
      await flush()
      expect(panel()).not.toBeNull()
    })

    it('signed out: the P1 note, no panel', async () => {
      context.mockResolvedValue(ctx({ signedIn: false, workspaces: [], currentWorkspaceId: null }))
      await mountHost()
      expect(host.textContent).toContain(en.askUniSignedOut)
      expect(panel()).toBeNull()
    })

    it('no workspace: the P1 note, no panel', async () => {
      context.mockResolvedValue(ctx({ workspaces: [], currentWorkspaceId: null }))
      await mountHost()
      expect(host.textContent).toContain(en.askUniNoWorkspace)
      expect(panel()).toBeNull()
    })

    it('a failed context shows the P1 error with a retry that loads again', async () => {
      context.mockRejectedValueOnce(new Error('offline'))
      await mountHost()
      expect(host.textContent).toContain(en.askUniErrDefault)
      expect(panel()).toBeNull()
      const retry = [...host.querySelectorAll('button')].find((b) =>
        b.className.includes('new-chat-ghost-btn'),
      ) as HTMLButtonElement
      await act(async () => retry.click())
      await flush()
      expect(context).toHaveBeenCalledTimes(2)
      expect(panel()).not.toBeNull()
    })

    it('hands the workspaces over: several give the panel a switch, a pick changes its workspace', async () => {
      context.mockResolvedValue(ctx({ workspaces: [WS_A, WS_B] }))
      await mountHost()
      const props = mocks.panelProps.current as {
        workspaces: unknown
        onWorkspaceChange: (id: string) => void
      }
      expect(props.workspaces).toEqual([WS_A, WS_B])
      await act(async () => props.onWorkspaceChange('ws-b'))
      expect(panel()!.dataset.ws).toBe('ws-b')
    })

    it('uses the account current workspace first, else the first one', async () => {
      context.mockResolvedValue(ctx({ workspaces: [WS_A, WS_B], currentWorkspaceId: 'ws-b' }))
      await mountHost()
      expect(panel()!.dataset.ws).toBe('ws-b')
    })
  })

  describe('host: composer focus request', () => {
    it('a new focus token puts the caret in the v2 composer once the panel is up', async () => {
      await mountHost({ focusToken: 0 })
      const other = document.createElement('button')
      document.body.appendChild(other)
      other.focus()
      await mountHost({ focusToken: 1 })
      expect(document.activeElement).toBe(host.querySelector('textarea'))
      other.remove()
    })

    it('waits for a panel that is still loading, then focuses it', async () => {
      let release: (c: AskUniContext) => void = () => undefined
      context.mockImplementationOnce(() => new Promise((res) => (release = res)))
      await mountHost({ focusToken: 1 })
      expect(host.querySelector('textarea')).toBeNull()
      await act(async () => release(ctx()))
      await flush()
      expect(document.activeElement).toBe(host.querySelector('textarea'))
    })

    it('focuses the P1 composer when the flag is off', async () => {
      flags.mockResolvedValue({ streamEnabled: false })
      await mountHost({ focusToken: 1 })
      expect(document.activeElement).toBe(host.querySelector('textarea'))
    })

    it('does not focus a hidden pane', async () => {
      await mountHost({ focusToken: 0, visible: false })
      await mountHost({ focusToken: 1, visible: false })
      expect(document.activeElement).not.toBe(host.querySelector('textarea'))
    })
  })

  describe('open request bus', () => {
    function Probe({ onSeen }: { onSeen: (seq: number | null) => void }) {
      const req = useAskUniOpenRequest()
      onSeen(req ? req.seq : null)
      return null
    }

    it('a request is seen by a subscriber and stays until consumed', async () => {
      const seen: (number | null)[] = []
      await render(h(Probe, { onSeen: (s) => seen.push(s) }))
      expect(seen.at(-1)).toBeNull()
      await act(async () => requestAskUniOpen())
      const seq = seen.at(-1)!
      expect(seq).toBeGreaterThan(0)
      await act(async () => consumeAskUniOpen(seq))
      expect(seen.at(-1)).toBeNull()
    })

    it('a request made before anyone listens is waiting for the first subscriber', async () => {
      requestAskUniOpen()
      const seen: (number | null)[] = []
      await render(h(Probe, { onSeen: (s) => seen.push(s) }))
      expect(seen.at(-1)).toBeGreaterThan(0)
    })

    it('consuming an older request does not drop a newer one', async () => {
      const seen: (number | null)[] = []
      await render(h(Probe, { onSeen: (s) => seen.push(s) }))
      await act(async () => requestAskUniOpen())
      const first = seen.at(-1)!
      await act(async () => requestAskUniOpen())
      const second = seen.at(-1)!
      expect(second).toBeGreaterThan(first)
      await act(async () => consumeAskUniOpen(first))
      expect(seen.at(-1)).toBe(second)
    })
  })

  describe('Ctrl+J / Cmd+J', () => {
    function Shortcut({ platform }: { platform?: 'win' | 'mac' }) {
      useAskUniShortcut(platform)
      return null
    }
    function Probe({ onSeen }: { onSeen: (seq: number | null) => void }) {
      const req = useAskUniOpenRequest()
      onSeen(req ? req.seq : null)
      return null
    }
    const keydown = (init: KeyboardEventInit) => {
      const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      window.dispatchEvent(ev)
      return ev
    }

    it('is a row of the shell table: Ctrl+J on Windows/Linux, Cmd+J on macOS', () => {
      const row = findShortcut('shell', 'shell-21')
      expect(row).toBeDefined()
      expect(row!.win).toEqual(['Ctrl+J'])
      expect(row!.mac).toEqual(['Cmd+J'])
    })

    it('matches the table chord only: Ctrl+J on win, Cmd+J on mac, no Shift/Alt, no foreign modifier', () => {
      const ev = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)
      expect(isAskUniShortcut(ev({ key: 'j', code: 'KeyJ', ctrlKey: true }), 'win')).toBe(true)
      expect(isAskUniShortcut(ev({ key: 'J', code: 'KeyJ', ctrlKey: true }), 'win')).toBe(true)
      expect(isAskUniShortcut(ev({ key: 'j', code: 'KeyJ', metaKey: true }), 'win')).toBe(false)
      expect(isAskUniShortcut(ev({ key: 'j', code: 'KeyJ', metaKey: true }), 'mac')).toBe(true)
      expect(isAskUniShortcut(ev({ key: 'j', code: 'KeyJ', ctrlKey: true }), 'mac')).toBe(false)
      expect(
        isAskUniShortcut(ev({ key: 'j', code: 'KeyJ', ctrlKey: true, shiftKey: true }), 'win'),
      ).toBe(false)
      expect(
        isAskUniShortcut(ev({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true }), 'win'),
      ).toBe(false)
      expect(isAskUniShortcut(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), 'win')).toBe(false)
      expect(isAskUniShortcut(ev({ key: 'j', code: 'KeyJ' }), 'win')).toBe(false)
    })

    it('opens Home My AI in Ask UNI mode: activates the Home tab and files a request', async () => {
      const seen: (number | null)[] = []
      await render(
        h('div', null, h(Shortcut, { platform: 'win' }), h(Probe, { onSeen: (s) => seen.push(s) })),
      )
      let ev: KeyboardEvent
      await act(async () => {
        ev = keydown({ key: 'j', code: 'KeyJ', ctrlKey: true })
      })
      expect(ev!.defaultPrevented).toBe(true)
      expect(activate).toHaveBeenCalledWith('home')
      expect(seen.at(-1)).toBeGreaterThan(0)
    })

    it('Cmd+J on a Mac', async () => {
      const seen: (number | null)[] = []
      await render(
        h('div', null, h(Shortcut, { platform: 'mac' }), h(Probe, { onSeen: (s) => seen.push(s) })),
      )
      await act(async () => {
        keydown({ key: 'j', code: 'KeyJ', metaKey: true })
      })
      expect(seen.at(-1)).toBeGreaterThan(0)
    })

    it('does nothing when the shell has no Ask UNI (no bridge): the key keeps its default', async () => {
      ;(window as unknown as { aiOffice: unknown }).aiOffice = { setLanguage: vi.fn() }
      const seen: (number | null)[] = []
      await render(
        h('div', null, h(Shortcut, { platform: 'win' }), h(Probe, { onSeen: (s) => seen.push(s) })),
      )
      let ev: KeyboardEvent
      await act(async () => {
        ev = keydown({ key: 'j', code: 'KeyJ', ctrlKey: true })
      })
      expect(ev!.defaultPrevented).toBe(false)
      expect(activate).not.toHaveBeenCalled()
      expect(seen.at(-1)).toBeNull()
    })

    it('ignores a held key and an IME composition', async () => {
      const seen: (number | null)[] = []
      await render(
        h('div', null, h(Shortcut, { platform: 'win' }), h(Probe, { onSeen: (s) => seen.push(s) })),
      )
      await act(async () => {
        keydown({ key: 'j', code: 'KeyJ', ctrlKey: true, repeat: true })
        keydown({ key: 'j', code: 'KeyJ', ctrlKey: true, isComposing: true })
      })
      expect(activate).not.toHaveBeenCalled()
      expect(seen.at(-1)).toBeNull()
    })

    it('stops listening when unmounted', async () => {
      await render(h(Shortcut, { platform: 'win' }))
      await render(h('div'))
      await act(async () => {
        keydown({ key: 'j', code: 'KeyJ', ctrlKey: true })
      })
      expect(activate).not.toHaveBeenCalled()
    })
  })
})
