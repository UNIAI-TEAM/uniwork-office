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

/** React-controlled inputs only see the value through the native setter */
function setNativeValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
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

describe('Settings › AI model: org-managed provider row (G6-05k)', () => {
  async function openAiPaneWithLocale(locale: 'en' | 'vi'): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { key: locale, initial: locale },
          createElement(SettingsModal, { onClose: vi.fn(), initialSection: 'aiModel' }),
        ),
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('renders an org provider as a read-only row in English and Vietnamese with no key or base-url inputs', async () => {
    const settings = stored('claude-sonnet-5', {
      chosen: 'claude-sonnet-5',
      origin: 'org',
      listed: CATALOG,
    })
    // Even if a caller passed a placeholder/hint in apiKey, it must not render as an input
    settings.providers.anthropic.apiKey = ''
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    installApi(settings)

    await openAiPaneWithLocale('en')

    expect(host.querySelector('#set-ai-key')).toBeNull()
    expect(host.querySelector('#set-ai-base-url')).toBeNull()
    const rowEn = host.querySelector<HTMLElement>('[data-org-key-row]')
    expect(rowEn).not.toBeNull()
    expect(rowEn!.querySelector('[data-org-key-tag]')?.textContent).toBe('Key on UniWork')
    expect(rowEn!.querySelector('[data-org-key-note]')?.textContent).toBe(
      "Sent through your organization's UniWork server with the key you saved on UniWork. UniWork records usage only and does not store the content.",
    )
    const manageBtnEn = rowEn!.querySelector<HTMLButtonElement>('[data-org-key-manage]')
    expect(manageBtnEn?.textContent).toBe('Manage keys on UniWork (web)')
    await click(manageBtnEn!)
    expect(openSpy).toHaveBeenCalledWith(
      'https://uniworkos.com/settings/ai',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()

    await openAiPaneWithLocale('vi')
    expect(host.querySelector('#set-ai-key')).toBeNull()
    expect(host.querySelector('#set-ai-base-url')).toBeNull()
    const rowVi = host.querySelector<HTMLElement>('[data-org-key-row]')
    expect(rowVi).not.toBeNull()
    expect(rowVi!.querySelector('[data-org-key-tag]')?.textContent).toBe('Khóa trên UniWork')
    expect(rowVi!.querySelector('[data-org-key-note]')?.textContent).toBe(
      'Gửi qua máy chủ UniWork của tổ chức bằng khóa bạn đã lưu trên UniWork. UniWork chỉ ghi số liệu sử dụng, không lưu nội dung.',
    )
    expect(rowVi!.querySelector('[data-org-key-manage]')?.textContent).toBe(
      'Quản lý khóa trên UniWork (web)',
    )
  })

  /** the model dropdown pick that marks the pane dirty, then Save; returns what was sent */
  async function pickOpusAndSave(): Promise<AiSettings> {
    const trigger = host.querySelector<HTMLButtonElement>('.gs-dd-btn[aria-label="Model"]')!
    await click(trigger)
    const opusOption = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.gs-dd-pop [role="option"]'),
    ).find((opt) => (opt.getAttribute('aria-label') ?? opt.textContent) === 'claude-opus-5')!
    await click(opusOption)
    const saveBtn = host.querySelector<HTMLButtonElement>('button.set-btn.primary')!
    expect(saveBtn.disabled).toBe(false)
    await click(saveBtn)
    const setAiSettingsMock = vi.mocked(window.aiOffice.setAiSettings)
    expect(setAiSettingsMock).toHaveBeenCalledTimes(1)
    return setAiSettingsMock.mock.calls[0][0]
  }

  it('saving Settings keeps the local key and base URL of the org provider and of every other provider byte-identical', async () => {
    const settings = stored('claude-sonnet-5', {
      chosen: 'claude-sonnet-5',
      origin: 'org',
      listed: CATALOG,
    })
    // a key typed on this machine earlier that is not "usable" yet, next to other local slots
    settings.providers.anthropic = {
      apiKey: 'sk-ant-local-9f2a',
      baseUrl: 'https://anthropic.local.example',
      model: '',
    }
    settings.providers.openai = {
      apiKey: 'sk-openai-local',
      baseUrl: 'https://openai.local.example/v1',
      model: 'gpt-local',
    }
    settings.providers.custom = { apiKey: '', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama' }
    const before = JSON.stringify(settings.providers)
    installApi(settings)

    await openAiPane()
    const saved = await pickOpusAndSave()

    // only the edited provider's model moved; no key or base URL slot was rewritten
    expect(saved.providers.anthropic).toEqual({
      apiKey: 'sk-ant-local-9f2a',
      baseUrl: 'https://anthropic.local.example',
      model: 'claude-opus-5',
    })
    expect(JSON.stringify({ ...saved.providers, anthropic: settings.providers.anthropic })).toBe(
      before,
    )
  })

  it('shows the model main resolved (modelSources chosen) for an org row, not a model left in the local slot', async () => {
    const settings = stored('claude-stale-local', {
      chosen: 'claude-sonnet-5',
      origin: 'org',
      listed: CATALOG,
    })
    settings.providers.anthropic = { apiKey: '', model: 'claude-stale-local' }
    installApi(settings)
    await openAiPane()
    const trigger = host.querySelector<HTMLButtonElement>('.gs-dd-btn[aria-label="Model"]')!
    expect(trigger.textContent).toContain('claude-sonnet-5')
    expect(trigger.textContent).not.toContain('claude-stale-local')
  })

  it('never writes the org-resolved model into the local slot of an untouched provider', async () => {
    const settings = stored('', { chosen: 'claude-sonnet-5', origin: 'org', listed: CATALOG })
    settings.providers.anthropic = { apiKey: '', model: '' }
    installApi(settings)
    await openAiPane()
    // the row shows the model main resolved
    const trigger = host.querySelector<HTMLButtonElement>('.gs-dd-btn[aria-label="Model"]')!
    expect(trigger.textContent).toContain('claude-sonnet-5')

    // an unrelated edit (output cap) makes the form dirty, then Save
    const cap = host.querySelector<HTMLInputElement>('#set-ai-max-tokens')!
    await act(async () => {
      setNativeValue(cap, '8192')
      cap.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await click(host.querySelector<HTMLButtonElement>('button.set-btn.primary')!)
    const sent = vi.mocked(window.aiOffice.setAiSettings).mock.calls[0][0]
    expect(sent.providers.anthropic.model).toBe('')
    expect(sent.providers.anthropic.apiKey).toBe('')
  })

  it('"use a key on this computer" opens the normal key and base URL fields; a typed key is sent on save', async () => {
    const settings = stored('claude-sonnet-5', {
      chosen: 'claude-sonnet-5',
      origin: 'org',
      listed: CATALOG,
    })
    settings.providers.anthropic.apiKey = ''
    installApi(settings)
    await openAiPane()

    const useLocal = host.querySelector<HTMLButtonElement>('[data-org-key-use-local]')!
    expect(useLocal.tagName).toBe('BUTTON')
    expect(useLocal.getAttribute('tabindex')).not.toBe('-1')
    expect(useLocal.textContent).toBe('Use a key on this computer')
    await click(useLocal)

    expect(host.querySelector('[data-org-key-row]')).toBeNull()
    const key = host.querySelector<HTMLInputElement>('#set-ai-key')!
    expect(key).not.toBeNull()
    expect(host.querySelector('#set-ai-base-url')).not.toBeNull()
    expect(host.querySelector(`label[for="set-ai-key"]`)).not.toBeNull()
    await act(async () => setNativeValue(key, 'sk-ant-new-local'))
    await click(host.querySelector<HTMLButtonElement>('button.set-btn.primary')!)

    const sent = vi.mocked(window.aiOffice.setAiSettings).mock.calls[0][0]
    expect(sent.providers.anthropic.apiKey).toBe('sk-ant-new-local')
  })

  it('cancel on the local key fields restores the read-only org row and drops the typed key', async () => {
    installApi(
      stored('claude-sonnet-5', { chosen: 'claude-sonnet-5', origin: 'org', listed: CATALOG }),
    )
    await openAiPane()
    await click(host.querySelector<HTMLButtonElement>('[data-org-key-use-local]')!)
    const key = host.querySelector<HTMLInputElement>('#set-ai-key')!
    await act(async () => setNativeValue(key, 'sk-ant-typed'))
    const cancel = host.querySelector<HTMLButtonElement>('[data-org-key-use-local-cancel]')!
    expect(cancel.textContent).toBe('Back to the key on UniWork')
    await click(cancel)

    expect(host.querySelector('#set-ai-key')).toBeNull()
    expect(host.querySelector('[data-org-key-row]')).not.toBeNull()
    expect(host.querySelector('[data-org-key-use-local]')).not.toBeNull()
    // a later save still carries the slot as it was loaded, not the typed text
    await click(host.querySelector<HTMLButtonElement>('button.set-btn.primary')!)
    const sent = vi.mocked(window.aiOffice.setAiSettings).mock.calls[0]?.[0]
    if (sent) expect(sent.providers.anthropic.apiKey).not.toBe('sk-ant-typed')
  })

  it.each([
    ['en', 'Use a key on this computer', 'Back to the key on UniWork'],
    ['vi', 'Dùng khóa trên máy này', 'Quay lại khóa trên UniWork'],
  ] as const)('labels the local key actions in %s', async (locale, useLocal, back) => {
    installApi(
      stored('claude-sonnet-5', { chosen: 'claude-sonnet-5', origin: 'org', listed: CATALOG }),
    )
    await openAiPaneWithLocale(locale)
    const action = host.querySelector<HTMLButtonElement>('[data-org-key-use-local]')!
    expect(action.textContent).toBe(useLocal)
    await click(action)
    expect(
      host.querySelector<HTMLButtonElement>('[data-org-key-use-local-cancel]')!.textContent,
    ).toBe(back)
  })

  it('opens the manage page on the signed-in server', async () => {
    installApi(
      stored('claude-sonnet-5', { chosen: 'claude-sonnet-5', origin: 'org', listed: CATALOG }),
    )
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(SettingsModal, {
            onClose: vi.fn(),
            initialSection: 'aiModel',
            account: { status: { serverUrl: 'https://org.example.com/' } } as never,
          }),
        ),
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await click(host.querySelector<HTMLButtonElement>('[data-org-key-manage]')!)
    expect(openSpy).toHaveBeenCalledWith(
      'https://org.example.com/settings/ai',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('keeps the editable API key input when origin is local or absent', async () => {
    installApi(
      stored('claude-sonnet-5', {
        chosen: 'claude-sonnet-5',
        origin: 'local',
        listed: CATALOG,
      }),
    )
    await openAiPane()
    expect(host.querySelector('[data-org-key-row]')).toBeNull()
    expect(host.querySelector<HTMLInputElement>('#set-ai-key')?.value).toBe('sk-ant-x')
  })
})
