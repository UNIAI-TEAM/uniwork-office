/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { HOME_CHANNELS, type HomeApi } from '../src/shared/home-api'
import { openShellSettingsView } from '../src/main/settings-view'
import { LocaleProvider, type Lang } from '../src/renderer/src/locale'
import { SettingsModal, type SettingsSectionId } from '../src/renderer/src/SettingsModal'
import { shellPrefsStrings } from '../src/renderer/src/i18n/strings-shell-prefs'
import { settingsStrings } from '../src/renderer/src/i18n/strings-settings'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { strings } from '../src/renderer/src/strings'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
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

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function openSettings(
  section: SettingsSectionId,
  api: Partial<HomeApi> = {},
  lang: Lang = 'en',
): Promise<void> {
  window.aiOffice = {
    getTheme: async () => 'system',
    getDocumentTheme: async () => 'follow',
    getDefaultSaveDir: async () => '',
    getAutoSaveDefault: async () => ({ on: false }),
    getAiPanelPrefs: async () => ({
      side: 'right',
      fontSize: 'default',
      customFontSize: 13,
      spellcheck: true,
      showAiSidebar: true,
      openInNewDocs: false,
    }),
    setAiPanelPrefs: async (patch) => ({
      side: 'right',
      fontSize: 'default',
      customFontSize: 13,
      spellcheck: true,
      showAiSidebar: true,
      openInNewDocs: false,
      ...patch,
    }),
    getUpdateChannel: async () => 'stable',
    getPinnedUpdateChannel: async () => null,
    getAppVersion: async () => '1.0.0',
    getUpdateState: async () => null,
    ...api,
  } as unknown as HomeApi

  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(SettingsModal, {
          onClose: vi.fn(),
          initialSection: section,
        }),
      ),
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findSwitchByLabel(label: string): HTMLButtonElement | null {
  return (
    Array.from(host.querySelectorAll<HTMLButtonElement>('button[role="switch"]')).find(
      (btn) => btn.getAttribute('aria-label') === label,
    ) ?? null
  )
}

const referenceKeys = Object.keys(shellPrefsStrings.zh).sort()

describe('shell-prefs string shard', () => {
  it('covers every UI language (21)', () => {
    expect(Object.keys(shellPrefsStrings).sort()).toEqual([...LANGS].sort())
    expect(LANGS).toHaveLength(21)
  })

  it.each([...LANGS])('locale %s has exactly the zh key set, no empty values', (lang) => {
    const table = shellPrefsStrings[lang] as Record<string, string>
    expect(Object.keys(table).sort()).toEqual(referenceKeys)
    expect(Object.entries(table).filter(([, v]) => !v.trim())).toEqual([])
  })

  it.each([...LANGS])('locale %s names no upstream brand, git or internal codes', (lang) => {
    const bad = Object.values(shellPrefsStrings[lang]).filter((v) =>
      /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d/i.test(v),
    )
    expect(bad).toEqual([])
  })

  it('does not collide with the home table, settings shard, or account shard', () => {
    expect(
      referenceKeys.filter(
        (k) => k in strings.zh || k in settingsStrings.zh || k in accountStrings.zh,
      ),
    ).toEqual([])
  })
})

