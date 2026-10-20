/**
 * UNI-2033 T3b: a view-only bound deck is forced into Reading view, and the server comments pane
 * must still render there (the `@vN` read-only copy a "View in version N" opens, or a deck shared
 * for view opened with a comment deep link). The reveal the shell pushes opens the pane and the
 * thread shows in it; the toolbar toggle closes and reopens it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  CommentsRevealPayload,
  UniworkCommentsApi,
} from '@genoffice/electron-utils/comments-ipc'

// react-konva's node entry requires the native 'canvas' package; nothing here draws
vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})
vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: () => null,
}))

import { App } from '../src/renderer/App'
import { resetForTest } from '../src/renderer/capabilities'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/deck.pptx'

const BLANK_SLIDE = {
  widthPx: 1280,
  heightPx: 720,
  scale: 1,
  nodes: [],
  background: { kind: 'color' as const, color: '#ffffff' },
}

const ROW = {
  id: 'x1',
  document_id: 'doc-1',
  kind: 'comment',
  author_id: 'someone',
  parent_id: null,
  body: 'revealed in reading view',
  revision: 1,
  anchor: null,
  anchor_state: null,
  resolved_at: null,
  deleted_at: null,
  created_at: '2026-10-12T09:00:02Z',
  updated_at: '2026-10-12T09:00:02Z',
  display_name: 'Le Thu Ha',
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }
}

let root: Root | null = null
let container: HTMLElement | null = null
let revealHandlers: Set<(p: CommentsRevealPayload) => void>

function installApis(): void {
  const explicit: Record<string, unknown> = {
    consumePendingOpen: () =>
      Promise.resolve({ ok: true, path: PATH, slides: [BLANK_SLIDE], defaultFont: 'Arial' }),
    newBlank: () => Promise.resolve({ path: '', slides: [BLANK_SLIDE], defaultFont: 'Arial' }),
    isDirty: () => Promise.resolve(false),
    getRecentFiles: () => Promise.resolve([]),
    getAiSettings: () => Promise.resolve({ provider: 'anthropic', providers: {} }),
    getSections: () => Promise.resolve([]),
    getComments: () => Promise.resolve([]),
    getNotes: () => Promise.resolve(''),
    getAnimations: () => Promise.resolve([]),
    getTransition: () => Promise.resolve(null),
    listFonts: () => Promise.resolve([]),
    // no capability table = the desktop shell (every capability on, all ribbon tabs)
    capabilities: undefined,
    uniworkState: () => Promise.resolve({ bound: true, readOnly: true }),
  }
  const fallbacks: Record<string, unknown> = {}
  const api = new Proxy(explicit, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      fallbacks[prop] ??= prop.startsWith('on') ? () => () => {} : () => Promise.resolve(null)
      return fallbacks[prop]
    },
  })
  Object.assign(window, { slidesApi: api })

  const ok = (value: unknown) => Promise.resolve({ ok: true, value }) as Promise<never>
  const bridge: Partial<UniworkCommentsApi> = {
    list: () => ok({ comments: [{ ...ROW }], mentions: [], list_token: 't1', unchanged: false }),
    context: () => ok({ documentId: 'doc-1', versionId: 'v2', profile: 'readOnly' }),
    onSaved: () => () => {},
    onReveal: (handler) => {
      revealHandlers.add(handler)
      return () => revealHandlers.delete(handler)
    },
  }
  vi.stubGlobal('uniworkComments', bridge)
}

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  localStorage.clear()
  revealHandlers = new Set()
  installApis()
  resetForTest()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  localStorage.clear()
  delete (window as unknown as Record<string, unknown>).uniworkComments
})

async function bootApp(): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setModuleLang('en')
  await act(async () =>
    root!.render(createElement(LocaleProvider, { initial: 'en', children: createElement(App) })),
  )
  await settle()
  return container
}

describe('slides App: server comments in Reading view (view-only deck)', () => {
  it('a reveal pushed to a view-only deck shows the comments pane and the thread in Reading view', async () => {
    const host = await bootApp()
    expect(host.querySelector('.reading-view')).not.toBeNull()
    expect(host.querySelector('aside.collab-panel')).toBeNull()

    await act(async () => {
      revealHandlers.forEach((h) => h({ path: PATH, commentId: 'x1' }))
    })
    await settle()

    // still the Reading view (the mode a view-only deck opens in is unchanged) ...
    expect(host.querySelector('.reading-view')).not.toBeNull()
    // ... with the shared comments pane beside it, the revealed thread inside
    const panel = host.querySelector('aside.collab-panel')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('revealed in reading view')
  })

  it('the Review > Comments pane toggle closes and reopens the pane in Reading view', async () => {
    const host = await bootApp()
    await act(async () => {
      revealHandlers.forEach((h) => h({ path: PATH, commentId: 'x1' }))
    })
    await settle()
    expect(host.querySelector('aside.collab-panel')).not.toBeNull()

    const tab = [...host.querySelectorAll('button.ribbon-tab')].find(
      (b) => b.textContent === 'Review',
    )
    expect(tab).toBeDefined()
    await act(async () => tab!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const toggle = () =>
      [...host.querySelectorAll<HTMLButtonElement>('button.rb-big')].find((b) =>
        b.textContent?.startsWith('Comments Pane'),
      )
    expect(toggle()).toBeDefined()

    await act(async () => toggle()!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await settle()
    expect(host.querySelector('aside.collab-panel')).toBeNull()
    expect(host.querySelector('.reading-view')).not.toBeNull()

    await act(async () => toggle()!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await settle()
    expect(host.querySelector('aside.collab-panel')).not.toBeNull()
  })
})
