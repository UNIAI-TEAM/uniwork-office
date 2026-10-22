// UNI-2076 S7d (markdown panel): the "Ask UNI" mode in the AI panel header swaps the body for the shared
// editor body behind window.uniworkAskUniDoc; chat state, the single live region and the no-id rule.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'

let root: Root | null = null
let container: HTMLElement | null = null
let editor: any = null
type DocFlags = { streamEnabled: boolean; bound: 'document' | 'local' | 'hidden' | 'signed_out' }

/** window.uniworkAskUniDoc as the editor preload exposes it, with spies */
function fakeBridge(flags: DocFlags) {
  return {
    askUniDocStream: vi.fn(async () => ({ ok: true, requestId: 'r1' })),
    askUniDocStreamCancel: vi.fn(async () => ({ ok: true })),
    onAskUniDocStreamEvent: vi.fn(() => () => {}),
    askUniDocMessages: vi.fn(async () => ({ ok: true, messages: [] })),
    askUniDocFeedbackSet: vi.fn(async () => ({ ok: true })),
    askUniDocFeedbackClear: vi.fn(async () => ({ ok: true })),
    askUniDocFlags: vi.fn(async () => flags),
  }
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {})
}

/** the element or one of its ancestors is not rendered (display none / hidden attribute) */
function isHidden(el: Element | null): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if ((n as HTMLElement).hidden || (n as HTMLElement).style?.display === 'none') return true
  }
  return false
}

function typeInto(box: HTMLTextAreaElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  set.call(box, value)
  box.dispatchEvent(new Event('input', { bubbles: true }))
}

const toggle = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button.ai-askuni-mode')
const askBody = (c: HTMLElement) => c.querySelector<HTMLElement>('.askuni-doc')
const regions = (c: HTMLElement) => c.querySelectorAll('[aria-live]')

/** a preload bridge answering every call; getAiSettings hands over plain default settings */
function bridgeProxy(): Record<string, ReturnType<typeof vi.fn>> {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
  return new Proxy(stubs, {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = /^on[A-Z]/.test(prop)
          ? vi.fn(() => () => {})
          : prop === 'getAiSettings'
            ? vi.fn(async () => ({ ...defaultAiSettings(), uniAiAvailable: false }))
            : vi.fn(async () => undefined)
      }
      return target[prop]
    },
  })
}

async function mount(bridge: ReturnType<typeof fakeBridge> | null): Promise<HTMLElement> {
  Element.prototype.scrollTo = () => {}
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  vi.stubGlobal('markdownApi', bridgeProxy())
  if (bridge) vi.stubGlobal('uniworkAskUniDoc', bridge)
  editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '<p>Saved document</p>',
  })
  const deps = {
    getEditor: () => editor,
    getFrontmatter: () => '',
    setFrontmatter: () => {},
    getSnapshot: () => ({}),
    restoreSnapshot: () => {},
    onRunDone: () => {},
  } as unknown as MarkdownAiDeps
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(AiPanel, { deps, filePath: '/docs/a.md', onCollapse: () => {} }),
      ),
    )
  })
  await settle()
  return container
}

