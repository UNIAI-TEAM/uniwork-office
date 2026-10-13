import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BINDING_FILE,
  INTENT_PAYLOAD_FILE,
  bindingJson,
  type Binding,
} from '../src/main/uniwork-docs/binding-store'
import { createIntentStore, INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { migrateLegacyIntents } from '../src/main/uniwork-sync/migration'
import {
  createStoreLayer,
  type StoreLayer,
  type StoreRecords,
} from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * W3b: the schema 1 -> 2 migration. A pre-store working copy (binding.json
 * schema 1 with `pendingIntent` + pending-upload.bin) moves its intent into
 * the durable store, the binding is rewritten as schema 2 without the intent,
 * and the plaintext payload is deleted. A crash between the store write and
 * the plaintext delete is resumed by the next run and never mints a second
 * intent; while the store cannot open nothing runs at all (the caller opens it
 * first, see the service).
 */

const APP_VERSION = '0.11.0'
const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }
const DOC_KEY = '01J8X4DOC0N1P2Q3R4S5T6U7'
const DOCX = 'Plan.docx'
const PAYLOAD = Buffer.from('the exact bytes of the pending save')
const CHECKSUM = createHash('sha256').update(PAYLOAD).digest('hex')

const INTENT = {
  intentId: 'office-intent-legacy',
  idempotencyKey: 'office-key-legacy',
  documentId: DOC_KEY,
  baseRevision: '9007199254740993',
  checksum: CHECKSUM,
  createdAt: '2026-10-11T00:00:00.000Z',
}

let base: string
let root: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-migration-'))
  root = join(base, 'uniwork-documents')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

function makeLayer(options: { budgetBytes?: number } = {}): StoreLayer {
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({
      safeStorage: createLockableSafeStorage(),
      dir: join(base, 'keys'),
    }),
    budgetBytes: options.budgetBytes ?? 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  return layer
}

async function openRecords(layer: StoreLayer): Promise<(name: string) => StoreRecords> {
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
  return (name) => opened.store.records(name)
}

function copyDir(key: string, account = SCOPE.accountId): string {
  const dir = join(root, SCOPE.deploymentId, account, key)
  mkdirSync(dir, { recursive: true })
  return dir
}

function legacyBinding(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schema: 1,
    documentId: DOC_KEY,
    workspaceId: 'ws_1',
    orgId: 'org_a',
    title: 'Plan.docx',
    filename: DOCX,
    format: 'docx',
    access: 'edit',
    baseRevision: '41',
    baseVersion: 3,
    baseChecksum: 'abc',
    state: 'saving',
    pendingIntent: INTENT,
    ...overrides,
  }
}

/** seed a pre-store working copy: binding.json (schema 1 + pendingIntent) + pending-upload.bin */
function seedLegacy(binding: Record<string, unknown> = legacyBinding()): string {
  const dir = copyDir(DOC_KEY)
  writeFileSync(join(dir, DOCX), PAYLOAD)
  writeFileSync(join(dir, BINDING_FILE), JSON.stringify(binding, null, 2))
  writeFileSync(join(dir, INTENT_PAYLOAD_FILE), PAYLOAD)
  return dir
}

const bindingAt = (dir: string) =>
  JSON.parse(readFileSync(join(dir, BINDING_FILE), 'utf8')) as Record<string, unknown>

const recordFiles = (): string[] => {
  const found: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else found.push(path)
    }
  }
  try {
    visit(join(base, 'records'))
  } catch {
    return []
  }
  return found
}

