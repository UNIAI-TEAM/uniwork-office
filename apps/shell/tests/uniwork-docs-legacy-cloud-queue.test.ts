import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  DOC,
  binding,
  commitCalls,
  fakeServer,
  ooxml,
  openDoc,
  setup,
  storedIntent,
  uploadCalls,
  useWorkDir,
  type Ctx,
} from './uniwork-docs-legacy-cloud-kit'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { basename, dirname, join } from 'node:path'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { parseStoredIntent } from '../src/main/uniwork-sync/queue/record'

useWorkDir()

/**
 * UNI-2212 (C4 fix-a): the durable queue record owns the conversion its commit declares. A restart,
 * a lost answer or a binding that changed in between never changes what the same intent sends.
 */

/** a converted copy with edits, saved while offline: one durable paused intent, nothing sent */
async function pausedConvertedIntent(server: ReturnType<typeof fakeServer>) {
  const ctx = setup(server, { queue: true })
  const path = await openDoc(ctx)
  const edited = await ooxml('xlsx', 'offline edits')
  writeFileSync(path, edited)
  ctx.setCapabilityOffline(true)
  await ctx.service.save(path)
  const stored = await storedIntent(ctx, path)
  expect(stored).not.toBeNull()
  expect(commitCalls(server)).toHaveLength(0)
  return {
    ctx,
    path,
    edited,
    intent: (stored as unknown as { intent: Record<string, unknown> }).intent,
  }
}

describe('UNI-2212 a queued converted intent keeps its conversion', () => {
  it('the intent is minted with the conversion snapshot', async () => {
    const { intent } = await pausedConvertedIntent(
      fakeServer({ legacy: 'xls', title: 'Budget.xls' }),
    )
    expect(intent.conversion).toEqual({ from: 'xls', to: 'xlsx' })
  })

  it('an ordinary document mints its intent as an ordinary commit (absence is snapshotted too)', async () => {
    const server = fakeServer({ ooxml: 'xlsx', title: 'Plan.xlsx' })
    const ctx = setup(server, { queue: true })
    const path = await openDoc(ctx)
    writeFileSync(path, await ooxml('xlsx', 'edit'))
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    const stored = (await storedIntent(ctx, path)) as unknown as { intent: Record<string, unknown> }
    expect(stored.intent.conversion).toBeNull()
  })

  it('a view launch of the document in between does not change the queued commit', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const { ctx, path, edited, intent } = await pausedConvertedIntent(server)
    // the same document is opened again as a view launch: the binding becomes read-only and
    // drops the conversion flag, the durable intent stays what it was
    await ctx.service.openFromServer(DOC, {
      receiptId: '',
      redeemedAt: '',
      downloadPath: '',
      id: DOC,
      organizationId: 'org_a',
      workspaceId: 'ws_1',
      title: 'Budget.xls',
      operation: 'view',
      version: 0,
      revision: '1',
    })
    expect(binding(path)).toMatchObject({ access: 'view' })
    expect(binding(path).legacyFrom).toBeUndefined()
    // the queue resumes: its commit carries the pair and the key the intent was minted with
    ctx.setCapabilityOffline(false)
    await ctx.service.pollSaveQueue()
    expect(commitCalls(server)).toHaveLength(1)
    const sent = commitCalls(server)[0]!
    expect(sent.body).toMatchObject({ conversion: { from_format: 'xls', to_format: 'xlsx' } })
    expect(sent.headers['idempotency-key']).toBe(intent.idempotencyKey)
    expect(server.versions).toHaveLength(2)
    expect(server.versions[1]).toMatchObject({ reason: 'converted_version' })
    expect(Buffer.from(server.versions[1]!.bytes).equals(Buffer.from(edited))).toBe(true)
  })

  it('an intent minted before the snapshot existed still reads the binding', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const { ctx, path } = await pausedConvertedIntent(server)
    // strip the snapshot from the stored record, as a record written by an older build is
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store')
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const key = basename(dirname(path))
    const stored = (await intents.get(key))!
    const { conversion: _dropped, ...older } = stored.intent as unknown as Record<string, unknown>
    await intents.put(key, older as never, stored.payload)
    expect(
      ((await intents.get(key))!.intent as { conversion?: unknown }).conversion,
    ).toBeUndefined()
    ctx.setCapabilityOffline(false)
    await ctx.service.pollSaveQueue()
    expect(commitCalls(server)).toHaveLength(1)
    expect(commitCalls(server)[0]!.body).toMatchObject({
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
  })
})

/** a Save whose commit POST never got an answer: nothing is settled, the intent is durable */
async function interruptedCommit(server: ReturnType<typeof fakeServer>, landed: boolean) {
  const ctx = setup(server, { queue: true })
  const path = await openDoc(ctx)
  const edited = await ooxml('xlsx', 'edits in flight')
  writeFileSync(path, edited)
  const real = server.fetch.getMockImplementation()!
  server.fetch.mockImplementation(async (url, init) => {
    if (new URL(url).pathname.endsWith('/versions/commit') && init.method === 'POST') {
      // the server applies the commit (or never sees it), the answer is lost either way
      if (landed) await real(url, init)
      server.fetch.mockImplementation(real)
      throw new TypeError('fetch failed')
    }
    return real(url, init)
  })
  await ctx.service.save(path)
  return { path, edited, first: commitCalls(server).at(-1)! }
}

/**
 * a fresh service over the same durable store: its poll looks the interrupted commit up by its
 * key (one pass), then sends again what was not committed (the next pass)
 */
