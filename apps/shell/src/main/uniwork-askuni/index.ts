import type { IpcMain, WebContents } from 'electron'
import type { DeploymentProfile } from '../uniwork-auth/deployment'
import {
  createUniworkDocsClient,
  createUniworkSend,
  METADATA_TIMEOUT_MS,
  type UniworkDocsClientOptions,
} from '../uniwork-docs/client'
import { createAskUniClient } from './client'
import { createAskUniDocService, registerAskUniDocIpc, type AskUniDocBinding } from './doc-service'
import { askUniEditorUrlRule, createEditorSenderCheck } from './doc-sender'
import { askUniFakeEnabled, createFakeAskUni } from './fake'
import { createAskUniOpener, registerAskUniOpenIpc, type AskUniOpenDeps } from './open-citation'
import { createAskUniLookupClient, type AskUniLookupClient } from './lookup-client'
import { createAskUniRestClient, type AskUniRestClient } from './rest-client'
import { createFakeAskUniRest, createFakeAskUniStore } from './rest-fake'
import { createAskUniRestService, registerAskUniRestIpc } from './rest-service'
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
  /**
   * UNI-2076 S7b, the editor panels (`uniwork:askuni-doc:*`): an editor tab
   * view or detached editor window, the path it shows, that path's binding.
   * Absent = every editor call is refused.
   */
  isEditorContents?(webContentsId: number): boolean
  editorPath?(sender: { id: number }): string | null
  docBinding?(path: string): AskUniDocBinding
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
 * (`uniwork:askuni:stream*`), its flag and the conversation REST + picker lookups; every handler takes the shell's main frame only.
 * S7b adds the editor family `uniwork:askuni-doc:*` (doc-service.ts), which takes editor main frames only.
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
  let rest: AskUniRestClient
  let lookup: AskUniLookupClient
  if (askUniFakeEnabled(wiring.env, wiring.packaged)) {
    const fake = createFakeAskUni()
    // one store: a fake streamed answer shows up in the fake history
    const store = createFakeAskUniStore()
    ;({ rest, lookup } = createFakeAskUniRest(store))
    isSignedIn = () => true
    scopeKey = () => 'fake'
    service = createAskUniService({
      isSignedIn,
      scopeKey,
      listWorkspaces: async () => (await fake.context()).workspaces,
      activeWorkspaceId: () => null,
      client: fake.client,
    })
    streamClient = createFakeAskUniStream({
      store,
      ...(wiring.fakeStreamDelayMs !== undefined ? { delayMs: wiring.fakeStreamDelayMs } : {}),
    })
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
      // async: a synchronous throw (an unusable apiOrigin) becomes the run's one error terminal
      stream: async (req, streamOpts) => {
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
    // the service checks the sign-in first; a profile lost on the way is signed_out
    const signedOut = { ok: false as const, error: 'signed_out' as const }
    const via =
      <A extends unknown[], R>(
        call: (client: AskUniRestClient, ...args: A) => Promise<R>,
      ): ((...args: A) => Promise<R | typeof signedOut>) =>
      async (...args) => {
        const opts = options()
        return opts ? call(createAskUniRestClient(opts), ...args) : signedOut
      }
    rest = {
      capabilities: via((c, ws: string) => c.capabilities(ws)),
      conversations: via((c, ws: string) => c.conversations(ws)),
      messages: via((c, cid: string) => c.messages(cid)),
      rename: via((c, cid: string, title: string) => c.rename(cid, title)),
      remove: via((c, cid: string) => c.remove(cid)),
      feedbackSet: via((c, req: Parameters<AskUniRestClient['feedbackSet']>[0]) =>
        c.feedbackSet(req),
      ),
      feedbackClear: via((c, cid: string, mid: string) => c.feedbackClear(cid, mid)),
    }
    lookup = {
      lookup: async (req) => {
        const opts = options()
        return opts ? createAskUniLookupClient(opts).lookup(req) : signedOut
      },
    }
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
  const restService = createAskUniRestService({
    isSignedIn,
    checkWorkspace: (id) => service.checkWorkspace(id),
    rest,
    lookup,
  })
  registerAskUniRestIpc(ipcMain, { rest: restService, isShellSender })
  // the editor family: its own sender rule; workspace and focus come from the editor's bound path
  registerAskUniDocIpc(ipcMain, {
    doc: createAskUniDocService({
      isSignedIn,
      scopeKey,
      shownPath: (sender) => wiring.editorPath?.(sender) ?? null,
      binding: (path) => wiring.docBinding?.(path) ?? null,
      client: streamClient,
      rest: restService,
      flags,
    }),
    isEditorSender: createEditorSenderCheck({
      shellContents: () => wiring.shellContents(),
      isEditorContents: (id) => wiring.isEditorContents?.(id) === true,
      isEditorUrl: askUniEditorUrlRule(wiring.env),
    }),
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
