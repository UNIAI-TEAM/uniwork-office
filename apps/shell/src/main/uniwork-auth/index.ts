import { app, net, safeStorage, shell, type IpcMain, type WebContents } from 'electron'
import {
  onUniworkCloudStatus,
  setUniworkAiAvailable,
  setUniworkChatTransport,
  setUniworkCloudRefresher,
  setUniworkCloudStatus,
  setUniworkCloudTransport,
  uniworkChatTransport,
  uniworkCloudEnabled,
  uniworkConversations,
} from '@genoffice/ai-provider'
import { safeExternalUrl } from '@genoffice/electron-utils'
import { getUiLang } from '@genoffice/i18n'
import { HOME_CHANNELS, type AccountEntitlements, type AccountStatus } from '../../shared/home-api'
import { readAppSettings, writeAppSetting } from '../app-settings'
import { createCredentialStore } from './credentials'
import {
  callbackSchemeForChannel,
  isLoopbackHost,
  readBuildDefaults,
  resolveDeploymentProfile,
  type DeploymentChannel,
  type DeploymentProfile,
  type ResolveDeploymentOptions,
} from './deployment'
import {
  createProfileApplier,
  serializeProfileApplies,
  profileFromAddress,
  writeUserProfile,
  type ServerAddressError,
} from './profile-store'
import { createUniworkCloudClient, UniworkCloudController, type CloudAccountView } from './cloud'
import {
  createUniworkAiAvailability,
  createUniworkAiChatTransport,
  createUniworkAiStreams,
  resolveUniworkAiScope,
  type UniworkAiScopeDeps,
  type UniworkAiStreams,
} from './ai-chat'
import {
  createUniworkKeysHost,
  type LocalModelChoice,
  type ModelPickStore,
  type UniworkKeysHost,
} from './keys'
import type { CapabilityRead } from '../uniwork-sync/capability/cache'
import { AccountManager } from './manager'
import { TransportError, createUniworkTransport } from './transport'

export {
  bindAuthCallbackEvents,
  createAuthCallbackRouter,
  type AuthCallbackRouter,
} from './routing'
export type { AccountManager } from './manager'
export { TransportError } from './transport'
export type { DeploymentProfile } from './deployment'
export {
  createUniworkKeysHost,
  UniworkKeyError,
  isUniworkKeyError,
  describeUniworkKeyError,
  parseCredentialsResponse,
  type UniworkKeysHost,
  type UniworkKeysHostDeps,
  type UniworkCredentialItem,
  type UniworkCredentialsResponse,
  type UniworkKeyErrorCode,
} from './keys'

const UNIWORK_KEYS_HOST_SYMBOL = Symbol.for('genoffice.uniworkKeysHost')
const BROADCAST_AI_SETTINGS_SYMBOL = Symbol.for('genoffice.broadcastAiSettingsChanged')

/**
 * Electron wiring for the UniWork account: one AccountManager per process,
 * the account IPC channels, status pushes to every renderer that asked, and
 * the `uniwork-office[-dev]://` callback schemes. Logic lives in the
 * manager; this file only binds it to Electron.
 */

let manager: AccountManager | null = null
let cloud: UniworkCloudController | null = null
let keys: UniworkKeysHost | null = null
let settingsPath: (() => string) | null = null
const entitlementListeners = new Set<(entitlements: AccountEntitlements | null) => void>()
/** set by registerAccountIpc: delivers a push to the account renderers */
let push: ((channel: string, payload: unknown) => void) | null = null
let signOutHooks: UniworkSignOutHooks | null = null
let aiStreams: UniworkAiStreams | null = null

/**
 * What an explicit Sign out does around the account itself: `before` closes
 * the account's documents (false = the user cancelled a prompt, so the
 * sign-out does not happen), `after` clears what the next person must not see.
 */
export interface UniworkSignOutHooks {
  before(): Promise<boolean>
  after(): void
}

export function setUniworkSignOutHooks(hooks: UniworkSignOutHooks | null): void {
  signOutHooks = hooks
}

