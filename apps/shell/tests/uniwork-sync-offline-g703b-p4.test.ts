import { describe, expect, it } from 'vitest'
import {
  createOfflineLibraryApi,
  type OfflineLibraryApiDeps,
} from '../src/main/uniwork-sync/offline-library/api'
import { ORG, SCOPE, WS, addDoc, createHarness } from './uniwork-sync-offline-library-fakes'

/**
 * G703B-P4 (FL-08): deployment B, nobody signed in. The signed-out count reads
 * the last owner's library, and the last owner is deployment A's account: the
 * offline tab of B must not exist because of A's copies (the library store is
 * per deployment; its existence is not B's to show).
 */
describe('G703B-P4 signed-out offline snapshot is scoped to the active deployment', () => {
  it("deployment B shows no offline tab and no count because of deployment A's library", async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    const live = createOfflineLibraryApi({
      library: () => h.manager,
      activeOrgId: () => ORG,
      capabilityOn: async () => true,
      signedOut: () => false,
      lastOwner: () => null,
      libraryLayer: () => h.layer,
      openDocument: async () => ({ ok: false, error: 'network' }),
      openCopy: async () => ({ kind: 'none' }),
      revealLibraryFolder: async () => true,
      lockRefused: () => undefined,
      changed: () => undefined,
    })
    expect(await live.pin({ documentId: 'doc_1', workspaceId: WS })).toEqual({ ok: true })
    // restart on deployment B (UNIWORK_DEPLOYMENT_ID), nobody signed in, no org
    const deploymentB = createOfflineLibraryApi({
      library: () => null,
      activeOrgId: () => null,
      capabilityOn: async () => false,
      signedOut: () => true,
      // last-owner.json still names deployment A's account
      lastOwner: () => ({ deploymentId: SCOPE.deploymentId, accountId: SCOPE.accountId }),
      libraryLayer: () => h.layer,
      openDocument: async () => ({ ok: false, error: 'not_signed_in' }),
      openCopy: async () => ({ kind: 'none' }),
      revealLibraryFolder: async () => true,
      lockRefused: () => undefined,
      changed: () => undefined,
      // the seam the fix needs: the deployment this build is running against
      ...({ activeDeploymentId: () => 'dep_B' } as Partial<OfflineLibraryApiDeps>),
    })
    const snapshot = await deploymentB.snapshot()
    expect(snapshot.signedOutLockedCount).toBe(0)
    expect(snapshot.visible).toBe(false)
  })
})
