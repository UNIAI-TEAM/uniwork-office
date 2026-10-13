import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Which UniWork server this install signs in to. The profile binds the API
 * origin, the deployment id the server checks on every desktop auth call, and
 * the public client id / callback scheme of the build channel.
 */
export type DeploymentChannel = 'stable' | 'beta' | 'dev'

export interface DeploymentProfile {
  deploymentId: string
  /** normalized origin, no trailing slash (e.g. https://uniworkos.com) */
  apiOrigin: string
  clientId: string
  channel: DeploymentChannel
}

export const STABLE_CLIENT_ID = 'uniwork-office'
export const DEV_CLIENT_ID = 'uniwork-office-dev'
const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
/** the profile the user or a web link chose; lives in userData */
export const PROFILE_FILE = 'deployment-profile.json'
/** written at build time from the release env (channel + optional baked default) */
const BUILD_DEFAULTS_FILE = 'deployment-defaults.json'

export function clientIdForChannel(channel: DeploymentChannel): string {
  return channel === 'dev' ? DEV_CLIENT_ID : STABLE_CLIENT_ID
}

export function callbackSchemeForChannel(channel: DeploymentChannel): string {
  return channel === 'dev' ? 'uniwork-office-dev' : 'uniwork-office'
}

/** The exact registered redirect URI; the server compares it byte for byte. */
export function redirectUriForProfile(profile: DeploymentProfile): string {
  return `${callbackSchemeForChannel(profile.channel)}://auth/callback`
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** HTTPS, or plain HTTP to a loopback host on the dev channel only. */
export function isAllowedOrigin(url: URL, channel: DeploymentChannel): boolean {
  if (url.protocol === 'https:') return true
  return channel === 'dev' && url.protocol === 'http:' && isLoopbackHost(url.hostname)
}

export function isChannel(value: unknown): value is DeploymentChannel {
  return value === 'stable' || value === 'beta' || value === 'dev'
}

/**
 * Validates a candidate profile and returns its normalized form, or null. An
 * origin must be a bare origin: no credentials, path, query or fragment.
 */
export function parseDeploymentProfile(raw: unknown): DeploymentProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const allowed = new Set(['deploymentId', 'apiOrigin', 'clientId', 'channel'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  const { deploymentId, apiOrigin, channel } = value
  if (typeof deploymentId !== 'string' || !DEPLOYMENT_ID.test(deploymentId)) return null
  if (typeof apiOrigin !== 'string' || !isChannel(channel)) return null
  let url: URL
  try {
    url = new URL(apiOrigin.trim())
  } catch {
    return null
  }
  if (!isAllowedOrigin(url, channel)) return null
  if (url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== '' && url.pathname !== '/') return null
  const clientId = clientIdForChannel(channel)
  if (value.clientId !== undefined && value.clientId !== clientId) return null
  return { deploymentId, apiOrigin: url.origin, clientId, channel }
}

export interface ResolveDeploymentOptions {
  /** process.resourcesPath of a packaged build (holds deployment-defaults.json) */
  resourcesDir?: string
  userDataDir: string
  isPackaged: boolean
  env?: NodeJS.ProcessEnv
  /** the legacy `uniworkApiOrigin` app setting */
  settingsApiOrigin?: unknown
  readFile?: (path: string) => string
}

function readJson(path: string, read: (path: string) => string): unknown {
  try {
    return JSON.parse(read(path))
  } catch {
    return undefined
  }
}

export interface BuildDefaults {
  channel: DeploymentChannel
  /** the profile baked in at build time, or null when the build has none */
  profile: DeploymentProfile | null
}

/**
 * The channel of this build and its baked default profile. A packaged build
 * reads resources/deployment-defaults.json (written by electron-builder from
 * the release env); an unpackaged run is the dev channel unless
 * UNIWORK_OFFICE_CHANNEL says otherwise. A missing or invalid file means
 * stable with no default.
 */
export function readBuildDefaults(options: ResolveDeploymentOptions): BuildDefaults {
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const env = options.env ?? process.env
  const envChannel = env.UNIWORK_OFFICE_CHANNEL?.trim()
  if (!options.isPackaged) {
    return { channel: isChannel(envChannel) ? envChannel : 'dev', profile: null }
  }
  const raw = options.resourcesDir
    ? readJson(join(options.resourcesDir, BUILD_DEFAULTS_FILE), read)
    : undefined
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const channel: DeploymentChannel = isChannel(value.channel)
    ? value.channel
    : isChannel(envChannel)
      ? envChannel
      : 'stable'
  const baked = value.defaultProfile
  const profile =
    baked && typeof baked === 'object'
      ? parseDeploymentProfile({ ...(baked as Record<string, unknown>), channel })
      : null
  return { channel, profile }
}

/** The profile file in userData that matches this build's channel, else null. */
export function readUserProfile(
  userDataDir: string,
  channel: DeploymentChannel,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): DeploymentProfile | null {
  const raw = readJson(join(userDataDir, PROFILE_FILE), read)
  if (raw === undefined) return null
  const profile = parseDeploymentProfile(raw)
  return profile && profile.channel === channel ? profile : null
}

/**
 * Resolution order: the userData profile (what the user or a link chose), the
 * default baked into this build, the UNIWORK_API_ORIGIN environment (dev), the
 * legacy `uniworkApiOrigin` setting. An unreadable, invalid or other-channel
 * userData file is ignored so the next source (or the connect screen) takes over.
 */
export function resolveDeploymentProfile(
  options: ResolveDeploymentOptions,
): DeploymentProfile | null {
  const defaults = readBuildDefaults(options)
  const chosen = readUserProfile(options.userDataDir, defaults.channel, options.readFile)
  if (chosen) return chosen
  if (defaults.profile) return defaults.profile
  const env = options.env ?? process.env
  const envOrigin = env.UNIWORK_API_ORIGIN?.trim()
  if (envOrigin) {
    return parseDeploymentProfile({
      deploymentId: env.UNIWORK_DEPLOYMENT_ID?.trim() || 'default',
      apiOrigin: envOrigin,
      channel: defaults.channel,
    })
  }
  const fromSettings = options.settingsApiOrigin
  if (typeof fromSettings === 'string' && fromSettings.trim()) {
    return parseDeploymentProfile({
      deploymentId: 'default',
      apiOrigin: fromSettings,
      channel: defaults.channel,
    })
  }
  return null
}