/** Sign out from the account UI: the hooks around AccountManager.logout. */
export async function signOutUniwork(account: AccountManager): Promise<AccountStatus> {
  const hooks = signOutHooks
  if (hooks && !(await hooks.before())) return account.status()
  const status = await account.logout()
  // the session is gone: every UniWork AI turn still running ends now (aiErrSession)
  endUniworkAiSession()
  try {
    hooks?.after()
  } catch (error) {
    console.warn('[uniwork-auth] sign-out cleanup failed:', error)
  }
  return status
}

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

function resolveOptions(): ResolveDeploymentOptions {
  const settings = settingsPath
  return {
    resourcesDir: app.isPackaged ? process.resourcesPath : undefined,
    userDataDir: app.getPath('userData'),
    isPackaged: app.isPackaged,
    settingsApiOrigin: settings ? readAppSettings(settings()).uniworkApiOrigin : undefined,
  }
}

/** The channel of this build (its launch scheme); known before any server is chosen. */
export function uniworkAppChannel(): DeploymentChannel {
  return readBuildDefaults(resolveOptions()).channel
}

/**
 * The server a web link names, or the address the user typed (`confirmed`).
 * `confirm` asks the one "Connect UniWork Office to <origin>?" question when
 * the server is new or another deployment; then the old sign-in ends (its
 * documents close first) and the userData profile is written before the
 * account moves. Anything but applied / unchanged means nothing changed.
 * One change runs at a time (see serializeProfileApplies).
 */
export const applyUniworkProfile = serializeProfileApplies(
  (
    incoming: DeploymentProfile,
    options: { confirm(origin: string): Promise<boolean>; confirmed?: boolean },
  ) => {
    const account = uniworkAccount()
    return createProfileApplier({
      appChannel: uniworkAppChannel,
      current: () => account.deploymentProfile(),
      confirm: options.confirm,
      endSession: async () => {
        await signOutUniwork(account)
        // the sign-out hooks may be cancelled by the user: the session then stays
        return account.sessionIdentity() === null
      },
      save: (profile) => writeUserProfile(app.getPath('userData'), profile),
      adopt: async (profile) => {
        await account.adoptProfile(profile)
      },
    }).apply(incoming, { confirmed: options.confirmed })
  },
)

/** Settings / connect screen: a typed address becomes the profile (no second question). */
export async function connectUniworkServer(
  address: string,
): Promise<{ ok: true } | { ok: false; error: ServerAddressError | 'refused' }> {
  const found = await profileFromAddress(address, uniworkAppChannel())
  if (!found.ok) return found
  const outcome = await applyUniworkProfile(found.profile, {
    confirm: () => Promise.resolve(true),
    confirmed: true,
  })
  return outcome === 'applied' || outcome === 'unchanged'
    ? { ok: true }
    : { ok: false, error: 'refused' }
}

