/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type { AiModelSource, AiSettings } from '@genoffice/ai-provider'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'

/**
 * G6-05m slice C: the Settings pane's Model dropdown offers the provider's live list (the same
 * `modelSources[p].listed` the composer chip reads) and falls back to the catalog when there is
 * none: no source (older host), an empty list, or a failed listing. Codex and custom endpoints keep
 * their own live paths.
 */

const CATALOG = ['claude-sonnet-5', 'claude-opus-5']

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function stored(model: string, source?: AiModelSource): AiSettings {
  const settings = defaultAiSettings()
  settings.provider = 'anthropic'
  settings.providers.anthropic = { apiKey: 'sk-ant-x', model }
  if (source) settings.modelSources = { anthropic: source }
  return settings
}

function installApi(settings: AiSettings): void {
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAiPanelPrefs: async () => ({ fontSize: 'medium', customFontSize: 14, spellcheck: true }),
    setAiPanelPrefs: async (patch: unknown) => patch,
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    getAiProviders: () => [
      {
        id: 'anthropic',
        label: 'Claude',
        models: CATALOG,
        defaultModel: 'claude-sonnet-5',
        keyPlaceholder: 'sk-ant',
        defaultBaseUrl: '',
      },
    ],
    getAiSettings: async () => settings,
    setAiSettings: vi.fn(async () => undefined),
  } as unknown as HomeApi
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

async function openAiPane(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SettingsModal, { onClose: vi.fn(), initialSection: 'aiModel' }),
      ),
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** the model ids the Model dropdown offers, in order */
async function modelOptions(): Promise<string[]> {
  const trigger = host.querySelector<HTMLButtonElement>('.gs-dd-btn[aria-label="Model"]')!
  await click(trigger)
  const options = Array.from(host.querySelectorAll<HTMLButtonElement>('.gs-dd-pop [role="option"]'))
  const labels = options.map((option) => option.getAttribute('aria-label') ?? option.textContent!)
  await click(trigger)
  return labels
}

describe('Settings › AI model: the Model dropdown', () => {
  it('offers the live list when the provider has one, the saved pick first', async () => {
    installApi(
      stored('claude-opus-5', {
        chosen: 'claude-opus-5',
        listed: ['claude-future-9', 'claude-opus-5'],
      }),
    )
    await openAiPane()
    expect(await modelOptions()).toEqual(['claude-opus-5', 'claude-future-9'])
  })

  it('keeps a saved pick the live list does not contain (it is still the saved model)', async () => {
    installApi(stored('claude-typed', { chosen: 'claude-typed', listed: ['claude-future-9'] }))
    await openAiPane()
    expect(await modelOptions()).toEqual(['claude-typed', 'claude-future-9'])
  })

  it('puts the effective default first when no model is saved and the live list lacks it', async () => {
    installApi(stored('', { chosen: '', listed: ['claude-future-9', 'claude-future-8'] }))
    await openAiPane()
    // the field must not read empty while the chip shows the default
    const trigger = host.querySelector<HTMLButtonElement>('.gs-dd-btn[aria-label="Model"]')!
    expect(trigger.textContent).toContain('claude-sonnet-5')
    expect(await modelOptions()).toEqual(['claude-sonnet-5', 'claude-future-9', 'claude-future-8'])
  })

  it.each([
    ['no source (an older host)', undefined],
    ['an empty list', { chosen: 'claude-sonnet-5', listed: [] }],
    ['a failed listing', { chosen: 'claude-sonnet-5', listState: 'error' as const }],
    ['a listing still loading', { chosen: 'claude-sonnet-5', listState: 'loading' as const }],
  ])('falls back to the catalog with %s', async (_name, source) => {
    installApi(stored('claude-sonnet-5', source))
    await openAiPane()
    expect(await modelOptions()).toEqual(CATALOG)
  })
})
