import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  OOXML_MIME,
  attachCopy,
  binding,
  commitCalls,
  conflictAct,
  fakeServer,
  ooxml,
  openDoc,
  setup,
  useWorkDir,
  type Ctx,
} from './uniwork-docs-legacy-cloud-kit'

useWorkDir()

/**
 * UNI-2212 (C4 fix-a): the conflict dialog's recovery actions over a converted copy. The real
 * service, binding store, client and queue talk to the c5 fake; the head moves on the server the
 * way a second device moves it.
 */

/** another device converted and saved the head: v2 is the OOXML, the title is rewritten */
async function convertElsewhere(server: ReturnType<typeof fakeServer>): Promise<void> {
  server.versions.push({
    bytes: await ooxml('xlsx', 'the other device'),
    mime: OOXML_MIME.xlsx,
    filename: 'budget.xlsx',
    reason: 'converted_version',
  })
  server.state.revision = 2
  server.state.title = 'Budget.xlsx'
}

/** a converted tab holding `mine`, whose Save met a moved head: the document is in conflict */
async function conflictedTab(
  server: ReturnType<typeof fakeServer>,
  moveHead: () => Promise<void> | void,
): Promise<{ ctx: Ctx; path: string; mine: Uint8Array }> {
  const ctx = setup(server)
  const path = await openDoc(ctx)
  await moveHead()
  const mine = await ooxml('xlsx', 'my edits')
  writeFileSync(path, mine)
  await ctx.service.save(path)
  expect(binding(path)).toMatchObject({ state: 'conflict', legacyFrom: 'xls' })
  return { ctx, path, mine }
}

/**
 * the conversion settled (flag cleared, v2), then another device restored the legacy v1 as head
 * v3; my next edit conflicts against it with no local flag to say the head is legacy again
 */
async function restoredLegacyTab(
  server: ReturnType<typeof fakeServer>,
): Promise<{ ctx: Ctx; path: string; mine: Uint8Array }> {
  const ctx = setup(server)
  const path = await openDoc(ctx)
  await ctx.service.save(path)
  expect(binding(path).legacyFrom).toBeUndefined()
  server.versions.push({
    bytes: server.versions[0]!.bytes,
    mime: server.versions[0]!.mime,
    filename: 'budget.xls',
    reason: 'restore',
  })
  server.state.revision = 3
  server.state.title = 'Budget.xls'
  const mine = await ooxml('xlsx', 'my edits')
  writeFileSync(path, mine)
  await ctx.service.save(path)
  expect(binding(path)).toMatchObject({ state: 'conflict' })
  expect(binding(path).legacyFrom).toBeUndefined()
  return { ctx, path, mine }
}

async function act(ctx: Ctx, path: string, action: unknown) {
  const resolving = ctx.service.resolveConflict(path)
  await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
  const reply = await conflictAct(ctx, ctx.views[0]!.sessionId, action)
  if (reply.kind === 'closed') await resolving
  else await conflictAct(ctx, ctx.views[0]!.sessionId, { kind: 'cancel' })
  return reply
}

