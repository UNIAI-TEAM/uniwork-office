/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'
import type { SettingsSectionId } from '../src/renderer/src/SettingsModal'

const importWorkbenchBackupUi = vi.fn(async () => ({ ok: true as const, keyCount: 3 }))
vi.mock('../src/renderer/src/workbench-store-client', () => ({
  importWorkbenchBackupUi: () => importWorkbenchBackupUi(),
  exportWorkbenchBackupUi: vi.fn(),
}))

/**
 * Settings never loses work silently: leaving an AI pane with unsaved edits asks
 * first, a refused save is reported in the pane (no window.alert), and a backup
 * restore — which replaces this device's Workbench data — is confirmed before
 * the file picker opens.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn>
let setAiSettings: ReturnType<typeof vi.fn>

beforeEach(() => {
  onClose = vi.fn()
  setAiSettings = vi.fn(async () => undefined)
  importWorkbenchBackupUi.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const settings = defaultAiSettings()
  settings.provider = 'custom'
  settings.providers.custom = { apiKey: '', model: 'm', baseUrl: '' }
  window.aiOffice = {
    getAiPanelPrefs: async () => ({ fontSize: 'medium', customFontSize: 14, spellcheck: true }),
    getAiProviders: () => [
      {
        id: 'custom',
        label: 'Custom',
        models: [],
        defaultModel: '',
        keyPlaceholder: 'API Key',
        needsBaseUrl: true,
        defaultBaseUrl: '',
      },
    ],
    getAiSettings: async () => settings,
    setAiSettings,
  } as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function open(section: SettingsSectionId): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SettingsModal, { onClose, initialSection: section }),
      ),
    )
    await Promise.resolve()
  })
}

async function click(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    ;(el as HTMLElement).click()
    await Promise.resolve()
  })
}

const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text)

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Settings leave guard', () => {
  it('asks before closing over unsaved AI edits; keep editing stays, discard closes', async () => {
    await open('aiModel')
    await typeInto(host.querySelector<HTMLInputElement>('#set-ai-model')!, 'other-model')

    await click(host.querySelector('.set-close'))
    expect(onClose).not.toHaveBeenCalled()
    expect(host.querySelector('.set-leave')?.textContent).toContain('Unsaved changes')

    await click(button('Keep editing'))
    expect(host.querySelector('.set-leave')).toBeNull()

    await click(host.querySelector('.set-close'))
    await click(button('Discard changes'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes at once when nothing is unsaved', async () => {
    await open('aiModel')
    await click(host.querySelector('.set-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports a refused save in the pane instead of an alert, and stays dirty', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    setAiSettings.mockRejectedValueOnce(new Error('disk full'))
    await open('aiModel')
    await typeInto(host.querySelector<HTMLInputElement>('#set-ai-model')!, 'other-model')
    await click(button('Save'))
    await act(async () => Promise.resolve())

    expect(alert).not.toHaveBeenCalled()
    expect(host.querySelector('.set-ai-status.err')?.textContent).toBe('Couldn’t save: disk full')
    await click(host.querySelector('.set-close'))
    expect(onClose).not.toHaveBeenCalled()
    alert.mockRestore()
  })
})

describe('Backup restore confirmation', () => {
  it('opens the picker only after the overwrite warning is confirmed', async () => {
    await open('backup')
    await click(button('Restore from ZIP…'))
    expect(importWorkbenchBackupUi).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('can’t be undone')

    await click(button('Cancel'))
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(importWorkbenchBackupUi).not.toHaveBeenCalled()

    await click(button('Restore from ZIP…'))
    await click(button('Choose backup file…'))
    await act(async () => Promise.resolve())
    expect(importWorkbenchBackupUi).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.set-backup-msg')?.textContent).toContain('Restored 3 items')
  })
})
