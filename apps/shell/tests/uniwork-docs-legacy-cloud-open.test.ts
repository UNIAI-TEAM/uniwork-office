import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOC,
  TARGET,
  binding,
  commitCalls,
  enc,
  fakeConverter,
  fakeServer,
  hex,
  legacyBytes,
  ooxml,
  openDoc,
  setup,
  uploadCalls,
  useWorkDir,
  work,
} from './uniwork-docs-legacy-cloud-kit'

useWorkDir()

/**
 * UNI-2212 (C4): a cloud .doc / .xls / .ppt opened through the app's converter (the UniWork list,
 * the web deep link and the version history all go through the one open flow), bound to the cloud
 * document as its OOXML working copy; a version from history opens read-only.
 */

describe('UNI-2212 opening a cloud legacy document', () => {
  it.each([['xls'], ['doc'], ['ppt']] as const)(
    'a live %s version is downloaded, converted and opened as its OOXML working copy',
    async (legacy) => {
      const server = fakeServer({ legacy, title: `Report.${legacy}` })
      const ctx = setup(server)
      const path = await openDoc(ctx)
      const to = TARGET[legacy]
      // the legacy bytes went through the converter, named for the progress box and the notices
      expect(ctx.converter!.calls).toHaveLength(1)
      expect(ctx.converter!.calls[0]).toMatchObject({ from: legacy, name: `Report.${legacy}` })
      expect(
        Buffer.from(ctx.converter!.calls[0]!.bytes).equals(Buffer.from(legacyBytes[legacy])),
      ).toBe(true)
      // the tab shows the OOXML name, never `Report.xls.xlsx`
      expect(basename(path)).toBe(`Report.${to}`)
      const converted = await ooxml(to)
      expect(Buffer.from(readFileSync(path)).equals(Buffer.from(converted))).toBe(true)
      expect(binding(path)).toMatchObject({
        documentId: DOC,
        format: to,
        legacyFrom: legacy,
        access: 'edit',
        baseRevision: '1',
        baseVersion: 1,
        baseChecksum: hex(converted),
        state: 'ready',
      })
      // v1 (the original legacy bytes) is untouched on the server and nothing was uploaded
      expect(server.versions).toHaveLength(1)
      expect(commitCalls(server)).toHaveLength(0)
    },
  )

  it('opening it again reuses the converted copy: no second download, no second conversion', async () => {
    const server = fakeServer({ legacy: 'xls' })
    const ctx = setup(server)
    const first = await openDoc(ctx)
    const downloads = server.calls.filter((c) => c.path.endsWith('/download')).length
    const second = await openDoc(ctx)
    expect(second).toBe(first)
    expect(ctx.converter!.calls).toHaveLength(1)
    expect(server.calls.filter((c) => c.path.endsWith('/download')).length).toBe(downloads)
    expect(binding(first).legacyFrom).toBe('xls')
  })

  it.each([
    ['application/pdf', 'Original.pdf', 'pdf'],
    ['text/markdown', 'Original.md', 'md'],
    ['text/plain', 'Original.txt', 'txt'],
    ['text/html', 'Original.html', 'html'],
  ])(
    'a %s head with a legacy-looking title opens as itself, never through the converter',
    async (mime, filename, format) => {
      for (const title of ['Renamed.doc', 'Renamed.xls', 'Renamed.ppt']) {
        const server = fakeServer({ mime, filename, title, bytes: enc('plain content') })
        const ctx = setup(server)
        const path = await openDoc(ctx)
        expect(ctx.converter!.calls).toHaveLength(0)
        expect(binding(path)).toMatchObject({ format, state: 'ready' })
        expect(binding(path).legacyFrom).toBeUndefined()
      }
    },
  )

  it('an ordinary OOXML document never touches the converter', async () => {
    const server = fakeServer({ ooxml: 'docx', title: 'Plan.docx' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(ctx.converter!.calls).toHaveLength(0)
    expect(readFileSync(path, 'utf8')).toBe('ordinary')
    expect(binding(path).legacyFrom).toBeUndefined()
  })

  it('a converted document whose title still ends in .xls is not legacy any more', async () => {
    const server = fakeServer({
      ooxml: 'xlsx',
      title: 'Old.xls',
      bytes: await ooxml('xlsx', 'live'),
    })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(ctx.converter!.calls).toHaveLength(0)
    expect(basename(path)).toBe('Old.xlsx')
    expect(binding(path).legacyFrom).toBeUndefined()
  })

  it('without edit rights the converted copy is read-only and never reaches the server', async () => {
    const server = fakeServer({ legacy: 'xls', myLevel: 'view' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(ctx.service.isReadOnly(path)).toBe(true)
    expect(binding(path)).toMatchObject({ access: 'view', level: 'view' })
    writeFileSync(path, 'local edit')
    await ctx.service.save(path)
    expect(uploadCalls(server)).toHaveLength(0)
    expect(commitCalls(server)).toHaveLength(0)
    expect(server.versions).toHaveLength(1)
  })

  it('a refused conversion opens nothing: no folder, no binding, no request beyond the reads', async () => {
    const failed = fakeConverter(() => ({ ok: false, reason: 'failed' }))
    const server = fakeServer({ legacy: 'xls' })
    const ctx = setup(server, { converter: failed })
    const opened = await ctx.service.openDocument(DOC)
    expect(opened).toMatchObject({ ok: false, error: 'legacy_open_failed' })
    expect(existsSync(join(work.dir, 'uniwork-documents', 'default', 'acc_1', DOC))).toBe(false)
    expect(commitCalls(server)).toHaveLength(0)
  })

  it('a cancelled conversion is its own silent verdict and writes nothing', async () => {
    const cancelled = fakeConverter(() => ({ ok: false, reason: 'cancelled' }))
    const ctx = setup(fakeServer({ legacy: 'ppt' }), { converter: cancelled })
    expect(await ctx.service.openDocument(DOC)).toMatchObject({
      ok: false,
      error: 'legacy_cancelled',
    })
    expect(existsSync(join(work.dir, 'uniwork-documents', 'default', 'acc_1', DOC))).toBe(false)
  })

  it('an app without a converter says unsupported, exactly as before it existed', async () => {
    const ctx = setup(fakeServer({ legacy: 'xls' }), { converter: null })
    expect(await ctx.service.openDocument(DOC)).toMatchObject({
      ok: false,
      error: 'unsupported_format',
    })
  })
})

describe('UNI-2212 version history: a legacy version opens read-only through the converter', () => {
  /** v1 is the original .xls, v2 the converted xlsx the document now holds (title already rewritten) */
  async function convertedDocument() {
    const server = fakeServer({
      legacy: 'xls',
      title: 'Budget.xlsx',
      converted: { bytes: await ooxml('xlsx', 'v2'), kind: 'xlsx' },
    })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(server.versions).toHaveLength(2)
    return { server, ctx, headPath: path }
  }

  it('opens v1 (.xls) converted, read-only, in its own @v1 copy; the head stays an ordinary document', async () => {
    const { server, ctx, headPath } = await convertedDocument()
    ctx.converter!.calls.length = 0
    const view = await ctx.service.openVersionView(DOC, 1)
    expect(ctx.converter!.calls).toHaveLength(1)
    expect(ctx.converter!.calls[0]).toMatchObject({ from: 'xls' })
    expect(Buffer.from(ctx.converter!.calls[0]!.bytes).equals(Buffer.from(legacyBytes.xls))).toBe(
      true,
    )
    expect(view.path).toContain(`${DOC}@v1`)
    expect(view.path).not.toBe(headPath)
    expect(ctx.service.isReadOnly(view.path)).toBe(true)
    const b = binding(view.path)
    expect(b).toMatchObject({ format: 'xlsx', access: 'view', level: 'view', baseVersion: 1 })
    expect(b.legacyFrom).toBeUndefined()
    // no save back: a write to the version copy goes nowhere and the version count is unchanged
    const commitsBefore = commitCalls(server).length
    writeFileSync(view.path, 'tampered')
    await ctx.service.save(view.path)
    expect(commitCalls(server)).toHaveLength(commitsBefore)
    expect(server.versions).toHaveLength(2)
    // the head still opens as a plain document: no conversion, no flag
    ctx.converter!.calls.length = 0
    await openDoc(ctx)
    expect(ctx.converter!.calls).toHaveLength(0)
    expect(binding(headPath).legacyFrom).toBeUndefined()
  })

  it('the head of a document that is still legacy opens its version view converted and read-only too', async () => {
    const server = fakeServer({ legacy: 'doc', title: 'Memo.doc' })
    const ctx = setup(server)
    const view = await ctx.service.openVersionView(DOC, 1)
    expect(ctx.converter!.calls).toHaveLength(1)
    expect(ctx.service.isReadOnly(view.path)).toBe(true)
    expect(binding(view.path).legacyFrom).toBeUndefined()
    expect(commitCalls(server)).toHaveLength(0)
  })

  it('the current legacy version stays a read-only @vN copy even while its editable tab is open', async () => {
    const server = fakeServer({ legacy: 'doc', title: 'Memo.doc' })
    const ctx = setup(server)
    const headPath = await openDoc(ctx)
    ctx.isPathOpen.mockReturnValue(true)
    const view = await ctx.service.openVersionView(DOC, 1)
    expect(view.path).not.toBe(headPath)
    expect(view.path).toContain(`${DOC}@v1`)
    expect(ctx.service.isReadOnly(view.path)).toBe(true)
    expect(binding(view.path).legacyFrom).toBeUndefined()
    // a Save of the view uploads and commits nothing: version 1 never gains a next version from it
    writeFileSync(view.path, 'tampered')
    await ctx.service.save(view.path)
    expect(uploadCalls(server)).toHaveLength(0)
    expect(commitCalls(server)).toHaveLength(0)
    expect(server.versions).toHaveLength(1)
    // the editable head is untouched and still owes its conversion
    expect(binding(headPath)).toMatchObject({ access: 'edit', legacyFrom: 'doc' })
  })

  it('an OOXML version never goes through the converter', async () => {
    const { ctx } = await convertedDocument()
    ctx.converter!.calls.length = 0
    const view = await ctx.service.openVersionView(DOC, 2)
    expect(ctx.converter!.calls).toHaveLength(0)
    expect(basename(view.path)).toBe('Budget.xlsx')
  })
})

describe('UNI-2212 a head read that a save outran', () => {
  it('a held legacy metadata reply never brings back the conversion the save settled', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Budget.xls' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    ctx.isPathOpen.mockReturnValue(true)
    // the reopen's metadata read answers while v1 is still the head, then is held back
    const real = server.fetch.getMockImplementation()!
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached!: () => void
    const held = new Promise<void>((resolve) => {
      reached = resolve
    })
    server.fetch.mockImplementationOnce(async (url, init) => {
      const answered = await real(url, init)
      reached()
      await gate
      return answered
    })
    const reopen = ctx.service.openDocument(DOC)
    await held
    // meanwhile the converted copy saves: v2 is live and the flag is cleared
    writeFileSync(path, await ooxml('xlsx', 'first edit'))
    await ctx.service.save(path)
    expect(server.versions).toHaveLength(2)
    expect(binding(path).legacyFrom).toBeUndefined()
    release()
    expect(await reopen).toMatchObject({ ok: true })
    // the old reply did not resurrect the flag, so the next ordinary edit saves normally
    expect(binding(path)).toMatchObject({ baseVersion: 2, baseRevision: '2' })
    expect(binding(path).legacyFrom).toBeUndefined()
    writeFileSync(path, await ooxml('xlsx', 'second edit'))
    await ctx.service.save(path)
    expect(commitCalls(server)).toHaveLength(2)
    expect((commitCalls(server)[1]!.body as { conversion?: unknown }).conversion).toBeUndefined()
    expect(server.versions).toHaveLength(3)
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' })
  })
})

describe('UNI-2212 malformed server answers', () => {
  it('a download that does not match the read checksum is malformed: nothing is converted or written', async () => {
    const server = fakeServer({ legacy: 'xls' })
    const real = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url, init) => {
      if (new URL(url).pathname.endsWith('/download')) {
        return new Response(enc('not the bytes the read named') as BodyInit, { status: 200 })
      }
      return real(url, init)
    })
    const ctx = setup(server)
    expect(await ctx.service.openDocument(DOC)).toMatchObject({
      ok: false,
      error: 'malformed_response',
    })
    expect(ctx.converter!.calls).toHaveLength(0)
    expect(existsSync(join(work.dir, 'uniwork-documents', 'default', 'acc_1', DOC))).toBe(false)
  })

  it('a legacy name on bytes that are another OOXML family is refused, never converted', async () => {
    const server = fakeServer({ legacy: 'xls', bytes: await ooxml('docx') })
    const ctx = setup(server)
    expect(await ctx.service.openDocument(DOC)).toMatchObject({
      ok: false,
      error: 'unsupported_format',
    })
    expect(ctx.converter!.calls).toHaveLength(0)
  })

  it('a compound file of another legacy family than the head says is refused, never converted', async () => {
    // the head is declared .xls but the bytes are a Word 97 file
    const server = fakeServer({ legacy: 'xls', bytes: legacyBytes.doc })
    const ctx = setup(server)
    expect(await ctx.service.openDocument(DOC)).toMatchObject({
      ok: false,
      error: 'unsupported_format',
    })
    expect(ctx.converter!.calls).toHaveLength(0)
    expect(existsSync(join(work.dir, 'uniwork-documents', 'default', 'acc_1', DOC))).toBe(false)
  })

  it('an OOXML package under a legacy name opens as it is and still owes the conversion', async () => {
    const server = fakeServer({ legacy: 'xls', bytes: await ooxml('xlsx', 'misnamed') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(ctx.converter!.calls).toHaveLength(0)
    expect(binding(path)).toMatchObject({ format: 'xlsx', legacyFrom: 'xls' })
    writeFileSync(path, await ooxml('xlsx', 'edited'))
    await ctx.service.save(path)
    expect(commitCalls(server)[0]!.body).toMatchObject({
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    expect(readdirSync(join(path, '..')).filter((n) => n.endsWith('.xlsx'))).toHaveLength(1)
  })
})