/** The process-wide manager; created on first use, which is after app ready. */
export function uniworkAccount(): AccountManager {
  if (manager) return manager
  const settings = settingsPath
  if (!settings) throw new Error('UniWork account is not configured')
  const created = new AccountManager({
    resolveProfile: () => resolveDeploymentProfile(resolveOptions()),
    createTransport: (profile) => createUniworkTransport(profile),
    credentials: createCredentialStore({ userDataDir: app.getPath('userData'), safeStorage }),
    openBrowser: openAuthorizationUrl,
    // G8-16 S16: the remembered organization is per account + machine, so a
    // choice made by one account is never read back for another on this install
    readSelectedOrgId: () => readAppSettings(settings()).uniworkOrgId,
    persistSelectedOrgId: (accountId, orgId) =>
      writeAppSetting(settings(), 'uniworkOrgId', { accountId, orgId }),
    device: deviceInfo(process.platform, app.getVersion()),
  })
  created.onStatus((status) => {
    keys?.onAccountStatus(status)
    push?.(HOME_CHANNELS.accountStatusEvent, status)
  })
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

/**
 * G8-02: display name of the signed-in account, or null when signed out (or
 * the profile carries no usable name). Read-only: never a token, never the OS
 * account. This is the single author source for comment authorship.
 */
export function uniworkAccountDisplayName(): string | null {
  if (!manager) return null
  const status = manager.status()
  if (!status.loggedIn) return null
  const name = status.profile?.displayName.trim()
  return name ? name : null
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

function cloudAccountView(): CloudAccountView {
  if (!manager) return { signedIn: false, orgId: null }
  const status = manager.status()
  const email = status.profile?.email ?? status.email
  const planName = status.entitlements?.planName
  return {
    signedIn: status.loggedIn,
    orgId: status.org?.id ?? null,
    ...(email ? { email } : {}),
    ...(planName ? { planName } : {}),
  }
}

/**
 * The process-wide UniWork cloud controller: calls go out from main with the
 * account's bearer token; every status it publishes is token-free and lands
 * in this process's ai-provider seam (the editors' main code) and in the
 * account renderers.
 */
export function uniworkCloud(): UniworkCloudController {
  if (cloud) return cloud
  const account = uniworkAccount()
  cloud = new UniworkCloudController({
    client: createUniworkCloudClient({
      profile: () => account.deploymentProfile(),
      orgId: () => account.status().org?.id ?? null,
      withAccessToken: (call) => account.withAccessToken(call),
      // the server answers media analysis in vi or en; every other UI language gets en
      locale: () => (getUiLang() === 'vi' ? 'vi' : 'en'),
    }),
    account: cloudAccountView,
    // a 403/404 on the cloud routes may mean the membership changed: reload orgs and plan
    refreshAccount: () => account.retry(),
    publish: (status) => {
      setUniworkCloudStatus(status)
      push?.(HOME_CHANNELS.uniworkCloudStatusEvent, status)
    },
  })
  return cloud
}

/**
 * Organization AI keys (G6-05k, desktop BYOK proxy): R1/R5 client, per-org
 * cache, per-call fetch via toProxyRequest + authorized(), and stream abort
 * on sign-out / org switch / device_revoked.
 */
export function uniworkKeys(): UniworkKeysHost {
  if (keys) return keys
  const account = uniworkAccount()
  keys = createUniworkKeysHost({
    profile: () => account.deploymentProfile(),
    orgId: () => {
      const status = account.status()
      return status.state === 'signed-in' && !status.needsOrgChoice
        ? (status.org?.id ?? null)
        : null
    },
    sessionKey: () => identityKey(),
    accountKey: () => {
      const identity = uniworkSessionIdentity()
      return identity ? `${identity.deploymentId}/${identity.accountId}` : null
    },
    modelPicks: settingsPath ? appSettingsModelPicks(settingsPath) : undefined,
    authorized: (call) => authorizedRequest(call),
    online: () => (typeof net?.isOnline === 'function' ? net.isOnline() : true),
    onChanged: () => {
      const broadcast = (globalThis as Record<symbol, unknown>)[BROADCAST_AI_SETTINGS_SYMBOL]
      if (typeof broadcast === 'function') (broadcast as () => void)()
    },
    // the server said the device is revoked: the account's own refresh gets the same answer and
    // runs the shell's signed-out flow (status push, documents, UniWork AI turns)
    onDeviceRevoked: () => void account.refresh().catch(() => undefined),
  })
  ;(globalThis as Record<symbol, unknown>)[UNIWORK_KEYS_HOST_SYMBOL] = keys
  return keys
}

/** app-settings key of the desktop model picks for models served by keys saved on UniWork */
const MODEL_PICKS_SETTING = 'uniworkAiModelPicks'

/**
 * The desktop model pick per account + organization (contract §6.1), in app-settings.json beside
 * the remembered organization: never in ai-settings.json, never a key.
 */
function appSettingsModelPicks(path: () => string): ModelPickStore {
  const readAll = (): Record<string, Partial<Record<string, LocalModelChoice>>> => {
    const raw = readAppSettings(path())[MODEL_PICKS_SETTING]
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, Partial<Record<string, LocalModelChoice>>>)
      : {}
  }
  return {
    read: (scope) => {
      const picks = readAll()[scope]
      return picks && typeof picks === 'object' ? picks : {}
    },
    write: (scope, provider, choice) => {
      const all = readAll()
      writeAppSetting(path(), MODEL_PICKS_SETTING, {
        ...all,
        [scope]: { ...all[scope], [provider]: choice },
      })
    },
  }
}

export function startUniworkKeys(): UniworkKeysHost {
  const host = uniworkKeys()
  void host.list().catch(() => undefined)
  return host
}

/**
 * Installs the cloud transport and keeps the status current: re-read on
 * sign-in / sign-out / organization or plan change (entitlements), after
 * every tool call (credits), and once now.
 */
export function startUniworkCloud(): void {
  const controller = uniworkCloud()
  startUniworkKeys()
  setUniworkCloudTransport(controller.transport())
  // a cloud tool or an AI panel that finds the cloud off re-reads it first (the plan may have changed since)
  setUniworkCloudRefresher(() => controller.refresh())
  onAccountEntitlementsChanged(() => void controller.refresh().catch(() => undefined))
  void controller.refresh().catch(() => undefined)
}

/**
 * UniWork AI (G6-05, desktop): installs the chat transport the adapter posts
 * through (device bearer added per call, never sent over IPC) and returns
 * the ai:stream runner of the `uniwork` provider. Every running turn ends
 * when the session ends or the account changes. `describe` / `binding` /
 * `capability` come from the tab manager and the UniWork documents handle.
 */
export function startUniworkAiChat(deps: {
  describe: UniworkAiScopeDeps['describe']
  binding: UniworkAiScopeDeps['binding']
  capability(orgId: string): Promise<CapabilityRead>
}): UniworkAiStreams {
  if (aiStreams) return aiStreams
  const account = uniworkAccount()
  startUniworkKeys()
  setUniworkChatTransport(
    createUniworkAiChatTransport({
      profile: () => account.deploymentProfile(),
      authorized: (call) => authorizedRequest(call),
      online: () => net.isOnline(),
    }),
  )
  const availability = createUniworkAiAvailability({
    cloud: () => uniworkCloud().status(),
    capability: deps.capability,
  })
  const streams = createUniworkAiStreams({
    transport: () => (uniworkSessionIdentity() ? uniworkChatTransport() : null),
    scope: (senderId) =>
      resolveUniworkAiScope(senderId, {
        describe: deps.describe,
        binding: deps.binding,
        orgId: () => {
          // the chosen organization of a live session; none while the picker is up
          const status = account.status()
          return status.state === 'signed-in' && !status.needsOrgChoice
            ? (status.org?.id ?? null)
            : null
        },
      }),
    available: (scope, orgId) => availability.available(orgId, scope.format),
    // cloud tools go out with a turn only while the org has office.ai_cloud
    toolPolicy: () => ({ cloudTools: uniworkCloudEnabled() }),
  })
  aiStreams = streams
  // the provider entry (picker, Settings, selectedProvider) shows only while the
  // selected org offers UniWork AI for some format; re-read on account and cloud
  // changes and once per capability TTL
  let generation = 0
  const publishAvailability = () => {
    const run = ++generation
    const status = account.status()
    const orgId =
      status.state === 'signed-in' && !status.needsOrgChoice ? (status.org?.id ?? null) : null
    void availability
      .availableAny(orgId)
      .catch(() => false)
      .then((available) => {
        if (run !== generation) return
        setUniworkAiAvailable(available)
        // each renderer has its own provider list: tell them when the flag moves
        if (available !== lastAiFlag) {
          lastAiFlag = available
          aiFlagListener?.(available)
        }
      })
  }
  // a session that ends (expiry, revoke) or a switch to another account ends the turns too
  let owner = identityKey()
  account.onStatus(() => {
    const next = identityKey()
    if (next !== owner) endUniworkAiSession()
    owner = next
    publishAvailability()
  })
  onUniworkCloudStatus(() => publishAvailability())
  availabilityTimer = setInterval(publishAvailability, AVAILABILITY_REREAD_MS)
  availabilityTimer.unref?.()
  publishAvailability()
  return streams
}

let lastAiFlag = false
let aiFlagListener: ((available: boolean) => void) | null = null

/** Main wires the broadcast to every renderer here (see ../uniwork-ai-flag). */
export function setUniworkAiFlagListener(listener: ((available: boolean) => void) | null): void {
  aiFlagListener = listener
}

/** the capability TTL: the flag is re-read at least this often */
const AVAILABILITY_REREAD_MS = 300_000
let availabilityTimer: ReturnType<typeof setInterval> | null = null

/** sign-out / account switch: running turns end and the server conversation ids are forgotten */
function endUniworkAiSession(): void {
  aiStreams?.cancelAll()
  keys?.clear()
  uniworkConversations.clear()
}

function identityKey(): string {
  const identity = uniworkSessionIdentity()
  return identity
    ? `${identity.deploymentId}/${identity.accountId}/${identity.deviceSessionId}`
    : ''
}

/**
 * Runs `call` with a bearer token: a 401 (signalled by throwing
 * TransportError('unauthorized')) refreshes once through the shared in-flight
 * refresh and retries once. Rejects with TransportError('unauthorized') when
 * there is no session. The token stays inside `call`.
 */
export function authorizedRequest<T>(call: (token: string) => Promise<T>): Promise<T> {
  if (!manager) return Promise.reject(new TransportError('unauthorized'))
  return manager.authorizedRequest(call)
}

/** account + device of the live session, or null when signed out (never a token) */
export function uniworkSessionIdentity(): {
  accountId: string
  deviceSessionId: string
  deploymentId: string
} | null {
  return manager?.sessionIdentity() ?? null
}

/** the active deployment profile, or null when none is configured */
export function uniworkDeploymentProfile(): DeploymentProfile | null {
  if (!settingsPath) return null
  return uniworkAccount().deploymentProfile()
}

/** status pushes of the account (sign-in completion, sign-out) */
export function onUniworkAccountStatus(listener: (status: AccountStatus) => void): () => void {
  return uniworkAccount().onStatus(listener)
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
  endUniworkAiSession()
  if (availabilityTimer) clearInterval(availabilityTimer)
  availabilityTimer = null
  setUniworkChatTransport(null)
  setUniworkCloudTransport(null)
  keys?.clear()
  keys = null
  ;(globalThis as Record<symbol, unknown>)[UNIWORK_KEYS_HOST_SYMBOL] = null
  cloud?.dispose()
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
    await signOutUniwork(account(event.sender))
  })
  ipcMain.handle(HOME_CHANNELS.accountCancelLogin, (event) => {
    account(event.sender).cancelLogin()
  })
  ipcMain.handle(HOME_CHANNELS.accountSetServer, async (event, address: unknown) => {
    const current = account(event.sender)
    // re-points the app without the link question, so only the shell's own
    // page (Settings > Account lives in it) may ask, never a frame inside it
    const fromShell =
      event.sender === shellContents() && event.senderFrame === event.sender.mainFrame
    const result =
      fromShell && typeof address === 'string'
        ? await connectUniworkServer(address)
        : ({ ok: false, error: fromShell ? 'invalid_address' : 'refused' } as const)
    return { ...result, status: current.status() }
  })
  ipcMain.handle(HOME_CHANNELS.accountRetry, (event) => account(event.sender).retry())
  ipcMain.handle(HOME_CHANNELS.uniworkCloudStatus, (event) => {
    account(event.sender)
    return uniworkCloud().status()
  })
  ipcMain.handle(HOME_CHANNELS.uniworkCloudRefresh, (event) => {
    account(event.sender)
    return uniworkCloud().refresh()
  })
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
