/**
 * UNI-1993 F2 + F3: the html renderer on a view-only UniWork copy (a shared view-only bound
 * document, or a source view: bound + readOnly + locked).
 *  F2: the preview frame is put into the inspector's non-editing `view` mode, the element-edit
 *      chrome never shows and a forged selection / delete from the frame changes nothing.
 *  F3: a readOnly AND locked file previews in a sandbox without allow-scripts; the frame is not
 *      loaded before the UniWork state is known, so a source never runs a script first.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: () => null,
}))

const PATH = 'C:/u/uniwork-drafts-preview/sources-x/h/mail.html'
const RAW =
  '<!doctype html><html><head><title>t</title><script>window.__ran = 1</script></head><body><p>Hello</p></body></html>'

type State = { bound: boolean; readOnly: boolean; locked?: boolean }

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }
}

async function mount(state: State | Promise<State>) {
  let current = state
  let onChanged: ((path: string) => void) | undefined
  const stubs: Record<string, Mock> = {
    consumePending: vi.fn(async () => PATH),
    getPreviewInfo: vi.fn(async () => ({ url: 'html-preview://view-1' })),
    readFile: vi.fn(async () => RAW),
    uniworkState: vi.fn(() => Promise.resolve(current)),
    onUniworkStateChanged: vi.fn((cb: (path: string) => void) => {
      onChanged = cb
      return () => {}
    }),
    uniworkReadOnlySave: vi.fn(async () => undefined),
    save: vi.fn(async () => ({ ok: true, canceled: true })),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (
        prop === 'capabilities' ||
        prop === 'consumeRecovered' ||
        prop === 'provideText' ||
        prop === 'connectPreview' ||
        prop === 'onStaticPreview'
      )
        return undefined
      if (prop in target) return target[prop]
      target[prop] = /^on[A-Z]/.test(prop) ? vi.fn(() => () => {}) : vi.fn(async () => undefined)
      return target[prop]
    },
  })
  Object.assign(window, { htmlApi: api })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(App)))
  })
  await settle()
  return {
    container,
    api: stubs,
    setAnswer: (next: State) => {
      current = next
    },
    ping: async () => {
      onChanged?.(PATH)
      await settle()
    },
    frame: () => container.querySelector<HTMLIFrameElement>('iframe.preview-frame'),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

const open: Array<{ unmount: () => void }> = []
const posted: unknown[] = []

beforeEach(() => {
  posted.length = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  window.matchMedia ||= (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as never
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
  // the frame's window is the test window: what the host posts to the inspector is recorded
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(window)
  vi.spyOn(window, 'postMessage').mockImplementation(((msg: unknown) => {
    posted.push(msg)
  }) as never)
})
afterEach(() => {
  open.splice(0).forEach((h) => h.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const computed = {
  color: '#000000',
  fontSize: '16',
  fontWeight: '400',
  fontStyle: 'normal',
  textAlign: 'start',
  background: '',
  backgroundImage: 'none',
  width: '100',
  height: '20',
  borderRadius: '0',
  padding: '0',
  opacity: '1',
  transform: '',
  marginLeft: '',
  marginRight: '',
  objectFit: 'fill',
}

/** the inspector in the frame reports a selected paragraph (version 0 = the first copy) */
async function frameSays(msg: Record<string, unknown>): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { version: 0, ...msg }, source: window }),
    )
  })
  await settle()
}

const selectP = {
  type: 'gx:select',
  dynamic: false,
  element: {
    sid: 4,
    tag: 'p',
    className: '',
    childElementCount: 0,
    text: 'Hello',
    rect: { x: 10, y: 10, width: 100, height: 20 },
    computed,
    textRun: 'Hello',
    textRunIndex: 0,
    inlineEditable: true,
  },
}

const modesPosted = () =>
  posted
    .filter(
      (m): m is { type: string; mode: string } => (m as { type?: string })?.type === 'gx:setMode',
    )
    .map((m) => m.mode)

describe('F2: a view-only UniWork copy has no element editing in the preview', () => {
  it('puts the frame in the non-editing view mode (shared view-only bound document)', async () => {
    const h = await mount({ bound: true, readOnly: true })
    open.push(h)
    await frameSays({ type: 'gx:ready', title: 't', docHeight: 900 })
    expect(modesPosted().at(-1)).toBe('view')
  })

  it('switches a live frame to the view mode when the copy turns read-only (lock ping)', async () => {
    const h = await mount({ bound: true, readOnly: false })
    open.push(h)
    await frameSays({ type: 'gx:ready', title: 't', docHeight: 900 })
    expect(modesPosted().at(-1)).toBe('inspect')
    h.setAnswer({ bound: true, readOnly: true })
    await h.ping()
    expect(modesPosted().at(-1)).toBe('view')
  })

  it('keeps the editing inspect mode for a plain local file and an editable bound document', async () => {
    const plain = await mount({ bound: false, readOnly: false })
    open.push(plain)
    await frameSays({ type: 'gx:ready', title: 't', docHeight: 900 })
    expect(modesPosted().at(-1)).toBe('inspect')
    plain.unmount()
    open.pop()
    posted.length = 0
    const bound = await mount({ bound: true, readOnly: false })
    open.push(bound)
    await frameSays({ type: 'gx:ready', title: 't', docHeight: 900 })
    expect(modesPosted().at(-1)).toBe('inspect')
  })

  it('shows the element-edit toolbar for a selection on an editable copy (harness check)', async () => {
    const h = await mount({ bound: false, readOnly: false })
    open.push(h)
    await frameSays(selectP)
    expect(h.container.querySelector('.float-toolbar, .float-bar, [class*="float"]')).not.toBeNull()
  })

  it.each([
    ['shared view-only', { bound: true, readOnly: true }],
    ['source view', { bound: true, readOnly: true, locked: true }],
  ])(
    'shows no element-edit toolbar or inspector panel, even for a forged selection (%s)',
    async (_n, state) => {
      const h = await mount(state)
      open.push(h)
      await frameSays(selectP)
      expect(h.container.querySelector('[class*="float"]')).toBeNull()
      expect(h.container.querySelector('.style-panel, [class*="style-panel"]')).toBeNull()
    },
  )

  it('ignores a forged Delete key command from the frame', async () => {
    const h = await mount({ bound: true, readOnly: true })
    open.push(h)
    await frameSays(selectP)
    const before = h.container.querySelector('.cm-content')?.textContent
    await frameSays({ type: 'gx:keyCommand', command: 'delete' })
    expect(h.container.querySelector('.cm-content')?.textContent).toBe(before)
    expect(h.container.querySelector('[class*="float"]')).toBeNull()
  })
})

