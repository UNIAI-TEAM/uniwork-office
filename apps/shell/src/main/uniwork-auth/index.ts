import { app, safeStorage, shell, type IpcMain, type WebContents } from 'electron'
import { safeExternalUrl } from '@genoffice/electron-utils'
import { HOME_CHANNELS, type AccountEntitlements } from '../../shared/home-api'
import { readAppSettings, writeAppSetting } from '../app-settings'
import { createCredentialStore } from './credentials'
import {
  callbackSchemeForChannel,
  isLoopbackHost,
  resolveDeploymentProfile,
  type DeploymentProfile,
} from './deployment'
import { AccountManager } from './manager'
import { createUniworkTransport } from './transport'

export { createAuthCallbackRouter, type AuthCallbackRouter } from './routing'
export type { AccountManager } from './manager'

/**
 * Electron wiring for the UniWork account: one AccountManager per process,
 * the account IPC channels, status pushes to every renderer that asked, and
 * the `uniwork-office[-dev]://` callback schemes. Logic lives in the
 * manager; this file only binds it to Electron.
 */

let manager: AccountManager | null = null
let settingsPath: (() => string) | null = null
const entitlementListeners = new Set<(entitlements: AccountEntitlements | null) => void>()
/** set by registerAccountIpc: delivers a push to the account renderers */
let push: ((channel: string, payload: unknown) => void) | null = null

/** Opens the authorization URL: https only, http just for loopback on the dev channel. */
export async function openAuthorizationUrl(url: string, profile: DeploymentProfile): Promise<void> {
  const allowHttp = profile.channel === 'dev'
  const safe = safeExternalUrl(url, {
    allowedProtocols: allowHttp ? ['https:', 'http:'] : ['https:'],
  })
  if (!safe) throw new Error('authorization URL refused')
  const parsed = new URL(safe)
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    throw new Error('authorization URL refused')
  }
  // E2E seam: a test drives the consent page itself from the `url` event
  if (!app.isPackaged && process.env.UNIWORK_AUTH_E2E_NO_BROWSER === '1') return
  await shell.openExternal(safe)
}

/** consent-page device metadata: windows | macos | linux, not Node's raw platform */
export function deviceInfo(
  platform: NodeJS.Platform,
  build: string,
): { label: string; platform: string; build: string } {
  const friendly = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform
  const name = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
  return { label: `UniWork Office (${name})`, platform: friendly, build }
}

/** Must be called once, before the first account call (the settings path is app-owned). */
export function configureUniworkAccount(options: { settingsPath: () => string }): void {
  settingsPath = options.settingsPath
}

/** The process-wide manager; created on first use, which is after app ready. */
export function uniworkAccount(): AccountManager {
  if (manager) return manager
  const settings = settingsPath
  if (!settings) throw new Error('UniWork account is not configured')
  const created = new AccountManager({
    resolveProfile: () =>
      resolveDeploymentProfile({
        resourcesDir: app.isPackaged ? process.resourcesPath : undefined,
        userDataDir: app.getPath('userData'),
        isPackaged: app.isPackaged,
        settingsApiOrigin: readAppSettings(settings()).uniworkApiOrigin,
      }),
    createTransport: (profile) => createUniworkTransport(profile),
    credentials: createCredentialStore({ userDataDir: app.getPath('userData'), safeStorage }),
    openBrowser: openAuthorizationUrl,
    readSelectedOrgId: () => readAppSettings(settings()).uniworkOrgId,
    persistSelectedOrgId: (orgId) => writeAppSetting(settings(), 'uniworkOrgId', orgId),
    device: deviceInfo(process.platform, app.getVersion()),
  })
  created.onStatus((status) => push?.(HOME_CHANNELS.accountStatusEvent, status))
  created.onLoginEvent((event) => push?.(HOME_CHANNELS.accountLoginEvent, event))
  created.onEntitlementsChanged((current) => {
    for (const listener of entitlementListeners) listener(current)
  })
  manager = created
  return created
}

/** Entitlements of the selected organization while signed in, else null (data only). */
export function getAccountEntitlements(): AccountEntitlements | null {
  return manager?.getEntitlements() ?? null
}

export function onAccountEntitlementsChanged(
  listener: (entitlements: AccountEntitlements | null) => void,
): () => void {
  entitlementListeners.add(listener)
  return () => entitlementListeners.delete(listener)
}

/** Bearer token for main-process cloud calls (refreshes when needed). Never send it over IPC. */
export async function getAccessToken(): Promise<string | null> {
  return manager ? manager.getAccessToken() : null
}

/**
 * Registers the callback scheme of the active profile's channel only, so a
 * dev run never re-points the installed stable app's `uniwork-office://`
 * (and a stable build never claims the dev scheme). No profile, no scheme.
 * The dev form passes execPath + appPath.
 */
export function registerAuthProtocols(profile: DeploymentProfile | null): void {
  if (!profile) return
  const scheme = callbackSchemeForChannel(profile.channel)
  if (!app.isPackaged) app.setAsDefaultProtocolClient(scheme, process.execPath, [app.getAppPath()])
  else app.setAsDefaultProtocolClient(scheme)
}

/**
 * Registers the callback scheme and restores the session without blocking
 * startup; the restore waits for `ready` (the main-process proxy install).
 */
export function startUniworkAccount(ready: Promise<unknown> = Promise.resolve()): void {
  const account = uniworkAccount()
  registerAuthProtocols(account.deploymentProfile())
  void account.startupRestore(ready)
}

/** Stops the account timers (refresh, recovery, attempt) at quit. */
export function stopUniworkAccount(): void {
  manager?.dispose()
}

/**
 * Account IPC. Status and login progress are pushed to the shell window and
 * to every renderer that called an account channel; payloads never carry a
 * token.
 */
export function registerAccountIpc(
  ipcMain: IpcMain,
  shellContents: () => WebContents | null,
): void {
  const subscribers = new Set<WebContents>()
  push = (channel, payload) => {
    const all = new Set(subscribers)
    const shellWc = shellContents()
    if (shellWc) all.add(shellWc)
    for (const wc of all) if (!wc.isDestroyed()) wc.send(channel, payload)
  }
  const account = (sender: WebContents) => {
    if (!sender.isDestroyed() && !subscribers.has(sender)) {
      subscribers.add(sender)
      sender.once('destroyed', () => subscribers.delete(sender))
    }
    return uniworkAccount()
  }

  ipcMain.handle(HOME_CHANNELS.accountStatus, (event) => account(event.sender).status())
  ipcMain.handle(HOME_CHANNELS.accountLogin, (event) => account(event.sender).login())
  ipcMain.handle(HOME_CHANNELS.accountLoginOpenUrl, (event) => account(event.sender).openLoginUrl())
  ipcMain.handle(HOME_CHANNELS.accountLogout, async (event) => {
    await account(event.sender).logout()
  })
  ipcMain.handle(HOME_CHANNELS.accountCancelLogin, (event) => {
    account(event.sender).cancelLogin()
  })
  ipcMain.handle(HOME_CHANNELS.accountRetry, (event) => account(event.sender).retry())
  ipcMain.handle(HOME_CHANNELS.accountSelectOrg, (event, orgId: unknown) => {
    const current = account(event.sender)
    return typeof orgId === 'string' ? current.selectOrg(orgId) : current.status()
  })
}

/**
 * Hands a sign-in callback URL to the manager. Returns false for any other
 * URL so the caller keeps routing it (e.g. to the office bridge).
 */
export function routeAuthCallbackUrl(url: unknown): boolean {
  if (!settingsPath) return false
  return uniworkAccount().handleCallbackUrl(url)
}