describe('Ask UNI mode (markdown panel)', () => {
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy?.()
    root = null
    container = null
    editor = null
    vi.unstubAllGlobals()
  })

  it('shows no toggle when the bridge is absent (web frame build)', async () => {
    const c = await mount(null)
    expect(toggle(c)).toBeNull()
    expect(askBody(c)).toBeNull()
  })

  it('shows no toggle while the ask_uni_stream flag is off', async () => {
    const bridge = fakeBridge({ streamEnabled: false, bound: 'document' })
    const c = await mount(bridge)
    expect(bridge.askUniDocFlags).toHaveBeenCalled()
    expect(toggle(c)).toBeNull()
  })

  it('shows the toggle, off, once the flag is on; nothing of Ask UNI is rendered yet', async () => {
    const c = await mount(fakeBridge({ streamEnabled: true, bound: 'document' }))
    const btn = toggle(c)!
    expect(btn).not.toBeNull()
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('Ask UNI')
    expect(btn.closest('.ai-panel-header')).not.toBeNull()
    expect(askBody(c)).toBeNull()
    expect(isHidden(c.querySelector('.ai-chat'))).toBe(false)
  })

  it('swaps the body for Ask UNI and back; the chat stays mounted', async () => {
    const c = await mount(fakeBridge({ streamEnabled: true, bound: 'document' }))
    const chat = c.querySelector('.ai-chat')!
    await act(async () => toggle(c)!.click())
    await settle()
    expect(toggle(c)!.getAttribute('aria-pressed')).toBe('true')
    expect(askBody(c)).not.toBeNull()
    expect(isHidden(askBody(c))).toBe(false)
    expect(c.querySelector('.ai-chat')).toBe(chat)
    expect(isHidden(chat)).toBe(true)
    await act(async () => toggle(c)!.click())
    expect(toggle(c)!.getAttribute('aria-pressed')).toBe('false')
    expect(c.querySelector('.ai-chat')).toBe(chat)
    expect(isHidden(chat)).toBe(false)
    expect(isHidden(askBody(c))).toBe(true)
  })

  it('keeps the chat draft across a round trip', async () => {
    const c = await mount(fakeBridge({ streamEnabled: true, bound: 'document' }))
    const draft = c.querySelector('textarea')!
    await act(async () => typeInto(draft, 'half a thought'))
    expect(draft.value).toBe('half a thought')
    await act(async () => toggle(c)!.click())
    await settle()
    await act(async () => toggle(c)!.click())
    expect(c.querySelector('textarea')).toBe(draft)
    expect(draft.value).toBe('half a thought')
  })

  it('uses the panel single polite live region, never a second one', async () => {
    const c = await mount(fakeBridge({ streamEnabled: true, bound: 'document' }))
    const before = regions(c).length
    expect(c.querySelectorAll('.ai-sr-status')).toHaveLength(1)
    await act(async () => toggle(c)!.click())
    await settle()
    expect(regions(c)).toHaveLength(before)
    expect(askBody(c)!.querySelector('[aria-live]')).toBeNull()
    expect(c.querySelectorAll('.ai-sr-status')).toHaveLength(1)
  })

  it('names the file in the chip and nothing else about the document', async () => {
    const c = await mount(fakeBridge({ streamEnabled: true, bound: 'document' }))
    await act(async () => toggle(c)!.click())
    await settle()
    const chip = askBody(c)!.querySelector('.askuni-doc-chip')!
    expect(chip.textContent).toBe('a.md')
    expect(chip.getAttribute('title')).toBe('a.md')
    expect(askBody(c)!.textContent).not.toContain('/docs/')
  })

  it('a local file gets the save-first state, never a workspace-wide ask', async () => {
    const bridge = fakeBridge({ streamEnabled: true, bound: 'local' })
    const c = await mount(bridge)
    await act(async () => toggle(c)!.click())
    await settle()
    expect(askBody(c)!.textContent).toContain('Save to UniWork first')
    expect(askBody(c)!.querySelector('textarea')).toBeNull()
    expect(bridge.askUniDocStream).not.toHaveBeenCalled()
  })

  it('an ask carries the question only: no workspace, document, focus or path from the renderer', async () => {
    const bridge = fakeBridge({ streamEnabled: true, bound: 'document' })
    const c = await mount(bridge)
    await act(async () => toggle(c)!.click())
    await settle()
    const box = askBody(c)!.querySelector('textarea')!
    await act(async () => typeInto(box, 'What changed?'))
    await act(async () => {
      askBody(c)!.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click()
    })
    await settle()
    expect(bridge.askUniDocStream).toHaveBeenCalledTimes(1)
    const req = (bridge.askUniDocStream.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(req.question).toBe('What changed?')
    expect(
      Object.keys(req).every((k) => ['question', 'locale', 'conversationId'].includes(k)),
    ).toBe(true)
    expect(JSON.stringify(req)).not.toMatch(/workspace|document|focus|docs\//i)
  })
})
