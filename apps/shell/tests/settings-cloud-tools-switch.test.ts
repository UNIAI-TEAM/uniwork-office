/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type { AiSettings, UniworkCloudStatus } from '@genoffice/ai-provider'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'
import type { AccountController } from '../src/renderer/src/account-model'

/**
 * Settings has no own-key AI section any more: the one AI control left is the cloud tools switch,
 * under Account, offered only while the organization has UniWork cloud AI.
 */

vi.mock('../src/renderer/src/AccountPane', () => ({
  AccountPane: () => createElement('div', { 'data-testid': 'account-pane' }),
}))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let setAiSettings: ReturnType<typeof vi.fn>

const cloudOf = (enabled: boolean): UniworkCloudStatus => ({
  state: enabled ? 'ready' : 'not-entitled',
  enabled,
  tools: {
    web_search: enabled,
    image_search: enabled,
    image_generate: enabled,
    media_analyze: enabled,
    transcribe: enabled,
  },
  credits: null,
})

function install(cloud: UniworkCloudStatus, stored: Partial<AiSettings> = {}): void {
  setAiSettings = vi.fn(async () => undefined)
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAiPanelPrefs: async () => ({ fontSize: 'medium', customFontSize: 14, spellcheck: true }),
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    uniworkCloudStatus: async () => cloud,
    uniworkCloudRefresh: async () => cloud,
    getAiSettings: async () => ({ ...defaultAiSettings(), ...stored }),
    setAiSettings,
  } as unknown as HomeApi
}

async function open(): Promise<void> {
  const account = { status: { loggedIn: true } } as unknown as AccountController
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SettingsModal, { onClose: vi.fn(), account, initialSection: 'account' }),
      ),
    )
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const toggle = () => host.querySelector<HTMLButtonElement>('button[role="switch"]')

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Settings Account: cloud tools switch', () => {
  it('shows the switch, on by default, while the organization has cloud AI', async () => {
    install(cloudOf(true))
    await open()
    expect(toggle()?.getAttribute('aria-label')).toBe('Use UniWork cloud tools')
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
  })

  it('has no switch without cloud AI', async () => {
    install(cloudOf(false))
    await open()
    expect(toggle()).toBeNull()
  })

  it('saves gskToolsEnabled when it is turned off and on again', async () => {
    install(cloudOf(true), { gskToolsEnabled: true })
    await open()
    await act(async () => {
      toggle()!.click()
      await Promise.resolve()
    })
    expect(setAiSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ gskToolsEnabled: false }),
    )
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      toggle()!.click()
      await Promise.resolve()
    })
    expect(setAiSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ gskToolsEnabled: true }),
    )
  })

  it('starts off when the stored switch is off', async () => {
    install(cloudOf(true), { gskToolsEnabled: false })
    await open()
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
  })

  it('has no AI Model or AI Media section and no password field', async () => {
    install(cloudOf(true))
    await open()
    const labels = [...host.querySelectorAll('.set-nav-item')].map((b) => b.textContent)
    expect(labels.join('|')).not.toMatch(/AI Model|AI Media/)
    expect(host.querySelector('input[type="password"]')).toBeNull()
  })
})