describe('Settings > General: reopen last session row', () => {
  it('loads off by default right after Auto-save and toggles via setRestoreLastSession', async () => {
    const setRestoreLastSession = vi.fn(async (_on: boolean) => undefined)
    await openSettings('general', {
      getRestoreLastSession: async () => false,
      setRestoreLastSession,
    })

    const labels = Array.from(host.querySelectorAll<HTMLElement>('.set-field-label')).map(
      (el) => el.textContent,
    )
    const autoSaveIdx = labels.indexOf('Auto-save all documents')
    const restoreIdx = labels.indexOf(shellPrefsStrings.en.setRestoreSession)
    expect(autoSaveIdx).toBeGreaterThanOrEqual(0)
    expect(restoreIdx).toBe(autoSaveIdx + 1)

    const sw = findSwitchByLabel(shellPrefsStrings.en.setRestoreSession)
    expect(sw).not.toBeNull()
    expect(sw!.getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).toContain(shellPrefsStrings.en.setRestoreSessionDesc)

    await click(sw!)
    expect(setRestoreLastSession).toHaveBeenCalledWith(true)
    expect(sw!.getAttribute('aria-checked')).toBe('true')

    await click(sw!)
    expect(setRestoreLastSession).toHaveBeenCalledWith(false)
    expect(sw!.getAttribute('aria-checked')).toBe('false')
  })

  it('reverts the switch when setRestoreLastSession rejects', async () => {
    const setRestoreLastSession = vi.fn(async () => {
      throw new Error('disk full')
    })
    await openSettings('general', {
      getRestoreLastSession: async () => false,
      setRestoreLastSession,
    })

    const sw = findSwitchByLabel(shellPrefsStrings.en.setRestoreSession)!
    expect(sw.getAttribute('aria-checked')).toBe('false')

    await click(sw)
    expect(setRestoreLastSession).toHaveBeenCalledWith(true)
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('renders Vietnamese strings in the vi locale', async () => {
    await openSettings('general', { getRestoreLastSession: async () => true }, 'vi')
    const sw = findSwitchByLabel(shellPrefsStrings.vi.setRestoreSession)
    expect(sw).not.toBeNull()
    expect(sw!.getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain(shellPrefsStrings.vi.setRestoreSessionDesc)
  })
})

describe('Settings > About: automatic update checks row', () => {
  it('is hidden when getAutoUpdateCheck returns supported: false', async () => {
    await openSettings('about', {
      getAutoUpdateCheck: async () => ({ on: true, supported: false }),
    })

    expect(findSwitchByLabel(shellPrefsStrings.en.setAutoUpdateCheck)).toBeNull()
    expect(host.textContent).not.toContain(shellPrefsStrings.en.setAutoUpdateCheck)
    expect(host.textContent).not.toContain(shellPrefsStrings.en.setAutoUpdateCheckDesc)
  })

  it('renders after the update channel field and toggles when supported: true', async () => {
    const setAutoUpdateCheck = vi.fn(async (_on: boolean) => undefined)
    await openSettings('about', {
      getAutoUpdateCheck: async () => ({ on: true, supported: true }),
      setAutoUpdateCheck,
    })

    const labels = Array.from(host.querySelectorAll<HTMLElement>('.set-field-label')).map(
      (el) => el.textContent,
    )
    const channelIdx = labels.indexOf('Update channel')
    const updateCheckIdx = labels.indexOf(shellPrefsStrings.en.setAutoUpdateCheck)
    expect(channelIdx).toBeGreaterThanOrEqual(0)
    expect(updateCheckIdx).toBe(channelIdx + 1)

    const sw = findSwitchByLabel(shellPrefsStrings.en.setAutoUpdateCheck)
    expect(sw).not.toBeNull()
    expect(sw!.getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain(shellPrefsStrings.en.setAutoUpdateCheckDesc)

    await click(sw!)
    expect(setAutoUpdateCheck).toHaveBeenCalledWith(false)
    expect(sw!.getAttribute('aria-checked')).toBe('false')

    await click(sw!)
    expect(setAutoUpdateCheck).toHaveBeenCalledWith(true)
    expect(sw!.getAttribute('aria-checked')).toBe('true')
  })

  it('reverts the switch when setAutoUpdateCheck rejects', async () => {
    const setAutoUpdateCheck = vi.fn(async () => {
      throw new Error('unwritable')
    })
    await openSettings('about', {
      getAutoUpdateCheck: async () => ({ on: true, supported: true }),
      setAutoUpdateCheck,
    })

    const sw = findSwitchByLabel(shellPrefsStrings.en.setAutoUpdateCheck)!
    expect(sw.getAttribute('aria-checked')).toBe('true')

    await click(sw)
    expect(setAutoUpdateCheck).toHaveBeenCalledWith(false)
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('renders Vietnamese strings in the vi locale when supported: true', async () => {
    await openSettings(
      'about',
      {
        getAutoUpdateCheck: async () => ({ on: false, supported: true }),
      },
      'vi',
    )
    const sw = findSwitchByLabel(shellPrefsStrings.vi.setAutoUpdateCheck)
    expect(sw).not.toBeNull()
    expect(sw!.getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).toContain(shellPrefsStrings.vi.setAutoUpdateCheckDesc)
  })
})

describe('openShellSettingsView (main-process Settings action)', () => {
  it('recreates the shell window via ensureTabManager, opens Home, and sends openSettings after did-finish-load when the shell window was closed', () => {
    const loadListeners: Array<() => void> = []
    const mockWin = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isDestroyed: vi.fn(() => false),
        isLoadingMainFrame: vi.fn(() => true),
        send: vi.fn(),
        once: vi.fn((event: string, cb: () => void) => {
          if (event === 'did-finish-load') loadListeners.push(cb)
        }),
      },
    }
    let currentWin: typeof mockWin | null = null
    const openHomeTab = vi.fn()
    const ensureTabManager = vi.fn(() => {
      currentWin = mockWin
      return { openHomeTab }
    })

    openShellSettingsView({
      ensureTabManager,
      getShellWindow: () => currentWin,
    })

    expect(ensureTabManager).toHaveBeenCalledOnce()
    expect(openHomeTab).toHaveBeenCalledOnce()
    expect(mockWin.show).toHaveBeenCalledOnce()
    expect(mockWin.focus).toHaveBeenCalledOnce()
    expect(mockWin.webContents.send).not.toHaveBeenCalled()
    expect(loadListeners).toHaveLength(1)

    mockWin.webContents.isLoadingMainFrame.mockReturnValue(false)
    loadListeners[0]!()
    expect(mockWin.webContents.send).toHaveBeenCalledWith(HOME_CHANNELS.openSettings, {
      section: 'general',
    })
  })

  it('restores a minimized existing shell window and sends openSettings immediately when loaded', () => {
    const mockWin = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isDestroyed: vi.fn(() => false),
        isLoadingMainFrame: vi.fn(() => false),
        send: vi.fn(),
        once: vi.fn(),
      },
    }
    const openHomeTab = vi.fn()

    openShellSettingsView(
      {
        ensureTabManager: () => ({ openHomeTab }),
        getShellWindow: () => mockWin,
      },
      'aiModel',
    )

    expect(mockWin.restore).toHaveBeenCalledOnce()
    expect(mockWin.show).toHaveBeenCalledOnce()
    expect(mockWin.focus).toHaveBeenCalledOnce()
    expect(openHomeTab).toHaveBeenCalledOnce()
    expect(mockWin.webContents.send).toHaveBeenCalledWith(HOME_CHANNELS.openSettings, {
      section: 'aiModel',
    })
  })

  it('coalesces repeated calls while loading into one listener and one send of the latest section, with no replay on a later load', () => {
    const loadListeners: Array<() => void> = []
    const mockWin = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isDestroyed: vi.fn(() => false),
        isLoadingMainFrame: vi.fn(() => true),
        send: vi.fn(),
        once: vi.fn((event: string, cb: () => void) => {
          if (event === 'did-finish-load') loadListeners.push(cb)
        }),
      },
    }
    const openHomeTab = vi.fn()
    const deps = {
      ensureTabManager: () => ({ openHomeTab }),
      getShellWindow: () => mockWin,
    }

    openShellSettingsView(deps, 'general')
    openShellSettingsView(deps, 'aiModel')
    openShellSettingsView(deps, 'general')

    expect(mockWin.webContents.once).toHaveBeenCalledTimes(1)
    expect(loadListeners).toHaveLength(1)
    expect(mockWin.webContents.send).not.toHaveBeenCalled()

    mockWin.webContents.isLoadingMainFrame.mockReturnValue(false)
    const firstFinishLoad = loadListeners[0]!
    firstFinishLoad()
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(1)
    expect(mockWin.webContents.send).toHaveBeenCalledWith(HOME_CHANNELS.openSettings, {
      section: 'general',
    })

    // Re-invoking the load callback (or a later load event) does not replay
    firstFinishLoad()
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(1)
  })
})
