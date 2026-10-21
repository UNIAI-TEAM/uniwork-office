import type { IpcMain } from 'electron'
import type { DeploymentProfile } from '../uniwork-auth/deployment'
import { createUniworkDocsClient, type UniworkDocsClientOptions } from '../uniwork-docs/client'
import { createAskUniClient } from './client'
import { askUniFakeEnabled, createFakeAskUni } from './fake'
import { createAskUniOpener, registerAskUniOpenIpc, type AskUniOpenDeps } from './open-citation'
import { createAskUniService, registerAskUniIpc, type AskUniService } from './service'

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
}

/**
 * Registers `uniwork:askuni:*`. The workspaces come from the same
 * `GET /orgs/{org}/workspaces` the Home doclist reads, the current one from
 * the workbench key the doclist writes; a citation opens through `uniwork:askuni:open-citation`
 * (the docs open-by-id for a document, the web origin for the rest); UNIWORK_ASKUNI_FAKE=1 (never in a
 * packaged build) swaps both and the answers for canned ones.
 */
export function registerUniworkAskUni(
  ipcMain: IpcMain,
  wiring: UniworkAskUniWiring,
): AskUniService {
  let service: AskUniService
  if (askUniFakeEnabled(wiring.env, wiring.packaged)) {
    const fake = createFakeAskUni()
    service = createAskUniService({
      isSignedIn: () => true,
      scopeKey: () => 'fake',
      listWorkspaces: async () => (await fake.context()).workspaces,
      activeWorkspaceId: () => null,
      client: fake.client,
    })
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
    service = createAskUniService({
      isSignedIn: () => wiring.isSignedIn() && options() !== null,
      scopeKey: wiring.scopeKey,
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
  }
  registerAskUniIpc(ipcMain, service)
  registerAskUniOpenIpc(
    ipcMain,
    createAskUniOpener({
      isSignedIn: () => wiring.isSignedIn(),
      profile: () => wiring.profile(),
      openDocument: (id) => wiring.openDocument(id),
      openExternal: (url) => wiring.openExternal(url),
    }),
  )
  return service
}
