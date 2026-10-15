// RF6-1 (docs panel): the model picker writes its list note into the panel's own polite node and
// mounts no live region of its own, so the panel keeps its fixed live nodes (Accessibility Floor:
// present from load, never mounted at runtime).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'

/** a picker whose list is still loading: the list note is "Loading models…" */
function loadingSettings(): AiSettings {
  const base = defaultAiSettings()
  return {
    ...base,
    uniAiAvailable: false,
    provider: 'anthropic',
    providers: { ...base.providers, anthropic: { apiKey: 'k', model: 'claude-x' } },
    modelSources: { anthropic: { chosen: 'claude-x', listState: 'loading' } },
  } as AiSettings
}

/** a preload bridge answering every call; getAiSettings hands over the loading-list settings */
function bridgeProxy(): Record<string, ReturnType<typeof vi.fn>> {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
  return new Proxy(stubs, {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = /^on[A-Z]/.test(prop)
          ? vi.fn(() => () => {})
          : prop === 'getAiSettings'
            ? vi.fn(async () => loadingSettings())
            : vi.fn(async () => undefined)
      }
      return target[prop]
    },
  })
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {})
}

async function openPickerAndRead(container: HTMLElement): Promise<void> {
  const live = () => container.querySelectorAll('[aria-live]')
  const region = () => container.querySelector('.ai-sr-status') as HTMLElement
  const closedCount = live().length
  expect(region().textContent).toBe('')
  await act(async () => {
    ;(container.querySelector('.ai-model-chip') as HTMLButtonElement).click()
  })
  await settle()
  const pop = container.querySelector('.ai-model-pop') as HTMLElement
  expect(pop, 'the picker opened').not.toBeNull()
  const note = region().textContent ?? ''
  expect(note).not.toBe('')
  expect(pop.textContent).toContain(note)
  expect(live()).toHaveLength(closedCount)
  expect(
    container.querySelector('.ai-model-chip')!.parentElement!.querySelector('[aria-live]'),
  ).toBeNull()
}

describe('model picker announce (docs panel)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    delete (window as any).desktop
    setModuleLang('zh')
  })

  it('opening the picker writes the list note into the panel polite node, with no second live node', async () => {
    setModuleLang('en')
    ;(window as any).desktop = bridgeProxy()
    editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [{ type: 'text', text: 'x' }] },
        ],
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings: loadingSettings() as never,
            open: true,
            filePath: '/docs/a.docx',
          }),
        }),
      )
    })
    await settle()
    await openPickerAndRead(container)
  })
})
