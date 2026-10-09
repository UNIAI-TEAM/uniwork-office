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
  /** normalized origin, no trailing slash (e.g. https://uniwork.app) */
  apiOrigin: string
  clientId: string
  channel: DeploymentChannel
}

export const STABLE_CLIENT_ID = 'uniwork-office'
export const DEV_CLIENT_ID = 'uniwork-office-dev'
const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PROFILE_FILE = 'deployment-profile.json'

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

function isChannel(value: unknown): value is DeploymentChannel {
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
  /** process.resourcesPath of a packaged build (installer-provided profile) */
  resourcesDir?: string
  userDataDir: string
  isPackaged: boolean
  env?: NodeJS.ProcessEnv
  /** the existing `uniworkApiOrigin` app setting */
  settingsApiOrigin?: unknown
  readFile?: (path: string) => string
}

function readProfileFile(path: string, read: (path: string) => string): unknown {
  try {
    return JSON.parse(read(path))
  } catch {
    return undefined
  }
}

/**
 * Resolution order: installed profile in resources, then a userData profile,
 * then the UNIWORK_API_ORIGIN environment, then the `uniworkApiOrigin` app
 * setting. A profile file that exists but is invalid fails closed (null)
 * instead of silently falling through to a weaker source.
 */
export function resolveDeploymentProfile(
  options: ResolveDeploymentOptions,
): DeploymentProfile | null {
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const files = [
    options.resourcesDir ? join(options.resourcesDir, PROFILE_FILE) : undefined,
    join(options.userDataDir, PROFILE_FILE),
  ].filter((path): path is string => Boolean(path))
  for (const file of files) {
    const raw = readProfileFile(file, read)
    if (raw === undefined) continue
    return parseDeploymentProfile(raw)
  }
  const env = options.env ?? process.env
  const envChannel = env.UNIWORK_OFFICE_CHANNEL?.trim()
  const channel: DeploymentChannel = isChannel(envChannel)
    ? envChannel
    : options.isPackaged
      ? 'stable'
      : 'dev'
  const envOrigin = env.UNIWORK_API_ORIGIN?.trim()
  if (envOrigin) {
    return parseDeploymentProfile({
      deploymentId: env.UNIWORK_DEPLOYMENT_ID?.trim() || 'default',
      apiOrigin: envOrigin,
      channel,
    })
  }
  const fromSettings = options.settingsApiOrigin
  if (typeof fromSettings === 'string' && fromSettings.trim()) {
    return parseDeploymentProfile({ deploymentId: 'default', apiOrigin: fromSettings, channel })
  }
  return null
}