describe('UNI-2212 Overwrite on a converted copy', () => {
  it('a head another device already converted takes an ordinary commit of my bytes, no conversion', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const { ctx, path, mine } = await conflictedTab(server, () => convertElsewhere(server))
    expect(commitCalls(server)).toHaveLength(1)
    const reply = await act(ctx, path, { kind: 'overwrite', stopAi: false })
    expect(reply).toEqual({ kind: 'closed' })
    // exactly one further version, my bytes, committed on the head's revision without a conversion
    expect(commitCalls(server)).toHaveLength(2)
    const last = commitCalls(server)[1]!.body as { base_revision: string; conversion?: unknown }
    expect(last.base_revision).toBe('2')
    expect(last.conversion).toBeUndefined()
    expect(server.versions).toHaveLength(3)
    expect(server.versions[2]).toMatchObject({ reason: 'save', mime: OOXML_MIME.xlsx })
    expect(Buffer.from(server.versions[2]!.bytes).equals(Buffer.from(mine))).toBe(true)
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(mine))).toBe(true)
    expect(binding(path)).toMatchObject({ state: 'saved', baseRevision: '3', baseVersion: 3 })
    expect(binding(path).legacyFrom).toBeUndefined()
  })

  it('a head that is still legacy keeps the conversion on the Overwrite commit', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const { ctx, path, mine } = await conflictedTab(server, () => {
      server.state.revision = 5 // a newer revision of the same, still legacy, head
    })
    const reply = await act(ctx, path, { kind: 'overwrite', stopAi: false })
    expect(reply).toEqual({ kind: 'closed' })
    expect(commitCalls(server)).toHaveLength(2)
    expect(commitCalls(server)[1]!.body).toMatchObject({
      base_revision: '5',
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    expect(server.versions).toHaveLength(2)
    expect(server.versions[1]).toMatchObject({ reason: 'converted_version' })
    expect(Buffer.from(server.versions[1]!.bytes).equals(Buffer.from(mine))).toBe(true)
    expect(binding(path).legacyFrom).toBeUndefined()
  })

  it('a legacy head restored after the conversion settled still gets the conversion', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const { ctx, path, mine } = await restoredLegacyTab(server)
    const before = commitCalls(server).length
    const reply = await act(ctx, path, { kind: 'overwrite', stopAi: false })
    expect(reply).toEqual({ kind: 'closed' })
    expect(commitCalls(server)).toHaveLength(before + 1)
    expect(commitCalls(server).at(-1)!.body).toMatchObject({
      base_revision: '3',
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    expect(server.versions).toHaveLength(4)
    expect(server.versions[3]).toMatchObject({ reason: 'converted_version' })
    expect(Buffer.from(server.versions[3]!.bytes).equals(Buffer.from(mine))).toBe(true)
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(mine))).toBe(true)
    expect(binding(path).legacyFrom).toBeUndefined()
  })
})

describe('UNI-2212 Save as a copy from a converted copy', () => {
  it('over a legacy copied head the copy commit declares the conversion and the copy is kept', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const copies = attachCopy(server)
    const { ctx, path, mine } = await conflictedTab(server, () => {
      server.state.revision = 5
    })
    const reply = await act(ctx, path, { kind: 'save-copy', stopAi: false })
    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_done' } })
    const copy = copies.copy!
    expect(copies.archived).toBe(0)
    const commits = commitCalls(copy)
    expect(commits).toHaveLength(1)
    expect(commits[0]!.body).toMatchObject({
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    expect(copy.versions).toHaveLength(2)
    expect(Buffer.from(copy.versions[1]!.bytes).equals(Buffer.from(mine))).toBe(true)
    // my local bytes and the source are untouched
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(mine))).toBe(true)
    expect(server.versions).toHaveLength(1)
  })

  it('over a copied head another device already converted the copy commit is ordinary', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const copies = attachCopy(server)
    const { ctx, path, mine } = await conflictedTab(server, () => convertElsewhere(server))
    const reply = await act(ctx, path, { kind: 'save-copy', stopAi: false })
    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_done' } })
    const copy = copies.copy!
    expect(copies.archived).toBe(0)
    const commits = commitCalls(copy)
    expect(commits).toHaveLength(1)
    expect((commits[0]!.body as { conversion?: unknown }).conversion).toBeUndefined()
    expect(copy.versions).toHaveLength(2)
    expect(copy.versions[1]).toMatchObject({ reason: 'save', mime: OOXML_MIME.xlsx })
    expect(Buffer.from(copy.versions[1]!.bytes).equals(Buffer.from(mine))).toBe(true)
  })

  it('a copied head restored to legacy after the conversion settled still gets the conversion', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const copies = attachCopy(server)
    const { ctx, path, mine } = await restoredLegacyTab(server)
    const reply = await act(ctx, path, { kind: 'save-copy', stopAi: false })
    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_done' } })
    const copy = copies.copy!
    expect(copies.archived).toBe(0)
    const commits = commitCalls(copy)
    expect(commits).toHaveLength(1)
    expect(commits[0]!.body).toMatchObject({
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    expect(Buffer.from(copy.versions.at(-1)!.bytes).equals(Buffer.from(mine))).toBe(true)
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(mine))).toBe(true)
  })
})
