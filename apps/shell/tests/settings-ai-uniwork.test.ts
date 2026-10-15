/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_PROVIDERS,
  defaultAiSettings,
  getProviderAdapter,
  setUniworkAiAvailable,
} from '@genoffice/ai-provider'
import type { AiSettings } from '@genoffice/ai-provider'
import type { AiCatalogEntry, HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'

/**
 * Settings > AI model with UniWork AI picked: there is no key, model or endpoint to set, so the
 * BYOK form (Model, API Key, Base URL, output cap, the "own key" helper, Test connection) is
 * replaced by one line. Switching back to a BYOK provider shows the form again with its values.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

/**
 * Real catalog shape from apps/shell/src/preload/index.ts `getAiProviders()`, captured in the
 * preload realm where `setUniworkAiAvailable` is never called (no `uniwork` row in the list).
 */
const PRELOAD_CATALOG: AiCatalogEntry[] = AI_PROVIDERS.map((meta) => {
  let defaultBaseUrl = ''
  if (meta.id !== 'genspark' && meta.id !== 'uniwork' && !meta.needsBaseUrl && !meta.needsCliPath) {
    defaultBaseUrl = getProviderAdapter(meta.id).resolveEndpoint({
      apiKey: '',
      model: meta.defaultModel,
    }).baseUrl
  }
  return { ...meta, defaultBaseUrl }
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  setUniworkAiAvailable(false)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  setUniworkAiAvailable(false)
  act(() => root.unmount())
  host.remove()
})

function storedSettings(provider: AiSettings['provider']): AiSettings {
  const settings = defaultAiSettings()
  settings.provider = provider
  settings.providers.openai = {
    apiKey: 'sk-test-key',
    model: 'test-model',
    baseUrl: 'http://127.0.0.1:8800/v1',
  }
  return settings
}

function installApi(
  settings: AiSettings,
  catalog: AiCatalogEntry[] = [
    {
      id: 'openai',
      label: 'OpenAI',
      models: [],
      defaultModel: '',
      keyPlaceholder: 'sk-…',
      defaultBaseUrl: 'https://api.openai.com/v1',
    },
  ],
): void {
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAiPanelPrefs: async () => ({ fontSize: 'medium', customFontSize: 14, spellcheck: true }),
    setAiPanelPrefs: async (patch: unknown) => patch,
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    getAiProviders: () => catalog.map((entry) => ({ ...entry, models: [...entry.models] })),
    getAiSettings: async () => settings,
    setAiSettings: async () => undefined,
  } as unknown as HomeApi
}

async function click(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

async function openAiPane(lang: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(SettingsModal, { onClose: vi.fn(), initialSection: 'aiModel' }),
      ),
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

function picker(label: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`.gs-dd-btn[aria-label="${label}"]`)
}

async function pickProvider(label: string): Promise<void> {
  await click(picker('Provider')!)
  const option = Array.from(
    host.querySelectorAll<HTMLButtonElement>('.gs-dd-pop [role="option"]'),
  ).find((button) => button.textContent?.includes(label))
  await click(option!)
}

const byokControls = (): Record<string, boolean> => ({
  model: host.querySelector('#set-ai-model') !== null,
  apiKey: host.querySelector('#set-ai-key') !== null,
  baseUrl: host.querySelector('#set-ai-base-url') !== null,
  maxTokens: host.querySelector('#set-ai-max-tokens') !== null,
  ownKeyNote: host.textContent?.includes('Chats use your own key') ?? false,
  testButton: Array.from(host.querySelectorAll('button')).some(
    (b) => b.textContent === 'Test connection',
  ),
})

describe('Settings AI model pane with UniWork AI picked', () => {
  it('hides the BYOK form and the connection test, and shows one line instead', async () => {
    installApi(storedSettings('uniwork'))
    await openAiPane()

    expect(picker('Provider')?.textContent).toContain('UniWork AI')
    expect(byokControls()).toEqual({
      model: false,
      apiKey: false,
      baseUrl: false,
      maxTokens: false,
      ownKeyNote: false,
      testButton: false,
    })
    expect(host.textContent).toContain(
      "UniWork AI uses your organization's plan. No key or model to set.",
    )
  })

  it('labels a uniwork pick as "UniWork AI" (never the raw id) with the real preload catalog', async () => {
    installApi(storedSettings('uniwork'), PRELOAD_CATALOG)
    await openAiPane()

    expect(PRELOAD_CATALOG.some((c) => c.id === 'uniwork')).toBe(false)
    expect(picker('Provider')?.textContent).toBe('UniWork AI')
  })

  it('says it in Vietnamese', async () => {
    installApi(storedSettings('uniwork'))
    await openAiPane('vi')

    expect(picker('Nhà cung cấp')?.textContent).toBe('UniWork AI')
    expect(host.textContent).toContain(
      'UniWork AI dùng gói của tổ chức bạn. Không cần nhập key hay chọn mô hình.',
    )
  })

  it('shows the form again, with its previous values, after switching to a BYOK provider', async () => {
    setUniworkAiAvailable(true)
    installApi(storedSettings('openai'))
    await openAiPane()

    expect(Object.values(byokControls()).every(Boolean)).toBe(true)
    expect(host.textContent).not.toContain('No key or model to set')
    expect(host.querySelector<HTMLInputElement>('#set-ai-key')?.value).toBe('sk-test-key')

    await pickProvider('UniWork AI')
    expect(picker('Provider')?.textContent).toBe('UniWork AI')
    expect(byokControls().apiKey).toBe(false)
    expect(host.textContent).toContain('No key or model to set')

    await pickProvider('OpenAI')
    expect(Object.values(byokControls()).every(Boolean)).toBe(true)
    expect(host.querySelector<HTMLInputElement>('#set-ai-key')?.value).toBe('sk-test-key')
    expect(host.querySelector<HTMLInputElement>('#set-ai-model')?.value).toBe('test-model')
    expect(host.querySelector<HTMLInputElement>('#set-ai-base-url')?.value).toBe(
      'http://127.0.0.1:8800/v1',
    )
    expect(host.textContent).not.toContain('No key or model to set')
  })
})
