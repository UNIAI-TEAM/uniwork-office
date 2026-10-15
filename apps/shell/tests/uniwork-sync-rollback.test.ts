import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BINDING_FILE,
  INTENT_PAYLOAD_FILE,
  type Binding,
} from '../src/main/uniwork-docs/binding-store'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { migrateLegacyIntents } from '../src/main/uniwork-sync/migration'
import { DRAFTS_STORE_REGISTRATION, createDraftStore } from '../src/main/uniwork-sync/queue/drafts'
import {
  PARKED_STORE_REGISTRATION,
  createParkedStore,
  type ParkedCopy,
} from '../src/main/uniwork-sync/queue/parked'
import { PAUSE_STORE_REGISTRATION, createPauseStore } from '../src/main/uniwork-sync/queue/pause'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  createStoreCursorStore,
  createStoreDocCache,
} from '../src/main/uniwork-sync/runtime'
import { SYNC_STORE_REGISTRATIONS } from '../src/main/uniwork-sync/session-store'
import { APP_STORE_LEVEL, readStoreGate } from '../src/main/uniwork-sync/store-level'
import {
  createStoreLayer,
  recordPath,
  scopeDir,
  type StoreLayer,
} from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }
const HIGHER_LEVEL = APP_STORE_LEVEL + 1

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-rollback-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function listFilesUnder(root: string): string[] {
  const found: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else found.push(path)
    }
  }
  try {
    visit(root)
  } catch {
    return []
  }
  return found.sort()
}

function snapshotTree(root: string): Array<[string, Buffer]> {
  return listFilesUnder(root).map((path) => [path, Buffer.from(readFileSync(path))])
}

function makeBinding(documentId: string, minStoreLevel = APP_STORE_LEVEL): Binding {
  return {
    schema: 2,
    documentId,
    workspaceId: 'ws_1',
    orgId: 'org_1',
    title: 'Quarterly Plan',
    filename: 'plan.docx',
    format: 'docx',
    access: 'edit',
    baseRevision: '7',
    baseVersion: 3,
    baseChecksum: 'b'.repeat(64),
    state: 'dirty',
    minStoreLevel,
    minAppVersion: '9.0.0',
  }
}

