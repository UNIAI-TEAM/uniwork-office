import { existsSync, readFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import {
  type Binding,
  BINDING_FILE,
  INTENT_PAYLOAD_FILE,
  bindingJson,
  parseBinding,
  scopeWorkingCopyDirs,
} from '../uniwork-docs/binding-store'
import { sha256Hex } from '../uniwork-docs/formats'
import { createIntentStore, parseIntentRecord, type IntentStore } from './intent-store'
import type { StoreScope } from './keys'
import type { StoreRecords } from './store'

/**
 * The one-way schema 1 -> 2 migration. A pre-store build kept a pending save
 * intent as `pendingIntent` inside binding.json plus its bytes in
 * `pending-upload.bin`; this build keeps the intent in the durable store and
 * never writes either plaintext file. For every working copy of the account
 * that still has the old pair the sweep:
 *
 * 1. writes the intent (fields + exact payload bytes) into the `intents`
 *    store - the record key is the working-copy folder, so a resumed run
 *    overwrites the same record and can never mint a second intent;
 * 2. rewrites binding.json as schema 2 without the pendingIntent;
 * 3. deletes pending-upload.bin.
 *
 * A crash between the steps is resumed by the next run (the binding still
 * reads schema 1 while the payload exists). The caller opens the store first:
 * while the keychain is locked nothing runs and no plaintext is touched. A
 * schema-2 copy with a stray payload (a crash after step 2) just loses the
 * payload, which the store already holds.
 */

export interface LegacyIntentMigrationReport {
  /** working copies that still held a valid pre-store intent */
  found: number
  /** intents written into the store by this run */
  migrated: number
  /** plaintext payloads dropped (a migrated or unusable pair) */
  cleaned: number
}

export interface LegacyIntentMigrationDeps {
  /** the working-copy root (BindingStore.root) */
  root: string
  scope: StoreScope
  /** the account's registered stores, as the opened layer hands them back */
  records(name: string): StoreRecords
  /** the build's version, stamped into the rewritten bindings */
  appVersion: string
  log?(message: string): void
}

function readRawBinding(dir: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, BINDING_FILE), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as Record<string, unknown>
  } catch {
    return null
  }
}

/** the binding.json this build writes: schema 2, no pendingIntent, this version */
async function rewriteBinding(dir: string, binding: Binding, appVersion: string): Promise<void> {
  const next = bindingJson({ ...binding, minAppVersion: appVersion })
  await atomicWriteFile(
    join(dir, BINDING_FILE),
    new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`),
  )
}

async function dropPayload(path: string): Promise<void> {
  await unlink(path).catch(() => undefined)
}

export async function migrateLegacyIntents(
  deps: LegacyIntentMigrationDeps,
): Promise<LegacyIntentMigrationReport> {
  const report: LegacyIntentMigrationReport = { found: 0, migrated: 0, cleaned: 0 }
  const intents: IntentStore = createIntentStore(deps.records('intents'))
  for (const dir of scopeWorkingCopyDirs(deps.root, deps.scope)) {
    const raw = readRawBinding(dir)
    if (!raw) continue
    const payloadPath = join(dir, INTENT_PAYLOAD_FILE)
    const legacy =
      raw.schema === 1 && raw.pendingIntent !== undefined
        ? parseIntentRecord(raw.pendingIntent)
        : null
    if (!legacy) {
      // no intent to move; a payload left behind (a crash after the binding was
      // rewritten, or an intent the old build had already dropped) belongs to
      // nothing and goes - with the schema-1 binding upgraded with it
      if (!existsSync(payloadPath)) continue
      const binding = raw.schema === 1 ? parseBinding(raw) : null
      if (binding) await rewriteBinding(dir, binding, deps.appVersion)
      await dropPayload(payloadPath)
      report.cleaned += 1
      continue
    }
    report.found += 1
    const binding = parseBinding(raw)
    if (!binding) continue
    const payload = existsSync(payloadPath)
      ? new Uint8Array(readFileSync(payloadPath) as Buffer)
      : null
    if (payload && sha256Hex(payload) === legacy.checksum) {
      // one record per working copy: a resumed run overwrites the same intent
      const written = await intents.put(basename(dir), legacy, payload)
      if (written.kind !== 'ok') {
        // the store cannot take it right now: leave the plaintext exactly as it
        // is and let the next open retry the whole copy
        deps.log?.('uniwork sync: legacy intent migration deferred (store refused the write)')
        continue
      }
      report.migrated += 1
    } else if (payload) {
      // the payload is not the intent's bytes: it could never be replayed
      deps.log?.('uniwork sync: legacy intent payload did not match its checksum, dropped')
    }
    await rewriteBinding(dir, binding, deps.appVersion)
    if (existsSync(payloadPath)) {
      await dropPayload(payloadPath)
      report.cleaned += 1
    }
  }
  return report
}
