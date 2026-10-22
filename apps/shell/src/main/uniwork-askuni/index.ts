import type { IpcMain, WebContents } from 'electron'
import type { DeploymentProfile } from '../uniwork-auth/deployment'
import {
  createUniworkDocsClient,
  createUniworkSend,
  METADATA_TIMEOUT_MS,
  type UniworkDocsClientOptions,
} from '../uniwork-docs/client'
import { createAskUniClient } from './client'
import { askUniFakeEnabled, createFakeAskUni } from './fake'
import { createAskUniOpener, registerAskUniOpenIpc, type AskUniOpenDeps } from './open-citation'
import { createShellSenderCheck } from './sender'
import { createAskUniService, registerAskUniIpc, type AskUniService } from './service'
import { createAskUniStreamClient, type AskUniStreamClient } from './stream-client'
import { askUniFakeStreamFlag, createFakeAskUniStream } from './stream-fake'
import {
  createAskUniFlags,
  createAskUniStreamService,
  registerAskUniStreamIpc,
  type AskUniFlagsReader,
} from './stream-service'

export interface UniworkAskUniWiring {
  profile(): DeploymentProfile | null
  /** the auth module's authorizedRequest */
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  isSignedIn(): boolean
  /** account + selected org, so a switch drops the cached workspace list */
  scopeKey(): string | null
  selectedOrgId(): string | null
  /** the workspace the Home doclist last picked (workbench store) */
  activeWorkspaceId(): string | null
  packaged: boolean
  env: NodeJS.ProcessEnv
  /** the docs service's open-by-id, the one path every UniWork document opens through */
  openDocument: AskUniOpenDeps['openDocument']
  /** shell.openExternal; the opener hands it only URLs on the deployment's web origin */
  openExternal(url: string): Promise<void>
  /** the shell window's webContents: only its main frame may call `uniwork:askuni:*` */
  shellContents(): WebContents | null
  /** test seam: the streaming fake's tick (default 80 ms) */
  fakeStreamDelayMs?: number
}

/** `GET /api/v1/config` for the selected org: the public `ask_uni_stream` flag */
async function readStreamFlag(
  options: UniworkDocsClientOptions,
  orgId: string | null,
): Promise<boolean> {
  const query = new URLSearchParams()
  if (orgId) query.set('organization_id', orgId)
  return createUniworkSend(options)({
    method: 'GET',
    route: '/config',
    query,
    timeoutMs: METADATA_TIMEOUT_MS,
    read: async (response) => {
      const body = (await response.json()) as { flags?: Record<string, unknown> } | null
      return body?.flags?.ask_uni_stream === true
    },
  })
}

/**
 * Registers `uniwork:askuni:*`. The workspaces come from the same
 * `GET /orgs/{org}/workspaces` the Home doclist reads, the current one from
 * the workbench key the doclist writes; a citation opens through `uniwork:askuni:open-citation`
 * (the docs open-by-id for a document, the web origin for the rest); UNIWORK_ASKUNI_FAKE=1 (never in a
 * packaged build) swaps both and the answers for canned ones. UNI-2076 adds the v2 stream
 * (`uniwork:askuni:stream*`) and its flag; every handler takes the shell's main frame only.
 */
export function registerUniworkAskUni(
  ipcMain: IpcMain,
  wiring: UniworkAskUniWiring,
): AskUniService {
  let service: AskUniService
  let streamClient: AskUniStreamClient
  let flags: AskUniFlagsReader
  let isSignedIn: () => boolean
  let scopeKey: () => string | null
  if (askUniFakeEnabled(wiring.env, wiring.packaged)) {
    const fake = createFakeAskUni()
    isSignedIn = () => true
    scopeKey = () => 'fake'
    service = createAskUniService({
      isSignedIn,
      scopeKey,
      listWorkspaces: async () => (await fake.context()).workspaces,
      activeWorkspaceId: () => null,
      client: fake.client,
    })
    streamClient = createFakeAskUniStream(
      wiring.fakeStreamDelayMs !== undefined ? { delayMs: wiring.fakeStreamDelayMs } : {},
    )
    const on = askUniFakeStreamFlag(wiring.env)
    flags = { flags: async () => ({ streamEnabled: on }) }
  } else {
    // one client per call: the profile (origin) can change with a sign-in
    const options = (): UniworkDocsClientOptions | null => {
      const profile = wiring.profile()
      return profile
        ? {
            apiOrigin: profile.apiOrigin,
            authorized: (call) => wiring.authorized(call),
            isSignedIn: () => wiring.isSignedIn(),
          }
        : null
    }
    isSignedIn = () => wiring.isSignedIn() && options() !== null
    scopeKey = wiring.scopeKey
    service = createAskUniService({
      isSignedIn,
      scopeKey,
      async listWorkspaces() {
        const opts = options()
        const orgId = wiring.selectedOrgId()
        if (!opts || !orgId) return []
        const rows = await createUniworkDocsClient(opts).listWorkspaces(orgId)
        return rows.map((w) => ({ id: w.id, name: w.name }))
      },
      activeWorkspaceId: wiring.activeWorkspaceId,
      client: {
        ask: (req) => {
          const opts = options()
          return opts
            ? createAskUniClient(opts).ask(req)
            : Promise.resolve({ ok: false as const, code: 'signed_out' as const })
        },
      },
    })
    streamClient = {
      stream: (req, streamOpts) => {
        const opts = options()
        return opts
          ? createAskUniStreamClient(opts).stream(req, streamOpts)
          : Promise.resolve({ type: 'error' as const, code: 'signed_out' as const })
      },
    }
    flags = createAskUniFlags({
      isSignedIn,
      scopeKey,
      read: async () => {
        const opts = options()
        return opts ? readStreamFlag(opts, wiring.selectedOrgId()) : false
      },
    })
  }
  const isShellSender = createShellSenderCheck(() => wiring.shellContents())
  registerAskUniIpc(ipcMain, service, isShellSender)
  registerAskUniStreamIpc(ipcMain, {
    stream: createAskUniStreamService({
      isSignedIn,
      scopeKey,
      checkWorkspace: (id) => service.checkWorkspace(id),
      client: streamClient,
    }),
    flags,
    isShellSender,
  })
  registerAskUniOpenIpc(
    ipcMain,
    createAskUniOpener({
      isSignedIn: () => wiring.isSignedIn(),
      profile: () => wiring.profile(),
      openDocument: (id) => wiring.openDocument(id),
      openExternal: (url) => wiring.openExternal(url),
    }),
    isShellSender,
  )
  return service
}
