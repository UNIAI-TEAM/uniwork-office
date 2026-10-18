import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CredentialStoreError, type SafeStorageLike } from '../src/main/uniwork-auth/credentials'
import {
  createSafeStorageKeyProvider,
  isStoreSegment,
  keyFilePath,
} from '../src/main/uniwork-sync/keys'

interface LockableFake extends SafeStorageLike {
  lock(): void
  unlock(): void
}

/**
 * Reversible stand-in for DPAPI/Keychain that can be locked at runtime: while
 * locked both directions throw the way a locked keychain does, without the
 * keyring becoming unavailable.
 */
function fakeSafeStorage(overrides: Partial<SafeStorageLike> = {}): LockableFake {
  let locked = false
  const base: SafeStorageLike = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => {
      if (locked) throw new Error('keychain access denied')
      return Buffer.from(`ENC1${Buffer.from(text).toString('base64')}`.split('').reverse().join(''))
    },
    decryptString: (buf) => {
      if (locked) throw new Error('keychain access denied')
      const raw = buf.toString().split('').reverse().join('')
      if (!raw.startsWith('ENC1')) throw new Error('bad ciphertext')
      return Buffer.from(raw.slice(4), 'base64').toString()
    },
  }
  return {
    ...base,
    ...overrides,
    lock: () => {
      locked = true
    },
    unlock: () => {
      locked = false
    },
  }
}

const scope = (deploymentId = 'dep_1', accountId = 'acc_1') => ({ deploymentId, accountId })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-sync-keys-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('uniwork sync store key provider', () => {
  it('creates one 32-byte key per scope and returns the same key later', async () => {
    const provider = createSafeStorageKeyProvider({ safeStorage: fakeSafeStorage(), dir })
    const first = await provider.key(scope())
    expect(first).toHaveLength(32)
    expect(await provider.key(scope())).toEqual(first)
    // a fresh provider (an app restart) unwraps the same key from disk
    const restarted = createSafeStorageKeyProvider({ safeStorage: fakeSafeStorage(), dir })
    expect(await restarted.key(scope())).toEqual(first)
    // another account gets its own key
    const other = await restarted.key(scope('dep_1', 'acc_2'))
    expect(other).toHaveLength(32)
    expect(other).not.toEqual(first)
  })

  it('never writes the plaintext key to disk', async () => {
    const provider = createSafeStorageKeyProvider({ safeStorage: fakeSafeStorage(), dir })
    const key = await provider.key(scope())
    const bytes = readFileSync(keyFilePath(dir, scope()))
    expect(bytes.includes(key)).toBe(false)
    expect(bytes.toString()).not.toContain(key.toString('hex'))
    expect(bytes.toString()).not.toContain(key.toString('base64'))
  })

  it('reports keystore_locked when an existing key cannot be decrypted (locked keychain)', async () => {
    const writer = createSafeStorageKeyProvider({ safeStorage: fakeSafeStorage(), dir })
    const key = await writer.key(scope())
    const safeStorage = fakeSafeStorage()
    safeStorage.lock()
    const locked = createSafeStorageKeyProvider({ safeStorage, dir })
    try {
      await locked.key(scope())
      expect.unreachable()
    } catch (error) {
      expect((error as CredentialStoreError).code).toBe('keystore_locked')
    }
    // the wrapped key survives: once the keyring opens again it still works
    safeStorage.unlock()
    expect(await locked.key(scope())).toEqual(key)
  })

  it('reports keystore_locked when a locked keychain refuses to wrap a new key', async () => {
    const safeStorage = fakeSafeStorage()
    safeStorage.lock()
    const provider = createSafeStorageKeyProvider({ safeStorage, dir })
    try {
      await provider.key(scope())
      expect.unreachable()
    } catch (error) {
      expect((error as CredentialStoreError).code).toBe('keystore_locked')
    }
    expect(readdirSync(dir)).toEqual([])
  })

  it('reports keyring_unavailable without a usable keyring', async () => {
    const cases: Partial<SafeStorageLike>[] = [
      { isEncryptionAvailable: () => false },
      { getSelectedStorageBackend: () => 'basic_text' },
    ]
    for (const overrides of cases) {
      const provider = createSafeStorageKeyProvider({
        safeStorage: fakeSafeStorage(overrides),
        dir,
      })
      try {
        await provider.key(scope())
        expect.unreachable()
      } catch (error) {
        expect((error as CredentialStoreError).code).toBe('keyring_unavailable')
      }
    }
    expect(readdirSync(dir)).toEqual([])
  })

  it('FL-09: a real keyring that is locked (encryption unavailable) with a saved key file is keystore_locked, otherwise keyring_unavailable', async () => {
    await createSafeStorageKeyProvider({ safeStorage: fakeSafeStorage(), dir }).key(scope())
    const codeOf = async (overrides: Partial<SafeStorageLike>, forScope = scope()) => {
      try {
        await createSafeStorageKeyProvider({ safeStorage: fakeSafeStorage(overrides), dir }).key(
          forScope,
        )
        return null
      } catch (error) {
        return (error as CredentialStoreError).code
      }
    }
    const locked = { isEncryptionAvailable: () => false }
    expect(await codeOf({ ...locked, getSelectedStorageBackend: () => 'gnome_libsecret' })).toBe(
      'keystore_locked',
    )
    expect(await codeOf({ ...locked, getSelectedStorageBackend: () => 'kwallet6' })).toBe(
      'keystore_locked',
    )
    expect(await codeOf({ ...locked, getSelectedStorageBackend: () => 'basic_text' })).toBe(
      'keyring_unavailable',
    )
    expect(await codeOf(locked)).toBe('keyring_unavailable')
    // no key file of that scope: nothing was saved, so the keyring is simply unusable
    expect(
      await codeOf(
        { ...locked, getSelectedStorageBackend: () => 'gnome_libsecret' },
        scope('dep_1', 'acc_other'),
      ),
    ).toBe('keyring_unavailable')
  })

  it('reports io when the wrapped key decrypts to something that is not a key', async () => {
    const provider = createSafeStorageKeyProvider({ safeStorage: fakeSafeStorage(), dir })
    await provider.key(scope())
    writeFileSync(keyFilePath(dir, scope()), fakeSafeStorage().encryptString('not-a-key'))
    try {
      await provider.key(scope())
      expect.unreachable()
    } catch (error) {
      expect((error as CredentialStoreError).code).toBe('io')
    }
  })

  it('rejects a scope that is not safe as a path segment', async () => {
    const provider = createSafeStorageKeyProvider({ safeStorage: fakeSafeStorage(), dir })
    await expect(provider.key({ deploymentId: '..', accountId: 'acc_1' })).rejects.toThrow(
      /invalid store path segment/,
    )
    await expect(provider.key({ deploymentId: 'dep_1', accountId: 'a/b' })).rejects.toThrow(
      /invalid store path segment/,
    )
    expect(isStoreSegment('..')).toBe(false)
    expect(isStoreSegment('acc_1')).toBe(true)
    expect(readdirSync(dir)).toEqual([])
  })
})
