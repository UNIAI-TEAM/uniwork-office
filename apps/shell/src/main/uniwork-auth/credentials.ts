import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { AccountProfile } from '../../shared/home-api'

/**
 * The persisted half of a desktop session: refresh token + device session,
 * bound to the deployment it was issued by. The access token is never
 * persisted (main-process memory only). The cached profile rides along so
 * server-unreachable can still show who is signed in.
 */
export interface StoredCredential {
  deploymentId: string
  apiOrigin: string
  clientId: string
  accountId: string
  deviceSessionId: string
  sessionId: string
  refreshToken: string
  /** epoch ms; past this the refresh token is dead and the session expired */
  refreshExpiresAt: number
  profile?: AccountProfile
}

export type CredentialStoreErrorCode = 'keyring_unavailable' | 'io'

export class CredentialStoreError extends Error {
  readonly code: CredentialStoreErrorCode
  constructor(code: CredentialStoreErrorCode) {
    // coarse code only: no paths, ciphertext or token-shaped values
    super(`credential store: ${code}`)
    this.name = 'CredentialStoreError'
    this.code = code
  }
}

/** the slice of Electron's safeStorage this store needs */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only; `basic_text` means no keyring and is refused */
  getSelectedStorageBackend?(): string
}

export interface CredentialStore {
  load(): StoredCredential | null
  save(credential: StoredCredential): void
  clear(): void
}

const VERSION = 1
const FILE = 'session.bin'

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const strings = [
    'deploymentId',
    'apiOrigin',
    'clientId',
    'accountId',
    'deviceSessionId',
    'sessionId',
    'refreshToken',
  ]
  return (
    strings.every((key) => typeof v[key] === 'string' && (v[key] as string).length > 0) &&
    typeof v.refreshExpiresAt === 'number' &&
    Number.isFinite(v.refreshExpiresAt)
  )
}

/**
 * Electron safeStorage (DPAPI on Windows, Keychain on macOS, Secret Service
 * on Linux) encrypts one envelope file. Writes go to a fsync'd temp file and
 * are renamed into place; the previous good file is kept as `.bak` so a torn
 * or corrupt write recovers. There is no plaintext fallback: a Linux host on
 * the `basic_text` backend or with encryption unavailable is refused.
 */
export function createCredentialStore(options: {
  userDataDir: string
  safeStorage: SafeStorageLike
}): CredentialStore {
  const dir = join(options.userDataDir, 'uniwork-auth')
  const target = join(dir, FILE)
  const backup = `${target}.bak`
  const { safeStorage } = options

  const ensureAvailable = () => {
    let backend: string | undefined
    try {
      backend = safeStorage.getSelectedStorageBackend?.()
    } catch {
      backend = undefined
    }
    if (backend === 'basic_text') throw new CredentialStoreError('keyring_unavailable')
    let available = false
    try {
      available = safeStorage.isEncryptionAvailable()
    } catch {
      available = false
    }
    if (!available) throw new CredentialStoreError('keyring_unavailable')
  }

  const readFile = (path: string): StoredCredential | null => {
    try {
      const parsed: unknown = JSON.parse(safeStorage.decryptString(readFileSync(path)))
      const envelope = parsed as { version?: unknown; credential?: unknown }
      if (envelope?.version !== VERSION || !isStoredCredential(envelope.credential)) return null
      return envelope.credential
    } catch {
      return null
    }
  }

  const removeQuietly = (path: string) => {
    try {
      rmSync(path, { force: true })
    } catch {
      // best effort
    }
  }

  return {
    load() {
      ensureAvailable()
      const primary = existsSync(target) ? readFile(target) : null
      if (primary) return primary
      const fallback = existsSync(backup) ? readFile(backup) : null
      if (fallback) {
        // restore the last good copy over the missing/corrupt primary
        try {
          writeFileSync(target, readFileSync(backup), { mode: 0o600 })
        } catch {
          // the backup still serves the next load
        }
        return fallback
      }
      // nothing readable: drop the unreadable bytes so they cannot linger
      removeQuietly(target)
      removeQuietly(backup)
      return null
    },
    save(credential) {
      ensureAvailable()
      if (!isStoredCredential(credential)) throw new CredentialStoreError('io')
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`
      let fd: number | undefined
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        const encrypted = safeStorage.encryptString(
          JSON.stringify({ version: VERSION, credential }),
        )
        writeFileSync(temp, encrypted, { mode: 0o600, flag: 'wx' })
        fd = openSync(temp, 'r+')
        fsyncSync(fd)
        closeSync(fd)
        fd = undefined
        if (existsSync(target) && readFile(target)) renameSync(target, backup)
        renameSync(temp, target)
      } catch (error) {
        if (fd !== undefined) {
          try {
            closeSync(fd)
          } catch {
            // best effort
          }
        }
        removeQuietly(temp)
        if (error instanceof CredentialStoreError) throw error
        throw new CredentialStoreError('io')
      }
    },
    clear() {
      removeQuietly(target)
      removeQuietly(backup)
    },
  }
}

/** test/dev seam: same contract, nothing on disk */
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
  }
}
