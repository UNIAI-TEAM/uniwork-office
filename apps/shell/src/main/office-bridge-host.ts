import { readFileSync } from 'node:fs'
import {
  createOfficeBridgeClient,
  OfficeBridgeApiError,
  newIdempotencyKey,
  parseOfficeLaunchUrl,
  persistSessionMeta,
  sha256Hex,
  writeSessionWorkspace,
  type BridgeSessionMeta,
  type OfficeBridgeClient,
} from '@uniwork/office-bridge'
import type { OfficeSessionEndpoints } from '@uniwork/office-bridge-contracts'
import { readAppSettings, writeAppSetting } from './app-settings'

export interface OfficeBridgeHostDeps {
  userDataDir: string
  settingsPath: string
  openDocumentPath: (filePath: string) => boolean
  showWarning: (message: string) => void
  showInfo: (message: string) => void
  t: (key: BridgeStringKey, params?: Record<string, string | number>) => string
}

export type BridgeStringKey =
  | 'saveToUniWork'
  | 'uwOpening'
  | 'uwSaving'
  | 'uwSavedVersion'
  | 'uwSaveFailed'
  | 'uwVersionConflict'
  | 'uwAccessDenied'
  | 'uwSessionExpired'
  | 'uwUnsupported'

interface LiveSession {
  sessionId: string
  sessionToken: string
  endpoints: OfficeSessionEndpoints
  meta: BridgeSessionMeta
  mimeType: string
  canSave: boolean
}

const liveByPath = new Map<string, LiveSession>()

export function liveBridgeSessionForPath(filePath: string): LiveSession | undefined {
  return liveByPath.get(filePath)
}

export function resolveUniWorkApiOrigin(settingsPath: string): string | null {
  const fromEnv = process.env.UNIWORK_API_ORIGIN?.trim()
  if (fromEnv) return fromEnv
  const settings = readAppSettings(settingsPath)
  const fromSettings = settings.uniworkApiOrigin
  return typeof fromSettings === 'string' && fromSettings.trim() ? fromSettings.trim() : null
}

/** Keep env origin in local settings so protocol launches (no env) still resolve it. */
export function persistUniWorkApiOriginFromEnv(settingsPath: string): void {
  const fromEnv = process.env.UNIWORK_API_ORIGIN?.trim()
  if (!fromEnv) return
  try {
    writeAppSetting(settingsPath, 'uniworkApiOrigin', fromEnv)
  } catch {
    // best-effort; this process can still use the env value
  }
}

function clientFor(deps: OfficeBridgeHostDeps): OfficeBridgeClient {
  const origin = resolveUniWorkApiOrigin(deps.settingsPath)
  if (!origin) throw new Error('uniwork_api_origin_missing')
  return createOfficeBridgeClient(origin)
}

export async function handleOfficeLaunchUrl(
  raw: string,
  deps: OfficeBridgeHostDeps,
): Promise<boolean> {
  const parsed = parseOfficeLaunchUrl(raw)
  if (!parsed.ok) {
    deps.showWarning(deps.t('uwUnsupported'))
    return false
  }
  let client: OfficeBridgeClient
  try {
    client = clientFor(deps)
  } catch {
    deps.showWarning(deps.t('uwSaveFailed'))
    return false
  }
  try {
    const exchanged = await client.exchange(parsed.token)
    const bytes = await client.downloadContent(exchanged.sessionToken, exchanged.endpoints.download)
    const meta = writeSessionWorkspace({
      userDataDir: deps.userDataDir,
      descriptor: exchanged.descriptor,
      bytes,
    })
    liveByPath.set(meta.localPath, {
      sessionId: exchanged.sessionId,
      sessionToken: exchanged.sessionToken,
      endpoints: exchanged.endpoints,
      meta,
      mimeType: exchanged.descriptor.mimeType,
      canSave: exchanged.descriptor.canSaveNewVersion && exchanged.descriptor.extension !== 'pdf',
    })
    const opened = deps.openDocumentPath(meta.localPath)
    if (!opened) {
      deps.showWarning(deps.t('uwUnsupported'))
      return false
    }
    return true
  } catch (err) {
    const code = err instanceof OfficeBridgeApiError ? err.code : ''
    if (code === 'EXPIRED' || code === 'TOKEN_EXPIRED') deps.showWarning(deps.t('uwSessionExpired'))
    else if (code === 'UNSUPPORTED_FORMAT') deps.showWarning(deps.t('uwUnsupported'))
    else deps.showWarning(deps.t('uwSaveFailed'))
    return false
  }
}

export async function saveActivePathToUniWork(
  filePath: string,
  deps: OfficeBridgeHostDeps,
): Promise<boolean> {
  const live = liveByPath.get(filePath)
  if (!live) {
    deps.showWarning(deps.t('uwSaveFailed'))
    return false
  }
  if (!live.canSave) {
    deps.showWarning(deps.t('uwUnsupported'))
    return false
  }
  const bytes = new Uint8Array(readFileSync(live.meta.localPath))
  const checksumSha256 = sha256Hex(bytes)
  const idempotencyKey = live.meta.idempotencyKey ?? newIdempotencyKey()
  live.meta.idempotencyKey = idempotencyKey
  persistSessionMeta(deps.userDataDir, live.meta)
  try {
    const client = clientFor(deps)
    const prepared = await client.prepareSave(
      live.sessionToken,
      {
        idempotencyKey,
        baseVersion: live.meta.baseVersion ?? live.meta.versionNumber,
        sessionId: live.sessionId,
      },
      live.endpoints.savePrepare,
    )
    live.meta.saveOperationId = prepared.saveOperationId
    persistSessionMeta(deps.userDataDir, live.meta)
    await client.upload(prepared.upload.url, prepared.upload.token, bytes)
    const saved = await client.completeSave(
      live.sessionToken,
      {
        sessionId: live.sessionId,
        saveOperationId: prepared.saveOperationId,
        idempotencyKey,
      },
      live.endpoints.saveComplete,
    )
    live.meta.versionId = saved.versionId
    live.meta.versionNumber = saved.version
    live.meta.baseVersion = saved.version
    live.meta.sourceChecksumSha256 = checksumSha256
    live.meta.saveOperationId = null
    live.meta.idempotencyKey = null
    persistSessionMeta(deps.userDataDir, live.meta)
    deps.showInfo(deps.t('uwSavedVersion', { version: saved.version }))
    return true
  } catch (err) {
    const code = err instanceof OfficeBridgeApiError ? err.code : ''
    if (code === 'VERSION_CONFLICT') {
      live.meta.idempotencyKey = null
      live.meta.saveOperationId = null
      persistSessionMeta(deps.userDataDir, live.meta)
      deps.showWarning(deps.t('uwVersionConflict'))
    } else if (
      code === 'SAVE_DENIED' ||
      code === 'NOT_FOUND' ||
      code === 'FORBIDDEN' ||
      code === 'PERMISSION_DENIED'
    ) {
      deps.showWarning(deps.t('uwAccessDenied'))
    } else if (code === 'EXPIRED' || code === 'TOKEN_EXPIRED') {
      deps.showWarning(deps.t('uwSessionExpired'))
    } else {
      deps.showWarning(deps.t('uwSaveFailed'))
    }
    return false
  }
}

export function rememberBridgePathIfAny(filePath: string): BridgeSessionMeta | null {
  return readSessionMetaFromPath(filePath)
}

function readSessionMetaFromPath(filePath: string): BridgeSessionMeta | null {
  for (const live of liveByPath.values()) {
    if (live.meta.localPath === filePath) return live.meta
  }
  return null
}
