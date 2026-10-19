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
  /** deployment A kept one copy while signed in */
  async function pinnedOnA() {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    const live = createOfflineLibraryApi({
      library: () => h.manager,
      activeOrgId: () => ORG,
      capabilityOn: async () => true,
      signedOut: () => false,
      lastOwner: () => null,
      activeDeploymentId: () => SCOPE.deploymentId,
      libraryLayer: () => h.layer,
      openDocument: async () => ({ ok: false, error: 'network' }),
      openCopy: async () => ({ kind: 'none' }),
      revealLibraryFolder: async () => true,
      lockRefused: () => undefined,
      changed: () => undefined,
    })
    expect(await live.pin({ documentId: 'doc_1', workspaceId: WS })).toEqual({ ok: true })
    return h
  }

  /** a restart with nobody signed in, no org; last-owner.json names deployment A's account */
  const signedOutApi = (
    h: Awaited<ReturnType<typeof pinnedOnA>>,
    activeDeploymentId: OfflineLibraryApiDeps['activeDeploymentId'],
  ) =>
    createOfflineLibraryApi({
      library: () => null,
      activeOrgId: () => null,
      capabilityOn: async () => false,
      signedOut: () => true,
      lastOwner: () => ({ deploymentId: SCOPE.deploymentId, accountId: SCOPE.accountId }),
      activeDeploymentId,
      libraryLayer: () => h.layer,
      openDocument: async () => ({ ok: false, error: 'not_signed_in' }),
      openCopy: async () => ({ kind: 'none' }),
      revealLibraryFolder: async () => true,
      lockRefused: () => undefined,
      changed: () => undefined,
    })

  it("deployment B shows no offline tab and no count because of deployment A's library", async () => {
    const snapshot = await signedOutApi(await pinnedOnA(), () => 'dep_B').snapshot()
    expect(snapshot.signedOutLockedCount).toBe(0)
    expect(snapshot.visible).toBe(false)
  })

  it("deployment A signed out still shows its own library's locked count (FL-07)", async () => {
    const snapshot = await signedOutApi(await pinnedOnA(), () => SCOPE.deploymentId).snapshot()
    expect(snapshot.signedOutLockedCount).toBe(1)
    expect(snapshot.visible).toBe(true)
  })

  it('no deployment profile known: nothing is counted', async () => {
    const snapshot = await signedOutApi(await pinnedOnA(), () => null).snapshot()
    expect(snapshot.signedOutLockedCount).toBe(0)
    expect(snapshot.visible).toBe(false)
  })
})
