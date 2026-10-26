import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  OOXML_MIME,
  binding,
  commitCalls,
  fakeServer,
  hex,
  legacyBytes,
  ooxml,
  openDoc,
  setup,
  storedIntent,
  uploadCalls,
  useWorkDir,
} from './uniwork-docs-legacy-cloud-kit'

useWorkDir()

/**
 * UNI-2212 (C4): "Save to UniWork" from a converted copy commits it as the NEXT version of the
 * same document with `conversion` (inline pipeline and queue dispatcher), then the tab is an
 * ordinary bound OOXML document; the server's refusals never cost the edits.
 */

describe('UNI-2212 Save to UniWork from a converted copy', () => {
  it('commits the converted file as the NEXT version of the same document, with the conversion', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Báo cáo ngân sách.xls' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const edited = await ooxml('xlsx', 'edited by the user')
    writeFileSync(path, edited)
    await ctx.service.save(path)
    // the staged bytes are the OOXML under its OOXML name, then one commit declaring the pair
    expect(uploadCalls(server)).toHaveLength(1)
    expect((uploadCalls(server)[0]!.body as { name: string }).name).toBe('Báo cáo ngân sách.xlsx')
    expect(commitCalls(server)).toHaveLength(1)
    expect(commitCalls(server)[0]!.body).toMatchObject({
      base_revision: '1',
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    // the same document got a second version; the original legacy bytes are still version 1
    expect(server.versions).toHaveLength(2)
    expect(server.versions[0]!.bytes).toEqual(legacyBytes.xls)
    expect(server.versions[1]).toMatchObject({ reason: 'converted_version', mime: OOXML_MIME.xlsx })
    expect(Buffer.from(server.versions[1]!.bytes).equals(Buffer.from(edited))).toBe(true)
    expect(server.state.title).toBe('Báo cáo ngân sách.xlsx')
    // afterwards the tab is an ordinary bound OOXML document
    expect(binding(path)).toMatchObject({
      format: 'xlsx',
      title: 'Báo cáo ngân sách.xlsx',
      baseRevision: '2',
      baseVersion: 2,
      baseChecksum: hex(edited),
      state: 'saved',
    })
    expect(binding(path).legacyFrom).toBeUndefined()
    // the next save carries no conversion (the server would refuse a stale one as not_legacy)
    writeFileSync(path, await ooxml('xlsx', 'second edit'))
    await ctx.service.save(path)
    expect(commitCalls(server)).toHaveLength(2)
    expect((commitCalls(server)[1]!.body as { conversion?: unknown }).conversion).toBeUndefined()
    expect(server.versions).toHaveLength(3)
    expect(server.versions[2]!.reason).toBe('save')
  })

  it('an untouched converted copy still commits on an explicit Save: UniWork holds only the legacy file', async () => {
    const server = fakeServer({ legacy: 'doc', title: 'Memo.doc' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    await ctx.service.save(path)
    expect(commitCalls(server)).toHaveLength(1)
    expect(commitCalls(server)[0]!.body).toMatchObject({
      conversion: { from_format: 'doc', to_format: 'docx' },
    })
    expect(server.versions).toHaveLength(2)
    expect(binding(path).legacyFrom).toBeUndefined()
    // a second Save of the same bytes is the ordinary no-op again
    await ctx.service.save(path)
    expect(commitCalls(server)).toHaveLength(1)
  })

  it('the queue dispatcher declares the conversion too, and settles the copy as ordinary', async () => {
    const server = fakeServer({ legacy: 'ppt', title: 'Deck.ppt' })
    const ctx = setup(server, { queue: true })
    const path = await openDoc(ctx)
    writeFileSync(path, await ooxml('pptx', 'edited'))
    // offline: the Save parks an intent, nothing is sent
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    expect(await storedIntent(ctx, path)).not.toBeNull()
    expect(commitCalls(server)).toHaveLength(0)
    expect(binding(path).legacyFrom).toBe('ppt')
    // the poll dispatches it: the commit declares the pair and the base moves
    ctx.setCapabilityOffline(false)
    await ctx.service.pollSaveQueue()
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
    )
    expect(commitCalls(server)).toHaveLength(1)
    expect(commitCalls(server)[0]!.body).toMatchObject({
      conversion: { from_format: 'ppt', to_format: 'pptx' },
    })
    expect(server.versions).toHaveLength(2)
    expect(binding(path)).toMatchObject({ title: 'Deck.pptx', baseVersion: 2, baseRevision: '2' })
    expect(binding(path).legacyFrom).toBeUndefined()
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it.each(['not_ooxml', 'target_mismatch', 'not_legacy'])(
    'a 422 legacy_conversion_invalid (%s) keeps the converted copy, the edits and the intent',
    async (reason) => {
      const server = fakeServer({ legacy: 'xls' })
      const ctx = setup(server)
      const path = await openDoc(ctx)
      const edited = await ooxml('xlsx', 'precious edits')
      writeFileSync(path, edited)
      server.faults.push({
        route: 'commit',
        status: 422,
        code: 'legacy_conversion_invalid',
        reason,
      })
      await ctx.service.save(path)
      expect(commitCalls(server)).toHaveLength(1)
      // refused: the document on the server is unchanged, the local copy is exactly what was edited
      expect(server.versions).toHaveLength(1)
      expect(Buffer.from(readFileSync(path)).equals(Buffer.from(edited))).toBe(true)
      expect(await ctx.service.docStatus(path)).toMatchObject({
        state: 'failed',
        error: 'legacy_conversion_invalid',
      })
      // the edits stay durable: the intent is parked, never dropped with the verdict
      expect(await storedIntent(ctx, path)).not.toBeNull()
      // and the copy still owes its conversion: a later successful Save declares it again
      expect(binding(path).legacyFrom).toBe('xls')
    },
  )

  it('a stale base is the ordinary conflict: nothing is converted over the newer version', async () => {
    const server = fakeServer({ legacy: 'xls' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    server.state.revision = 5 // someone else moved the document on
    writeFileSync(path, await ooxml('xlsx', 'mine'))
    await ctx.service.save(path)
    expect(server.versions).toHaveLength(1)
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'conflict' })
    expect(binding(path).legacyFrom).toBe('xls')
  })

  it('a viewer who somehow commits is refused with 403 and keeps the local copy', async () => {
    const server = fakeServer({ legacy: 'xls' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    // the edit right is revoked on the server after the open: the copy still thinks it can edit
    server.state.myLevel = 'view'
    const edited = await ooxml('xlsx', 'edits')
    writeFileSync(path, edited)
    await ctx.service.save(path)
    expect(server.versions).toHaveLength(1)
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'blocked' })
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(edited))).toBe(true)
  })
})
