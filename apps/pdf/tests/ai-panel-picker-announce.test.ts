// RF6-1 (pdf panel): the model picker writes its list note into the panel's own polite node and
// mounts no live region of its own, so the panel keeps its fixed live nodes (Accessibility Floor:
// present from load, never mounted at runtime).
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { LocaleProvider } from '../src/renderer/i18n/locale'

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

describe('model picker announce (pdf panel)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    delete (window as any).pdfApi
  })

  const api = new Proxy(
    { fileName: () => 'doc.pdf', readOnly: () => false, selection: () => null },
    { get: (t, p: string) => (p in t ? (t as never)[p] : () => null) },
  )

  it('opening the picker writes the list note into the panel polite node, with no second live node', async () => {
    ;(window as any).pdfApi = {
      getAiSettings: async () => loadingSettings(),
      setAiPanelPrefs: () => {},
      gskStatus: async () => ({ loggedIn: false }),
      onLanguageChanged: () => () => {},
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AiPanel, {
            api: api as never,
            filePath: '/docs/a.pdf',
            onCollapse: () => {},
            open: true,
          }),
        ),
      )
    })
    await settle()
    await openPickerAndRead(container)
  })
})
