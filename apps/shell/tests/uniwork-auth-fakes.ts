import type { CredentialStore, StoredCredential } from '../src/main/uniwork-auth/credentials'

/** in-memory credential store with the production contract, nothing on disk */
export function createMemoryCredentialStore(
  initial: StoredCredential | null = null,
): CredentialStore {
  let current = initial
  return {
    load: () => current,
    save: (credential) => {
      current = { ...credential }
    },
    clear: () => {
      current = null
    },
    canStore: () => true,
  }
}
