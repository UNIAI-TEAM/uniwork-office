import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CredentialStoreError,
  createCredentialStore,
  type SafeStorageLike,
  type StoredCredential,
} from '../src/main/uniwork-auth/credentials'

/** reversible stand-in for DPAPI/Keychain: never leaves the plaintext readable */
function fakeSafeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) =>
      Buffer.from(`ENC1${Buffer.from(text).toString('base64')}`.split('').reverse().join('')),
    decryptString: (buf) => {
      const raw = buf.toString().split('').reverse().join('')
      if (!raw.startsWith('ENC1')) throw new Error('bad ciphertext')
      return Buffer.from(raw.slice(4), 'base64').toString()
    },
    ...overrides,
  }
}

const credential = (refreshToken = 'rt_secret_value_1'): StoredCredential => ({
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  accountId: 'acc_1',
  deviceSessionId: 'dev_1',
  sessionId: 'sess_1',
  refreshToken,
  refreshExpiresAt: 1_900_000_000_000,
  profile: { accountId: 'acc_1', email: 'mai@example.com', displayName: 'Mai' },
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-cred-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const sessionFile = () => join(dir, 'uniwork-auth', 'session.bin')

describe('uniwork credential store', () => {
  it('round-trips a credential through safeStorage', () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() })
    expect(store.load()).toBeNull()
    store.save(credential())
    expect(store.load()).toEqual(credential())
  })

  it('never writes the refresh token or profile in plaintext', () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() })
    store.save(credential('rt_secret_value_1'))
    store.save(credential('rt_secret_value_2'))
    for (const name of readdirSync(join(dir, 'uniwork-auth'))) {
      const bytes = readFileSync(join(dir, 'uniwork-auth', name)).toString()
      expect(bytes).not.toContain('rt_secret_value')
      expect(bytes).not.toContain('mai@example.com')
    }
  })

  it('refuses the Linux basic_text backend (no plaintext fallback)', () => {
    const store = createCredentialStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage({ getSelectedStorageBackend: () => 'basic_text' }),
    })
    expect(() => store.save(credential())).toThrowError(CredentialStoreError)
    expect(() => store.load()).toThrowError(/keyring_unavailable/)
    expect(() => readFileSync(sessionFile())).toThrow()
  })

  it('refuses when encryption is unavailable (locked keyring)', () => {
    const store = createCredentialStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage({ isEncryptionAvailable: () => false }),
    })
    try {
      store.save(credential())
      expect.unreachable()
    } catch (error) {
      expect((error as CredentialStoreError).code).toBe('keyring_unavailable')
    }
  })

  it('recovers the previous credential from .bak when the primary is corrupt', () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() })
    store.save(credential('rt_secret_value_1'))
    store.save(credential('rt_secret_value_2'))
    writeFileSync(sessionFile(), 'garbage')
    expect(store.load()?.refreshToken).toBe('rt_secret_value_1')
    // the good copy was restored over the corrupt primary
    expect(store.load()?.refreshToken).toBe('rt_secret_value_1')
  })

  it('treats unreadable primary and backup as signed out and removes them', () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() })
    store.save(credential())
    store.save(credential())
    writeFileSync(sessionFile(), 'garbage')
    writeFileSync(`${sessionFile()}.bak`, 'garbage')
    expect(store.load()).toBeNull()
    expect(readdirSync(join(dir, 'uniwork-auth'))).toEqual([])
  })

  it('clear removes the credential and its backup', () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() })
    store.save(credential())
    store.save(credential())
    store.clear()
    expect(store.load()).toBeNull()
    expect(readdirSync(join(dir, 'uniwork-auth'))).toEqual([])
  })
})
