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

const pendingSectionByWc = new WeakMap<LaunchPushTarget, SettingsSection>()

/**
 * Open the shell's Settings view on the Home tab:
 * - If the shell window was closed while a detached editor remained alive,
 *   recreates it via `ensureTabManager()`.
 * - Restores/shows/focuses the shell window and opens the Home tab.
 * - Sends `openSettings` immediately if the shell renderer has loaded, or
 *   coalesces repeated loading calls into one `did-finish-load` listener that
 *   sends the latest section once.
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
    pendingSectionByWc.delete(wc)
    wc.send(HOME_CHANNELS.openSettings, { section })
    return
  }
  const waiting = pendingSectionByWc.has(wc)
  pendingSectionByWc.set(wc, section)
  if (waiting) return
  wc.once('did-finish-load', () => {
    const latest = pendingSectionByWc.get(wc)
    pendingSectionByWc.delete(wc)
    if (latest !== undefined && !wc.isDestroyed()) {
      wc.send(HOME_CHANNELS.openSettings, { section: latest })
    }
  })
}