describe('uniwork sync rollback and re-upgrade guard (G5-11)', () => {
  it('a scope holding level-3 records + a schema-3 binding: lock, reopen, the records are refused and kept byte-for-byte, no intent written', async () => {
    const safeStorage = createLockableSafeStorage()
    const storeRoot = join(base, 'store')
    const keyDir = join(base, 'keys')
    const docsRoot = join(base, 'documents')

    // N+1 build (storeLevel = 3) writes level-3 records across every registered store
    const level3Layer = createStoreLayer({
      root: storeRoot,
      keys: createSafeStorageKeyProvider({ safeStorage, dir: keyDir }),
      budgetBytes: 1 << 20,
      clock: () => 1_700_000_000_000,
      storeLevel: HIGHER_LEVEL,
    } as Parameters<typeof createStoreLayer>[0] & { storeLevel?: number })
    for (const reg of SYNC_STORE_REGISTRATIONS) {
      level3Layer.register({ ...reg, minStoreLevel: HIGHER_LEVEL })
    }
    const opened3 = await level3Layer.open(SCOPE)
    if (opened3.kind !== 'ok') throw new Error(opened3.kind)
    for (const reg of SYNC_STORE_REGISTRATIONS) {
      expect(
        await opened3.store.records(reg.name).write('doc_newer', Buffer.from(`level3-${reg.name}`)),
      ).toEqual({ kind: 'ok' })
    }
    await level3Layer.lock(SCOPE)

    // Working-copy folder with a schema-3 binding and a pre-store payload
    const docDir = join(docsRoot, SCOPE.deploymentId, SCOPE.accountId, 'doc_newer')
    mkdirSync(docDir, { recursive: true })
    writeFileSync(join(docDir, 'plan.docx'), Buffer.from('newer-docx-bytes'))
    writeFileSync(
      join(docDir, BINDING_FILE),
      JSON.stringify(
        {
          schema: 3,
          documentId: 'doc_newer',
          workspaceId: 'ws_1',
          orgId: 'org_1',
          title: 'Quarterly Plan',
          filename: 'plan.docx',
          format: 'docx',
          access: 'edit',
          baseRevision: '7',
          baseVersion: 3,
          baseChecksum: 'b'.repeat(64),
          state: 'dirty',
          min_store_level: HIGHER_LEVEL,
          min_app_version: '9.0.0',
          pendingIntent: {
            intentId: 'int_newer',
            createdAt: '2026-10-14T12:00:00.000Z',
            baseRevision: '7',
            baseChecksum: 'b'.repeat(64),
            payloadChecksum: 'c'.repeat(64),
          },
        },
        null,
        2,
      ),
    )
    writeFileSync(join(docDir, INTENT_PAYLOAD_FILE), Buffer.from('newer-intent-payload'))

    const storeBefore = snapshotTree(scopeDir(storeRoot, SCOPE))
    const docsBefore = snapshotTree(docsRoot)
    expect(storeBefore.length).toBe(SYNC_STORE_REGISTRATIONS.length)
    expect(readStoreGate(JSON.parse(readFileSync(join(docDir, BINDING_FILE), 'utf8')))).toBe(
      'store_newer',
    )

    // Rolled-back N' build (APP_STORE_LEVEL = 2): opens, locks, reopens
    const makeCurrentLayer = (): StoreLayer => {
      const layer = createStoreLayer({
        root: storeRoot,
        keys: createSafeStorageKeyProvider({ safeStorage, dir: keyDir }),
        budgetBytes: 1 << 20,
        clock: () => 1_700_000_000_100,
      })
      for (const reg of SYNC_STORE_REGISTRATIONS) layer.register(reg)
      return layer
    }

    const currentLayer = makeCurrentLayer()
    const opened2 = await currentLayer.open(SCOPE)
    if (opened2.kind !== 'ok') throw new Error(opened2.kind)

    // every level-3 record is refused before decryption
    for (const reg of SYNC_STORE_REGISTRATIONS) {
      expect(await opened2.store.records(reg.name).read('doc_newer')).toEqual({ kind: 'refused' })
    }
    const migration = await migrateLegacyIntents({
      root: docsRoot,
      scope: SCOPE,
      records: (name) => opened2.store.records(name),
      appVersion: '0.11.0',
    })
    expect(migration).toEqual({ found: 0, migrated: 0, cleaned: 0, deferred: 0 })

    // Lock and reopen on the N' build: records are still refused and kept byte-for-byte
    await currentLayer.lock(SCOPE)
    const reopenedLayer = makeCurrentLayer()
    const reopened2 = await reopenedLayer.open(SCOPE)
    if (reopened2.kind !== 'ok') throw new Error(reopened2.kind)
    for (const reg of SYNC_STORE_REGISTRATIONS) {
      expect(await reopened2.store.records(reg.name).read('doc_newer')).toEqual({ kind: 'refused' })
    }
    const intents2 = createIntentStore(reopened2.store.records(INTENT_STORE_REGISTRATION.name))
    expect(await intents2.get('doc_newer')).toBeNull()
    const parked2 = createParkedStore(reopened2.store.records(PARKED_STORE_REGISTRATION.name))
    expect(await parked2.list()).toEqual([])
    expect(await parked2.take('doc_newer')).toBeNull()

    expect(snapshotTree(scopeDir(storeRoot, SCOPE))).toEqual(storeBefore)
    expect(snapshotTree(docsRoot)).toEqual(docsBefore)
  })

  it('re-upgrade (layer at the higher level) reads every record and the parked copy after a sign-out/sign-in cycle', async () => {
    const safeStorage = createLockableSafeStorage()
    const storeRoot = join(base, 'store')
    const keyDir = join(base, 'keys')

    const makeHigherLayer = (): StoreLayer => {
      const layer = createStoreLayer({
        root: storeRoot,
        keys: createSafeStorageKeyProvider({ safeStorage, dir: keyDir }),
        budgetBytes: 1 << 20,
        clock: () => 1_700_000_000_000,
        storeLevel: HIGHER_LEVEL,
      } as Parameters<typeof createStoreLayer>[0] & { storeLevel?: number })
      for (const reg of SYNC_STORE_REGISTRATIONS) {
        layer.register({ ...reg, minStoreLevel: HIGHER_LEVEL })
      }
      return layer
    }

    // 1. Higher-level build writes records into every store, including a parked copy, then signs out (locks)
    const initialHigher = makeHigherLayer()
    const openedHigh1 = await initialHigher.open(SCOPE)
    if (openedHigh1.kind !== 'ok') throw new Error(openedHigh1.kind)

    const intentsHigh1 = createIntentStore(
      openedHigh1.store.records(INTENT_STORE_REGISTRATION.name),
    )
    const intentPayload = Buffer.from('queued-snapshot-n')
    expect(
      await intentsHigh1.put(
        'doc_1',
        {
          intentId: 'int_1',
          idempotencyKey: 'idem_1',
          documentId: 'doc_1',
          baseRevision: '7',
          checksum: 'a'.repeat(64),
          createdAt: '2026-10-14T12:00:00.000Z',
        },
        intentPayload,
      ),
    ).toEqual({ kind: 'ok' })

    const draftsHigh1 = createDraftStore(openedHigh1.store.records(DRAFTS_STORE_REGISTRATION.name))
    expect(
      await draftsHigh1.keep('doc_1', Buffer.from('kept-draft-bytes'), {
        id: 'd1',
        createdAt: '2026-10-14T12:01:00.000Z',
        title: 'Quarterly Plan',
      }),
    ).toBe('ok')

    const pauseHigh1 = createPauseStore(openedHigh1.store.records(PAUSE_STORE_REGISTRATION.name))
    expect(await pauseHigh1.setPaused(true)).toEqual({ kind: 'ok' })

    const cursorsHigh1 = createStoreCursorStore(
      openedHigh1.store.records(FEED_CURSORS_REGISTRATION.name),
    )
    await cursorsHigh1.set('dep_1/acc_1/org_1/ws_1', 'cursor_42')

    const docIndexHigh1 = createStoreDocCache({
      records: openedHigh1.store.records(DOC_INDEX_REGISTRATION.name),
      scope: { ...SCOPE, orgId: 'org_1', workspaceId: 'ws_1' },
    })
    expect(
      await docIndexHigh1.applyPage([
        {
          documentId: 'doc_1',
          kind: 'updated',
          revision: '7',
          currentVersion: 3,
          versionId: 'v3',
        },
      ]),
    ).toEqual({ kind: 'ok', applied: ['doc_1'] })

    const parkedHigh1 = createParkedStore(openedHigh1.store.records(PARKED_STORE_REGISTRATION.name))
    const parkedCopy: ParkedCopy = {
      documentKey: 'doc_1',
      binding: makeBinding('doc_1', HIGHER_LEVEL),
      bytes: Buffer.from('parked-working-copy-n-plus-1'),
      parkedAt: '2026-10-14T12:02:00.000Z',
    }
    expect(await parkedHigh1.park(parkedCopy)).toBe('ok')
    await initialHigher.lock(SCOPE)

    // 2. Rolled-back N' build signs in and signs out: refuses level-3 records and leaves them intact
    const rolledBack = createStoreLayer({
      root: storeRoot,
      keys: createSafeStorageKeyProvider({ safeStorage, dir: keyDir }),
      budgetBytes: 1 << 20,
      clock: () => 1_700_000_000_200,
    })
    for (const reg of SYNC_STORE_REGISTRATIONS) rolledBack.register(reg)
    const openedLow = await rolledBack.open(SCOPE)
    if (openedLow.kind !== 'ok') throw new Error(openedLow.kind)
    expect(
      await createParkedStore(openedLow.store.records(PARKED_STORE_REGISTRATION.name)).list(),
    ).toEqual([])
    expect(
      await createIntentStore(openedLow.store.records(INTENT_STORE_REGISTRATION.name)).get('doc_1'),
    ).toBeNull()
    await rolledBack.lock(SCOPE)

    // 3. Re-upgrade to the higher level: every record and the parked copy are read back intact
    const reupgraded = makeHigherLayer()
    const openedHigh2 = await reupgraded.open(SCOPE)
    if (openedHigh2.kind !== 'ok') throw new Error(openedHigh2.kind)

    const intentsHigh2 = createIntentStore(
      openedHigh2.store.records(INTENT_STORE_REGISTRATION.name),
    )
    const readIntent = await intentsHigh2.get('doc_1')
    expect(readIntent?.intent.intentId).toBe('int_1')
    expect(Buffer.from(readIntent?.payload ?? [])).toEqual(intentPayload)

    const draftsHigh2 = createDraftStore(openedHigh2.store.records(DRAFTS_STORE_REGISTRATION.name))
    const drafts = await draftsHigh2.list('doc_1')
    expect(drafts).toHaveLength(1)
    expect(Buffer.from(drafts[0]?.snapshot ?? [])).toEqual(Buffer.from('kept-draft-bytes'))

    const pauseHigh2 = createPauseStore(openedHigh2.store.records(PAUSE_STORE_REGISTRATION.name))
    expect(await pauseHigh2.isPaused()).toBe(true)

    const cursorsHigh2 = createStoreCursorStore(
      openedHigh2.store.records(FEED_CURSORS_REGISTRATION.name),
    )
    expect(await cursorsHigh2.get('dep_1/acc_1/org_1/ws_1')).toBe('cursor_42')

    const indexRead = await openedHigh2.store
      .records(DOC_INDEX_REGISTRATION.name)
      .read('org_1/ws_1/index')
    expect(indexRead.kind).toBe('ok')

    const parkedHigh2 = createParkedStore(openedHigh2.store.records(PARKED_STORE_REGISTRATION.name))
    expect(await parkedHigh2.list()).toEqual(['doc_1'])
    const restored = await parkedHigh2.take('doc_1')
    expect(restored).not.toBeNull()
    expect(restored?.binding).toEqual(parkedCopy.binding)
    expect(restored?.parkedAt).toBe(parkedCopy.parkedAt)
    expect(Buffer.from(restored?.bytes ?? [])).toEqual(Buffer.from(parkedCopy.bytes))
    expect(
      readFileSync(recordPath(storeRoot, SCOPE, PARKED_STORE_REGISTRATION.name, 'doc_1')).length,
    ).toBeGreaterThan(0)
  })
})