describe('F3: scripts never run in a source view', () => {
  it.each([
    ['source view (readOnly + locked)', { bound: true, readOnly: true, locked: true }],
    ['locked and read-only without a binding', { bound: false, readOnly: true, locked: true }],
  ])('previews in a sandbox without allow-scripts: %s', async (_n, state) => {
    const h = await mount(state)
    open.push(h)
    expect(h.frame()?.getAttribute('sandbox')).toBe('')
    expect(h.frame()?.getAttribute('src')).toContain('html-preview://view-1')
  })

  it.each([
    ['plain local file', { bound: false, readOnly: false }],
    ['editable bound document', { bound: true, readOnly: false }],
    ['shared view-only document (not locked)', { bound: true, readOnly: true }],
    ['locked but still editable', { bound: true, readOnly: false, locked: true }],
  ])('keeps the scripts sandbox for a %s', async (_n, state) => {
    const h = await mount(state)
    open.push(h)
    expect(h.frame()?.getAttribute('sandbox')).toContain('allow-scripts')
  })

  it('does not load the preview before the UniWork state is known', async () => {
    let answer!: (s: State) => void
    const h = await mount(new Promise<State>((r) => (answer = r)))
    open.push(h)
    expect(h.frame()?.getAttribute('src')).toBe('about:blank')
    await act(async () => {
      answer({ bound: true, readOnly: true, locked: true })
    })
    await settle()
    expect(h.frame()?.getAttribute('sandbox')).toBe('')
    expect(h.frame()?.getAttribute('src')).toContain('html-preview://view-1')
  })
})

describe('F3: the frame is released once, straight to its final document', () => {
  /**
   * Every src the preview iframe ever carried, transient ones included. A mutation record reads the
   * attribute only when the observer fires, so the history is rebuilt from `oldValue`s plus the end value.
   */
  function recordSrcs(root: HTMLElement): { srcs: string[]; stop: () => void } {
    const srcs: string[] = []
    let frame: Element | null = null
    const isFrame = (n: unknown): n is Element =>
      n instanceof Element && n.matches('iframe.preview-frame')
    const drain = (records: MutationRecord[]) => {
      for (const r of records) {
        if (r.type === 'childList')
          r.addedNodes.forEach((n) => {
            if (isFrame(n) && n !== frame) frame = n
          })
        else if (isFrame(r.target)) srcs.push(r.oldValue ?? '')
      }
    }
    const observer = new MutationObserver(drain)
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
      attributeOldValue: true,
    })
    return {
      srcs,
      stop: () => {
        drain(observer.takeRecords())
        observer.disconnect()
        const f = frame ?? document.querySelector('iframe.preview-frame')
        if (f) srcs.push(f.getAttribute('src') ?? '')
      },
    }
  }

  async function mountRecording(state: Promise<State> | State) {
    const container = document.body.appendChild(document.createElement('div'))
    // mount() makes its own container; record on the body to see it from the first commit
    const rec = recordSrcs(document.body)
    const h = await mount(state)
    container.remove()
    return { h, rec }
  }

  // rejects only when awaited, so no rejection is left unhandled before the app asks
  const rejecting = {
    then: (_ok: unknown, fail: (e: Error) => void) => fail(new Error('no handler')),
  }

  it.each([
    ['unbound answer', { bound: false, readOnly: false } as State | 'reject'],
    ['rejected call', 'reject' as State | 'reject'],
  ])('loads a plain file once, never through a blank frame (%s)', async (_n, answer) => {
    const state = answer === 'reject' ? (rejecting as unknown as Promise<State>) : answer
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { h, rec } = await mountRecording(state)
    open.push(h)
    rec.stop()
    const real = rec.srcs.filter((s) => s.includes('html-preview://view-1'))
    expect(real).toHaveLength(1)
    // nothing blank follows the real document: the frame would be reloaded (or stay empty)
    const firstReal = rec.srcs.findIndex((s) => s.includes('html-preview://view-1'))
    expect(rec.srcs.slice(firstReal + 1)).toEqual([])
    expect(h.frame()?.getAttribute('src')).toContain('html-preview://view-1')
    expect(h.frame()?.getAttribute('sandbox')).toContain('allow-scripts')
  })

  it('does not load the real document before a late answer, then loads it once', async () => {
    let answer!: (s: State) => void
    const { h, rec } = await mountRecording(new Promise<State>((r) => (answer = r)))
    open.push(h)
    expect(rec.srcs.filter((s) => s.includes('html-preview://'))).toEqual([])
    await act(async () => {
      answer({ bound: false, readOnly: false })
    })
    await settle()
    rec.stop()
    expect(rec.srcs.filter((s) => s.includes('html-preview://view-1'))).toHaveLength(1)
    expect(h.frame()?.getAttribute('src')).toContain('html-preview://view-1')
  })
})
