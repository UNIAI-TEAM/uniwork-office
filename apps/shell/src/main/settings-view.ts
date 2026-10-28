import { HOME_CHANNELS } from '../shared/home-api'
import type { LaunchPushTarget } from './uniwork-docs/launch'

export type SettingsSection = 'general' | 'aiModel'

export interface ShellSettingsWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  webContents: LaunchPushTarget
}

export interface OpenShellSettingsDeps {
  ensureTabManager: () => { openHomeTab(): void }
  getShellWindow: () => ShellSettingsWindow | null
}

/**
 * Open the shell's Settings view on the Home tab:
 * - If the shell window was closed while a detached editor remained alive,
 *   recreates it via `ensureTabManager()`.
 * - Restores/shows/focuses the shell window and opens the Home tab.
 * - Sends `openSettings` immediately if the shell renderer has loaded, or
 *   once `did-finish-load` fires when the window was just created.
 */
export function openShellSettingsView(
  deps: OpenShellSettingsDeps,
  section: SettingsSection = 'general',
): void {
  const manager = deps.ensureTabManager()
  const win = deps.getShellWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  manager.openHomeTab()
  const wc = win.webContents
  if (wc.isDestroyed()) return
  if (!wc.isLoadingMainFrame()) {
    wc.send(HOME_CHANNELS.openSettings, { section })
    return
  }
  wc.once('did-finish-load', () => {
    if (!wc.isDestroyed()) {
      wc.send(HOME_CHANNELS.openSettings, { section })
    }
  })
}
