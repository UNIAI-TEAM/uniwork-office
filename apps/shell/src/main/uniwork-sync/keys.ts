import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import {
  CredentialStoreError,
  ensureKeyringAvailable,
  type SafeStorageLike,
} from '../uniwork-auth/credentials'

/**
 * One store key per account boundary: 32 random bytes that every encrypted
 * record of a StoreScope is keyed from. The key is wrapped by Electron
 * safeStorage (DPAPI on Windows, Keychain on macOS, Secret Service on Linux)
 * and kept under `dir`; the plaintext key never touches a file. A wrapped key
 * the keyring refuses to open right now is a lock - `keystore_locked`, retry
 * later - distinct from a host with no usable keyring at all
 * (`keyring_unavailable`); the same split the credential store got in W1.
 */

/** the account boundary a store key (and its records) belongs to */
export interface StoreScope {
  deploymentId: string
  accountId: string
}

/**
 * One path segment: no separators, no traversal, bounded length. The same
 * shape the binding store accepts for its folders, so any scope that can name
 * a working copy can also name a store key.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/

export function isStoreSegment(value: string): boolean {
  return SEGMENT.test(value) && !value.includes('..')
}

function segment(value: string): string {
  if (!isStoreSegment(value)) throw new Error('invalid store path segment')
  return value
}

/** where the wrapped key of `scope` lives under the key directory */
export function keyFilePath(dir: string, scope: StoreScope): string {
  return join(dir, segment(scope.deploymentId), `${segment(scope.accountId)}.key`)
}

export interface StoreKeyProvider {
  /** the 32-byte record key of `scope`; rejects with CredentialStoreError */
  key(scope: StoreScope): Promise<Buffer>
}

const KEY_BYTES = 32

export function createSafeStorageKeyProvider(options: {
  safeStorage: SafeStorageLike
  dir: string
}): StoreKeyProvider {
  const { safeStorage, dir } = options
  // parallel opens of one scope must agree on one key: the first creation is shared
  const creating = new Map<string, Promise<Buffer>>()

  /** a key file that is there but will not open: a lock, so the caller can retry */
  const unwrap = (wrapped: Buffer): Buffer => {
    let plain: string
    try {
      plain = safeStorage.decryptString(wrapped)
    } catch {
      throw new CredentialStoreError('keystore_locked')
    }
    const key = Buffer.from(plain, 'base64')
    // decrypting to something that is not a key cannot be repaired here, and
    // the records it wrote are unreadable anyway
    if (key.length !== KEY_BYTES) throw new CredentialStoreError('io')
    return key
  }

  const create = async (path: string): Promise<Buffer> => {
    const key = randomBytes(KEY_BYTES)
    let wrapped: Buffer
    try {
      // the keyring passed ensureAvailable but refuses: a locked keychain,
      // retryable, and never a plaintext key write
      wrapped = safeStorage.encryptString(key.toString('base64'))
    } catch {
      throw new CredentialStoreError('keystore_locked')
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await atomicWriteFile(path, wrapped)
    return key
  }

  return {
    async key(scope) {
      const path = keyFilePath(dir, scope)
      // no usable keyring at all is refused, never a plaintext fallback; a locked real
      // keyring with this scope's wrapped key already on disk is keystore_locked (FL-09)
      ensureKeyringAvailable(safeStorage, existsSync(path))
      let wrapped: Buffer
      try {
        wrapped = await readFile(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new CredentialStoreError('io')
        }
        const pending = creating.get(path) ?? create(path)
        creating.set(path, pending)
        try {
          return await pending
        } finally {
          if (creating.get(path) === pending) creating.delete(path)
        }
      }
      return unwrap(wrapped)
    },
  }
}
