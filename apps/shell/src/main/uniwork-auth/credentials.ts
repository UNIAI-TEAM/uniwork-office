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
import type { AccountEntitlements, AccountOrg, AccountProfile } from '../../shared/home-api'

/**
 * The persisted half of a desktop session: refresh token + device session,
 * bound to the deployment it was issued by. The access token is never
 * persisted (main-process memory only). The cached profile, organization and
 * plan ride along so server-unreachable can still show who is signed in.
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
  /** last known organization and plan (display while UniWork is unreachable) */
  org?: AccountOrg
  entitlements?: AccountEntitlements | null
}

export type CredentialStoreErrorCode = 'keyring_unavailable' | 'keystore_locked' | 'io'

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

/** Linux backends behind a real OS keyring: one that can be locked, unlike `basic_text` */
const REAL_KEYRING_BACKEND = /^(gnome_libsecret|kwallet\d*)$/

/**
 * No usable keyring: refused, never a plaintext fallback. A real keyring that
 * reports encryption unavailable while a secret it wrapped is already on disk
 * is a locked keyring (gnome-keyring with its prompt cancelled), not a missing
 * one: that is the transient `keystore_locked`, so the saved sign-in is kept
 * and offered again. `basic_text`, a host that names no backend, or no saved
 * secret stay `keyring_unavailable` (FL-09).
 */
export function ensureKeyringAvailable(safeStorage: SafeStorageLike, savedSecret: boolean): void {
  let backend: string | undefined
  try {
    backend = safeStorage.getSelectedStorageBackend?.()
  } catch {
    backend = undefined
  }
  if (backend === 'basic_text') throw new CredentialStoreError('keyring_unavailable')
  let available: boolean
  try {
    available = safeStorage.isEncryptionAvailable()
  } catch {
    available = false
  }
  if (available) return
  if (savedSecret && backend !== undefined && REAL_KEYRING_BACKEND.test(backend)) {
    throw new CredentialStoreError('keystore_locked')
  }
  throw new CredentialStoreError('keyring_unavailable')
}

export interface CredentialStore {
  load(): StoredCredential | null
  save(credential: StoredCredential): void
  clear(): void
  /** true when save() could encrypt right now (writes nothing, never plaintext) */
  canStore(): boolean
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

/** what one file on disk holds: a credential, nothing usable, or bytes the keyring cannot open now */
type ReadResult =
  | { kind: 'ok'; credential: StoredCredential }
  | { kind: 'corrupt' }
  | { kind: 'unsupported' }
  | { kind: 'locked' }

/**
 * Electron safeStorage (DPAPI on Windows, Keychain on macOS, Secret Service
 * on Linux) encrypts one envelope file. Writes go to a fsync'd temp file that
 * is renamed over the previous one, so a crash leaves either the old or the
 * new credential, never a torn one. There is no backup copy: refresh tokens
 * rotate, so an older copy is dead server-side and replaying it would make
 * the server revoke the whole device (refresh_reused).
 *
 * A file the keyring cannot decrypt right now (locked Keychain, keyring
 * swapped, DPAPI hiccup) is kept and reported as keystore_locked - a transient
 * lock, distinct from keyring_unavailable (no usable keyring at all); only a
 * file that decrypts to garbage is dropped. There is no plaintext fallback: a
 * Linux host on the `basic_text` backend or with encryption unavailable is
 * refused.
 *
 * A save is classified the same way: the keyring call (encryptString) is kept
 * apart from the file steps, so a keyring that refuses is keystore_locked
 * whichever half it hits, and only the file steps (mkdir, write, fsync,
 * rename) can be io. A save refused by the keyring throws before anything is
 * written, so the stored credential survives untouched for the next attempt.
 */
export function createCredentialStore(options: {
  userDataDir: string
  safeStorage: SafeStorageLike
}): CredentialStore {
  const dir = join(options.userDataDir, 'uniwork-auth')
  const target = join(dir, FILE)
  /** written by earlier builds; never read, only cleaned up */
  const legacyBackup = `${target}.bak`
  const { safeStorage } = options

  const ensureAvailable = (savedSecret = false) => ensureKeyringAvailable(safeStorage, savedSecret)

  const readTarget = (): ReadResult => {
    let plain: string
    try {
      plain = safeStorage.decryptString(readFileSync(target))
    } catch {
      return { kind: 'locked' }
    }
    let envelope: { version?: unknown; credential?: unknown }
    try {
      envelope = JSON.parse(plain) as { version?: unknown; credential?: unknown }
    } catch {
      return { kind: 'corrupt' }
    }
    // a newer build's format: leave it for that build, sign in fresh here
    if (typeof envelope?.version === 'number' && envelope.version > VERSION) {
      return { kind: 'unsupported' }
    }
    if (envelope?.version !== VERSION || !isStoredCredential(envelope.credential)) {
      return { kind: 'corrupt' }
    }
    return { kind: 'ok', credential: envelope.credential }
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
      ensureAvailable(existsSync(target))
      removeQuietly(legacyBackup)
      if (!existsSync(target)) return null
      const read = readTarget()
      switch (read.kind) {
        case 'ok':
          return read.credential
        case 'locked':
          // the refresh token may still be good once the keyring opens again;
          // this is a lock, not a missing keyring, so the caller can retry
          throw new CredentialStoreError('keystore_locked')
        case 'unsupported':
          return null
        case 'corrupt':
          removeQuietly(target)
          return null
      }
    },
    save(credential) {
      ensureAvailable()
      if (!isStoredCredential(credential)) throw new CredentialStoreError('io')
      // the one keyring call, kept apart from the file steps: the probe above
      // found a usable keyring, so a refusal here is the keystore failing to
      // open right now (locked keychain, DPAPI hiccup) - transient, and thrown
      // before any byte is written
      let encrypted: Buffer
      try {
        encrypted = safeStorage.encryptString(JSON.stringify({ version: VERSION, credential }))
      } catch {
        throw new CredentialStoreError('keystore_locked')
      }
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`
      let fd: number | undefined
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        writeFileSync(temp, encrypted, { mode: 0o600, flag: 'wx' })
        fd = openSync(temp, 'r+')
        fsyncSync(fd)
        closeSync(fd)
        fd = undefined
        // atomic replace (MoveFileEx REPLACE_EXISTING on Windows, rename(2) elsewhere)
        renameSync(temp, target)
      } catch {
        if (fd !== undefined) {
          try {
            closeSync(fd)
          } catch {
            // best effort
          }
        }
        removeQuietly(temp)
        // only file steps run here: a failure is a real io error
        throw new CredentialStoreError('io')
      }
      removeQuietly(legacyBackup)
    },
    clear() {
      removeQuietly(target)
      removeQuietly(legacyBackup)
    },
    canStore() {
      try {
        ensureAvailable()
        safeStorage.encryptString('probe')
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * E2E-only stand-in for the keyring-backed store: the credential lives in this
 * process's memory and is never written anywhere (no file, no plaintext
 * backend), so a restart forgets the session. See `accountCredentialStore`.
 */
export function createMemoryCredentialStore(): CredentialStore {
  let held: StoredCredential | null = null
  return {
    load: () => (held ? structuredClone(held) : null),
    save(credential) {
      if (!isStoredCredential(credential)) throw new CredentialStoreError('io')
      held = structuredClone(credential)
    },
    clear() {
      held = null
    },
    canStore: () => true,
  }
}