describe('migrateLegacyIntents', () => {
  it('moves the intent into the store, rewrites the binding as schema 2 and deletes the plaintext', async () => {
    const dir = seedLegacy()
    const layer = makeLayer()
    const report = await migrateLegacyIntents({
      root,
      scope: SCOPE,
      records: await openRecords(layer),
      appVersion: APP_VERSION,
    })
    expect(report).toEqual({ found: 1, migrated: 1, cleaned: 1, deferred: 0 })

    // the intent is in the store, field for field, with the exact payload bytes
    const intent = await createIntentStore((await openRecords(layer))('intents')).get(DOC_KEY)
    expect(intent?.intent).toEqual(INTENT)
    expect(Buffer.from(intent?.payload ?? [])).toEqual(PAYLOAD)
    expect(intent?.intent.baseRevision).toBe('9007199254740993')

    // the binding is what this build writes: schema 2, no pendingIntent
    const binding = bindingAt(dir)
    expect(binding).toMatchObject({
      schema: 2,
      min_store_level: 2,
      min_app_version: APP_VERSION,
      documentId: DOC_KEY,
      baseRevision: '41',
      state: 'dirty',
    })
    expect(binding).not.toHaveProperty('pendingIntent')
    // the plaintext payload is gone, the working copy itself is not
    expect(existsSync(join(dir, INTENT_PAYLOAD_FILE))).toBe(false)
    expect(existsSync(join(dir, DOCX))).toBe(true)
    // one record, under the intents store
    expect(
      recordFiles().filter((path) => path.includes(INTENT_STORE_REGISTRATION.name)),
    ).toHaveLength(1)
  })

  it('a crash between the store write and the plaintext delete is resumed with one intent', async () => {
    const dir = seedLegacy()
    const layer = makeLayer()
    // the state a crash leaves: the intent already in the store, the binding
    // still schema 1 and the payload still on disk
    const records = await openRecords(layer)
    await createIntentStore(records('intents')).put(DOC_KEY, INTENT, PAYLOAD)
    const report = await migrateLegacyIntents({
      root,
      scope: SCOPE,
      records,
      appVersion: APP_VERSION,
    })
    expect(report).toEqual({ found: 1, migrated: 1, cleaned: 1, deferred: 0 })
    // one record only: the resumed run overwrote the same key
    const files = recordFiles().filter((path) => path.includes(INTENT_STORE_REGISTRATION.name))
    expect(files).toHaveLength(1)
    const again = await createIntentStore(records('intents')).get(DOC_KEY)
    expect(again?.intent.intentId).toBe(INTENT.intentId)
    expect(bindingAt(dir).schema).toBe(2)
    expect(existsSync(join(dir, INTENT_PAYLOAD_FILE))).toBe(false)
    // and a third run has nothing left to do
    const third = await migrateLegacyIntents({
      root,
      scope: SCOPE,
      records,
      appVersion: APP_VERSION,
    })
    expect(third).toEqual({ found: 0, migrated: 0, cleaned: 0, deferred: 0 })
    expect(
      recordFiles().filter((path) => path.includes(INTENT_STORE_REGISTRATION.name)),
    ).toHaveLength(1)
  })

  it('a payload that is not the intent’s bytes never becomes an intent', async () => {
    const dir = seedLegacy()
    writeFileSync(join(dir, INTENT_PAYLOAD_FILE), 'other bytes entirely')
    const layer = makeLayer()
    const report = await migrateLegacyIntents({
      root,
      scope: SCOPE,
      records: await openRecords(layer),
      appVersion: APP_VERSION,
    })
    expect(report).toEqual({ found: 1, migrated: 0, cleaned: 1, deferred: 0 })
    expect(await createIntentStore((await openRecords(layer))('intents')).get(DOC_KEY)).toBeNull()
    expect(bindingAt(dir).schema).toBe(2)
    expect(bindingAt(dir)).not.toHaveProperty('pendingIntent')
    expect(existsSync(join(dir, INTENT_PAYLOAD_FILE))).toBe(false)
  })

  it('never touches another account’s copies, plain schema-1 copies or unreadable ones', async () => {
    const mine = seedLegacy()
    const otherDir = copyDir(DOC_KEY, 'acc_2')
    writeFileSync(join(otherDir, DOCX), PAYLOAD)
    writeFileSync(join(otherDir, BINDING_FILE), JSON.stringify(legacyBinding()))
    writeFileSync(join(otherDir, INTENT_PAYLOAD_FILE), PAYLOAD)
    const plainDir = copyDir('plain_doc')
    writeFileSync(
      join(plainDir, BINDING_FILE),
      JSON.stringify({ ...legacyBinding(), state: 'ready', pendingIntent: undefined }),
    )
    const plainBefore = readFileSync(join(plainDir, BINDING_FILE), 'utf8')
    const brokenDir = copyDir('broken')
    writeFileSync(join(brokenDir, BINDING_FILE), 'not json')

    const layer = makeLayer()
    const report = await migrateLegacyIntents({
      root,
      scope: SCOPE,
      records: await openRecords(layer),
      appVersion: APP_VERSION,
    })
    expect(report).toEqual({ found: 1, migrated: 1, cleaned: 1, deferred: 0 })
    expect(bindingAt(mine).schema).toBe(2)
    // the other account keeps its pre-store state untouched
    expect(bindingAt(otherDir).schema).toBe(1)
    expect(bindingAt(otherDir).pendingIntent).toBeTruthy()
    expect(existsSync(join(otherDir, INTENT_PAYLOAD_FILE))).toBe(true)
    // a schema-1 copy without an intent is untouched (it upgrades on its next write)
    expect(readFileSync(join(plainDir, BINDING_FILE), 'utf8')).toBe(plainBefore)
    expect(readFileSync(join(brokenDir, BINDING_FILE), 'utf8')).toBe('not json')
  })

  it('a schema-2 copy with a stray payload (crash after the rewrite) loses only the payload', async () => {
    const dir = copyDir(DOC_KEY)
    const binding: Binding = {
      schema: 2,
      documentId: DOC_KEY,
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: DOCX,
      filename: DOCX,
      format: 'docx',
      access: 'edit',
      baseRevision: '42',
      baseVersion: 4,
      baseChecksum: 'def',
      state: 'saved',
      minStoreLevel: 2,
      minAppVersion: APP_VERSION,
    }
    writeFileSync(join(dir, DOCX), PAYLOAD)
    writeFileSync(join(dir, BINDING_FILE), JSON.stringify(bindingJson(binding), null, 2))
    writeFileSync(join(dir, INTENT_PAYLOAD_FILE), PAYLOAD)
    const before = readFileSync(join(dir, BINDING_FILE), 'utf8')
    const layer = makeLayer()
    const report = await migrateLegacyIntents({
      root,
      scope: SCOPE,
      records: await openRecords(layer),
      appVersion: APP_VERSION,
    })
    expect(report).toEqual({ found: 0, migrated: 0, cleaned: 1, deferred: 0 })
    expect(readFileSync(join(dir, BINDING_FILE), 'utf8')).toBe(before)
    expect(existsSync(join(dir, INTENT_PAYLOAD_FILE))).toBe(false)
  })

  it('a store that refuses the write leaves the plaintext exactly as it is and reports the deferral', async () => {
    const dir = seedLegacy()
    const layer = makeLayer({ budgetBytes: 1 })
    const before = {
      binding: readFileSync(join(dir, BINDING_FILE), 'utf8'),
      payload: readFileSync(join(dir, INTENT_PAYLOAD_FILE), 'utf8'),
    }
    const report = await migrateLegacyIntents({
      root,
      scope: SCOPE,
      records: await openRecords(layer),
      appVersion: APP_VERSION,
    })
    // deferred, not "migrated nothing": the caller must retry, never treat the
    // scope as done (R1-be-5)
    expect(report).toEqual({ found: 1, migrated: 0, cleaned: 0, deferred: 1 })
    expect(readFileSync(join(dir, BINDING_FILE), 'utf8')).toBe(before.binding)
    expect(readFileSync(join(dir, INTENT_PAYLOAD_FILE), 'utf8')).toBe(before.payload)
    expect(recordFiles()).toEqual([])
  })
})
