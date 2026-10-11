// Slides (web frames): a stored key without a known model keeps Send off and says why, instead of
// letting the turn end in a setup sentence drawn as an error (N-01, post-A9 sweep). The chip
// (AiModelPicker) publishes the hint; the bespoke slides composer has to honor it like AiComposer.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

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

import { AiPanel } from '../src/renderer/ai/AiPanel'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import { setAiModelNeedHint } from '@genoffice/ui'

const HINT = 'Choose a model to send'

const settings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

let mounted: { root: Root; container: HTMLElement } | null = null

function mount(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(AiPanel, {
        slides: [],
        current: 0,
        selectedIds: [],
        images: new Map<string, HTMLImageElement>(),
        applySlide: () => {},
        applyDeck: () => {},
        fitWidthPx: 960,
        settings,
        open: true,
        onExpand: () => {},
        onCollapse: () => {},
      }),
    ),
  )
  mounted = { root, container }
  return container
}

function typeInto(textarea: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeAll(() => {
  // jsdom has no scrollTo; the panel auto-scrolls its chat log
  Element.prototype.scrollTo ??= () => {}
})

afterEach(() => {
  act(() => setAiModelNeedHint(null))
  if (mounted) {
    act(() => mounted!.root.unmount())
    mounted.container.remove()
    mounted = null
  }
})

describe('AiPanel model need (slides)', () => {
  it('no model known: Send is off, the hint says why, Enter sends nothing', () => {
    const container = mount()
    act(() => setAiModelNeedHint(HINT))
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[data-slides-ai-input]')!
    typeInto(textarea, 'make a deck')
    const send = container.querySelector<HTMLButtonElement>('.ai-send-btn')!
    expect(send.disabled).toBe(true)
    expect(send.getAttribute('data-tip')).toBe(HINT)
    expect(container.querySelector('.ai-input-hint')?.textContent).toBe(HINT)
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(container.querySelector('.ai-msg-user')).toBeNull()
    expect(textarea.value).toBe('make a deck')
  })

  it('a model is known: Send follows the text and there is no hint', () => {
    const container = mount()
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[data-slides-ai-input]')!
    typeInto(textarea, 'make a deck')
    expect(container.querySelector<HTMLButtonElement>('.ai-send-btn')!.disabled).toBe(false)
    expect(container.querySelector('.ai-input-hint')).toBeNull()
  })
})
