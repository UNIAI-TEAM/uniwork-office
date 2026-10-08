export {
  parseOfficeLaunchUrl,
  parseOfficeAppUrl,
  isOfficeAppUrl,
  buildOfficeAppUrl,
  extractLaunchUrlFromArgv,
} from './protocol'
export { assertSafeApiOrigin } from './origin'
export {
  createOfficeBridgeClient,
  OfficeBridgeApiError,
  type OfficeBridgeClient,
} from './client'
export {
  sha256Hex,
  newOpaqueToken,
  newSaveOperationId,
  newIdempotencyKey,
  sessionWorkspaceDir,
  writeSessionWorkspace,
  readSessionMeta,
  persistSessionMeta,
  removeSessionWorkspace,
  type BridgeSessionMeta,
} from './workspace'
