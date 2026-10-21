import type { IpcMain } from 'electron'
import type { DeploymentProfile } from '../uniwork-auth/deployment'
import { createUniworkDocsClient, type UniworkDocsClientOptions } from '../uniwork-docs/client'
import { createAskUniClient } from './client'
import { askUniFakeEnabled, createFakeAskUni } from './fake'
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
}

/**
 * Registers `uniwork:askuni:*`. The workspaces come from the same
 * `GET /orgs/{org}/workspaces` the Home doclist reads, the current one from
 * the workbench key the doclist writes; UNIWORK_ASKUNI_FAKE=1 (never in a
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
  return service
}
