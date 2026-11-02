/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
 * Settings never loses work silently: a backup restore, which replaces this device's
 * Workbench data, is confirmed before the file picker opens.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn>

beforeEach(() => {
  onClose = vi.fn()
  importWorkbenchBackupUi.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    getAiPanelPrefs: async () => ({ fontSize: 'medium', customFontSize: 14, spellcheck: true }),
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
