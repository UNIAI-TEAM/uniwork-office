import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  DOC,
  LEGACY_MIME,
  binding,
  commitCalls,
  conflictAct,
  fakeConverter,
  fakeServer,
  hex,
  legacyBytes,
  ooxml,
  openDoc,
  setup,
  useWorkDir,
} from './uniwork-docs-legacy-cloud-kit'

useWorkDir()

/**
 * UNI-2212 (C4 fix-a): the two reload entry points - a remote-newer notice and the conflict
 * dialog's "open the latest" - over a document whose head is STILL legacy. The file written is the
 * converted OOXML, so the base checksum is the converted bytes' (never the server's raw one), the
 * copy still owes its conversion, and the next explicit Save declares it.
 */

/** a converter whose every answer is a different valid xlsx, so each conversion is recognisable */
function numberedConverter() {
  let n = 0
  return fakeConverter(async () => ({
    ok: true as const,
    bytes: await ooxml('xlsx', `conversion ${++n}`),
    to: 'xlsx' as const,
  }))
}

/** another device saved a newer still-legacy version of the same document */
function moveLegacyHead(server: ReturnType<typeof fakeServer>): void {
  server.versions.push({
    bytes: legacyBytes.xls,
    mime: LEGACY_MIME.xls,
    filename: 'budget.xls',
    reason: 'upload',
  })
  server.state.revision = 2
}

function expectConvertedReload(
  server: ReturnType<typeof fakeServer>,
  path: string,
  secondConversion: Uint8Array,
): void {
  const onDisk = new Uint8Array(readFileSync(path))
  expect(Buffer.from(onDisk).equals(Buffer.from(secondConversion))).toBe(true)
  const raw = hex(server.versions.at(-1)!.bytes)
  expect(binding(path)).toMatchObject({
    baseRevision: '2',
    baseVersion: 2,
    baseChecksum: hex(secondConversion),
    format: 'xlsx',
    legacyFrom: 'xls',
  })
  // the server's checksum describes the raw legacy bytes, not the converted copy
  expect(binding(path).baseChecksum).not.toBe(raw)
}

describe('UNI-2212 reload of a still-legacy head', () => {
  it('a remote-newer notice reloads the converted bytes, keeps the flag, and the next Save converts', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const converter = numberedConverter()
    const ctx = setup(server, { converter })
    const path = await openDoc(ctx)
    // a notice is only acted on for a copy a tab shows
    ctx.isPathOpen.mockReturnValue(true)
    moveLegacyHead(server)
    ctx.service.noteFeedChange(DOC, '2', {
      documentId: DOC,
      kind: 'file',
      revision: '2',
      currentVersion: 2,
      versionId: 'ver_2',
    })
    await vi.waitFor(() => expect(binding(path).baseVersion).toBe(2))
    expect(converter.calls).toHaveLength(2)
    expectConvertedReload(server, path, await ooxml('xlsx', 'conversion 2'))
    // the next explicit Save declares the conversion against the new head
    writeFileSync(path, await ooxml('xlsx', 'after reload'))
    await ctx.service.save(path)
    expect(commitCalls(server)).toHaveLength(1)
    expect(commitCalls(server)[0]!.body).toMatchObject({
      base_revision: '2',
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    expect(server.versions).toHaveLength(3)
    expect(binding(path).legacyFrom).toBeUndefined()
  })

  it('the conflict dialog "open the latest" reloads the converted bytes, keeps the flag, and the next Save converts', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const converter = numberedConverter()
    const ctx = setup(server, { converter })
    const path = await openDoc(ctx)
    moveLegacyHead(server)
    writeFileSync(path, await ooxml('xlsx', 'my edits'))
    await ctx.service.save(path)
    expect(binding(path).state).toBe('conflict')
    const resolving = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const reply = await conflictAct(ctx, ctx.views[0]!.sessionId, {
      kind: 'reload',
      keep: 'discard',
      stopAi: false,
    })
    expect(reply).toEqual({ kind: 'closed' })
    await resolving
    expect(converter.calls).toHaveLength(2)
    expectConvertedReload(server, path, await ooxml('xlsx', 'conversion 2'))
    // the next explicit Save declares the conversion against the new head
    writeFileSync(path, await ooxml('xlsx', 'after reload'))
    await ctx.service.save(path)
    expect(commitCalls(server).at(-1)!.body).toMatchObject({
      base_revision: '2',
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    expect(server.versions).toHaveLength(3)
    expect(binding(path).legacyFrom).toBeUndefined()
  })
})
