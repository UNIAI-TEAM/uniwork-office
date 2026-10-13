import {
  CredentialStoreError,
  type CredentialStore,
  type StoredCredential,
} from '../src/main/uniwork-auth/credentials'

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

/**
 * A credential store whose OS keyring starts locked: load() and save() report
 * `keystore_locked` until unlock() is called, then behave like the in-memory
 * store. `saved()` reads the stored credential without going through the
 * keyring, so a test can prove a locked sign-in wrote nothing.
 */
export function createLockableCredentialStore(initial: StoredCredential | null = null): {
  store: CredentialStore
  unlock: () => void
  saved: () => StoredCredential | null
} {
  let current = initial
  let locked = true
  const store: CredentialStore = {
    load: () => {
      if (locked) throw new CredentialStoreError('keystore_locked')
      return current
    },
    save: (credential) => {
      if (locked) throw new CredentialStoreError('keystore_locked')
      current = { ...credential }
    },
    clear: () => {
      current = null
    },
    canStore: () => true,
  }
  return {
    store,
    unlock: () => {
      locked = false
    },
    saved: () => current,
  }
}