async function restart(server: ReturnType<typeof fakeServer>, path: string): Promise<Ctx> {
  const ctx = setup(server, { queue: true })
  for (let pass = 0; pass < 3 && (await storedIntent(ctx, path)); pass += 1) {
    await ctx.service.pollSaveQueue()
  }
  return ctx
}

describe('UNI-2212 interrupted conversion commit recovered by a fresh service', () => {
  it('not committed: the same intent is sent again with the same key and the same conversion', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const { path, edited } = await interruptedCommit(server, false)
    expect(server.versions).toHaveLength(1)
    const before = (await storedIntent(setup(server, { queue: true }), path)) as unknown as {
      intent: {
        idempotencyKey: string
        baseRevision: string
        checksum: string
        conversion: unknown
      }
    }
    expect(before.intent.conversion).toEqual({ from: 'xls', to: 'xlsx' })
    const ctx = await restart(server, path)
    // one converted version, the retry carries the key, revision and pair of the first attempt
    expect(server.versions).toHaveLength(2)
    expect(server.versions[1]).toMatchObject({ reason: 'converted_version' })
    expect(Buffer.from(server.versions[1]!.bytes).equals(Buffer.from(edited))).toBe(true)
    // the server saw one commit POST: the retry (the first attempt never reached it)
    const attempts = commitCalls(server)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.headers['idempotency-key']).toBe(before.intent.idempotencyKey)
    expect(attempts[0]!.body).toMatchObject({
      base_revision: before.intent.baseRevision,
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    await vi.waitFor(() => expect(binding(path).state).toBe('saved'))
    expect(binding(path)).toMatchObject({ baseRevision: '2', baseVersion: 2 })
    expect(binding(path).legacyFrom).toBeUndefined()
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it('landed with the answer lost: the lookup settles it, nothing is committed twice', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const { path, edited } = await interruptedCommit(server, true)
    // the first service never learned it landed
    expect(server.versions).toHaveLength(2)
    const ctx = await restart(server, path)
    expect(commitCalls(server)).toHaveLength(1)
    expect(uploadCalls(server)).toHaveLength(1)
    expect(server.versions).toHaveLength(2)
    await vi.waitFor(() => expect(binding(path).state).toBe('saved'))
    expect(binding(path)).toMatchObject({
      title: 'Budget.xlsx',
      baseRevision: '2',
      baseVersion: 2,
    })
    expect(binding(path).legacyFrom).toBeUndefined()
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(edited))).toBe(true)
    expect(await storedIntent(ctx, path)).toBeNull()
    // the next edit is an ordinary commit
    writeFileSync(path, await ooxml('xlsx', 'next'))
    await ctx.service.save(path)
    expect(
      (commitCalls(server).at(-1)!.body as { conversion?: unknown }).conversion,
    ).toBeUndefined()
  })
})

describe('UNI-2212 a refused conversion is parked for good', () => {
  it('422 keeps a failed durable intent; a restart and a poll send nothing more', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const ctx = setup(server, { queue: true })
    const path = await openDoc(ctx)
    const edited = await ooxml('xlsx', 'precious')
    writeFileSync(path, edited)
    server.faults.push({
      route: 'commit',
      status: 422,
      code: 'legacy_conversion_invalid',
      reason: 'not_legacy',
    })
    await ctx.service.save(path)
    const parked = (await storedIntent(ctx, path)) as unknown as {
      intent: { state: string; lastError?: string }
    }
    expect(parked.intent).toMatchObject({ state: 'failed', lastError: 'legacy_conversion_invalid' })
    const commits = commitCalls(server).length
    const uploads = uploadCalls(server).length
    const again = await restart(server, path)
    await again.service.pollSaveQueue()
    expect(commitCalls(server)).toHaveLength(commits)
    expect(uploadCalls(server)).toHaveLength(uploads)
    expect(server.versions).toHaveLength(1)
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(edited))).toBe(true)
    const still = (await storedIntent(again, path)) as unknown as {
      intent: { state: string; lastError?: string }
    }
    expect(still.intent).toMatchObject({ state: 'failed', lastError: 'legacy_conversion_invalid' })
    expect(JSON.parse(readFileSync(join(path, '..', BINDING_FILE), 'utf8'))).toMatchObject({
      state: 'failed',
    })
  })
})

describe('UNI-2212 the conversion snapshot on the durable record', () => {
  const base = {
    v: 2,
    intentId: 'i',
    idempotencyKey: 'k',
    documentId: 'd',
    orgId: 'o',
    workspaceId: 'w',
    baseRevision: '1',
    baseVersion: 1,
    checksum: 'c',
    length: 1,
    generation: 1,
    state: 'queued',
    attempt: 0,
    createdAt: 't',
    updatedAt: 't',
  }

  it('reads a pair, an explicit absence and a record without the field; refuses a cross-family pair', () => {
    expect(parseStoredIntent({ ...base, conversion: { from: 'doc', to: 'docx' } })).toMatchObject({
      conversion: { from: 'doc', to: 'docx' },
    })
    expect(parseStoredIntent({ ...base, conversion: null })).toMatchObject({ conversion: null })
    expect(parseStoredIntent(base)).not.toHaveProperty('conversion')
    expect(parseStoredIntent({ ...base, conversion: { from: 'xls', to: 'docx' } })).toBeNull()
    expect(parseStoredIntent({ ...base, conversion: 'xls' })).toBeNull()
  })
})
