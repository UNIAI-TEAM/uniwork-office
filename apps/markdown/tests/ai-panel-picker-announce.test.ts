// RF6-1 (markdown panel): the model picker writes its list note into the panel's own polite node and
// mounts no live region of its own, so the panel keeps its fixed live nodes (Accessibility Floor:
// present from load, never mounted at runtime).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'

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

describe('model picker announce (markdown panel)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    vi.unstubAllGlobals()
  })

  it('opening the picker writes the list note into the panel polite node, with no second live node', async () => {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    vi.stubGlobal('markdownApi', bridgeProxy())
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
    await openPickerAndRead(container)
  })
})
