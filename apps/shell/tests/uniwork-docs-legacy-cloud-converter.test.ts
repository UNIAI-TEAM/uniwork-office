import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LegacyConvertError,
  convertLegacyFile,
  detectOoxmlKindFromZipBytes,
  type ConvertLegacyResult,
} from '../src/main/legacy-converter'
import { createCloudLegacyConverter, type CloudLegacyConverterDeps } from '../src/main/legacy-open'
import { tLegacyOpen, type LegacyOpenStringKey } from '../src/main/legacy-open-strings'
import {
  DOC,
  TARGET,
  binding,
  commitCalls,
  fakeServer,
  legacyBytes,
  openDoc,
  setup,
  useWorkDir,
  work,
  type Legacy,
} from './uniwork-docs-legacy-cloud-kit'

useWorkDir()

/**
 * UNI-2212 (C4): the converter the UniWork open flow uses for the bytes it downloaded - the same
 * progress box with Cancel and typed notices as a local open - and, with the bundled LibreOffice
 * (GENOFFICE_LO_DIR), the whole path with a real conversion: open, edit, Save to UniWork.
 */

const t: CloudLegacyConverterDeps['t'] = (key: LegacyOpenStringKey, params) =>
  tLegacyOpen('en', key, params)

function harness(
  convert: CloudLegacyConverterDeps['convert'],
  stagingRoot?: () => string,
): {
  deps: CloudLegacyConverterDeps
  notices: string[]
  progress: { begun: string[]; ended: number; cancel: (() => void) | null }
} {
  const notices: string[] = []
  const progress = { begun: [] as string[], ended: 0, cancel: null as (() => void) | null }
  return {
    notices,
    progress,
    deps: {
      convert,
      ...(stagingRoot ? { stagingRoot } : {}),
      beginProgress: (name, cancel) => {
        progress.begun.push(name)
        progress.cancel = cancel
        return () => {
          progress.ended += 1
        }
      },
      notice: (message) => notices.push(message),
      t,
    },
  }
}

const converted = (
  target: 'docx' | 'xlsx' | 'pptx',
  bytes = new Uint8Array([1, 2, 3]),
): ConvertLegacyResult => ({
  kind: 'converted',
  sourceFormat: target === 'docx' ? 'doc' : target === 'xlsx' ? 'xls' : 'ppt',
  targetFormat: target,
  bytes,
  suggestedSaveAsPath: `x.${target}`,
})

describe('UNI-2212 the cloud legacy converter', () => {
  it('stages the downloaded bytes under their legacy name, converts them and removes the staging dir', async () => {
    const seen: { path: string; bytes: Uint8Array; source: string | undefined; mode: number }[] = []
    const h = harness(
      async (path, options) => {
        seen.push({
          path,
          bytes: new Uint8Array(readFileSync(path)),
          source: options.sourceFormat,
          mode: 0,
        })
        return converted('xlsx')
      },
      () => join(work.dir, 'staging'),
    )
    const out = await createCloudLegacyConverter(h.deps).convert({
      bytes: legacyBytes.xls,
      from: 'xls',
      name: 'Budget.xls',
    })
    expect(out).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]), to: 'xlsx' })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.path.endsWith('document.xls')).toBe(true)
    expect(seen[0]!.source).toBe('xls')
    expect(Buffer.from(seen[0]!.bytes).equals(Buffer.from(legacyBytes.xls))).toBe(true)
    // the progress box named the document, ended once, and nothing is left behind
    expect(h.progress.begun).toEqual(['Budget.xls'])
    expect(h.progress.ended).toBe(1)
    expect(readdirSync(join(work.dir, 'staging'))).toEqual([])
    expect(h.notices).toEqual([])
  })

  it.each([
    ['encrypted', /password-protected/],
    ['corrupt', /damaged or isn’t a valid \.xls file/],
    ['timeout', /took too long/],
    ['converter_missing', /converter is missing/],
    ['failed', /couldn’t be converted/],
  ] as const)(
    'a %s conversion shows its typed notice naming the file and fails the open',
    async (code, text) => {
      const h = harness(async () => {
        throw new LegacyConvertError(code, code)
      })
      const out = await createCloudLegacyConverter(h.deps).convert({
        bytes: legacyBytes.xls,
        from: 'xls',
        name: 'Budget.xls',
      })
      expect(out).toEqual({ ok: false, reason: 'failed' })
      expect(h.notices).toHaveLength(1)
      expect(h.notices[0]).toMatch(text)
      expect(h.notices[0]).toContain('Budget.xls')
      expect(h.progress.ended).toBe(1)
    },
  )

  /** a converter held at its boundary: `entered` resolves once the real converter is running */
  function heldConverter() {
    let enter!: () => void
    const entered = new Promise<void>((resolve) => (enter = resolve))
    let settle!: (outcome: () => ConvertLegacyResult) => void
    const gate = new Promise<() => ConvertLegacyResult>((resolve) => (settle = resolve))
    const convert: CloudLegacyConverterDeps['convert'] = async () => {
      enter()
      return (await gate)()
    }
    return { convert, entered, succeed: () => settle(() => converted('xlsx')), fail }
    function fail(code: LegacyConvertError['code']) {
      settle(() => {
        throw new LegacyConvertError(code, code)
      })
    }
  }

  it.each([
    ['Cancel', (h: ReturnType<typeof harness>) => h.progress.cancel!()],
    ['quit', (_h: ReturnType<typeof harness>, c?: { dispose(): void }) => c!.dispose()],
  ])(
    '%s while the converter runs ends silently, whether it then succeeds, fails or is aborted',
    async (_name, stop) => {
      for (const ending of ['succeed', 'abort', 'converter_missing'] as const) {
        const held = heldConverter()
        const h = harness(
          (path, options) =>
            ending === 'abort'
              ? new Promise((_resolve, reject) => {
                  void held.convert(path, options)
                  options.signal.addEventListener('abort', () =>
                    reject(new LegacyConvertError('cancelled', 'cancelled')),
                  )
                })
              : held.convert(path, options),
          () => join(work.dir, `staging-${ending}`),
        )
        const converter = createCloudLegacyConverter(h.deps)
        const pending = converter.convert({
          bytes: legacyBytes.xls,
          from: 'xls',
          name: 'Budget.xls',
        })
        // the cancel lands once the real converter is running, not while the bytes are staged
        await held.entered
        stop(h, converter)
        if (ending === 'succeed') held.succeed()
        else if (ending === 'converter_missing') held.fail('converter_missing')
        expect(await pending).toEqual({ ok: false, reason: 'cancelled' })
        expect(h.notices).toEqual([])
        expect(h.progress.ended).toBe(1)
        expect(readdirSync(join(work.dir, `staging-${ending}`))).toEqual([])
      }
    },
  )

  it('an OOXML package of another family under a legacy name is refused as corrupt', async () => {
    const h = harness(async () => ({
      kind: 'ooxml_misnamed',
      sourceFormat: 'xls',
      targetFormat: 'docx',
      bytes: new Uint8Array([1]),
      suggestedSaveAsPath: 'x.docx',
    }))
    const out = await createCloudLegacyConverter(h.deps).convert({
      bytes: legacyBytes.xls,
      from: 'xls',
      name: 'Budget.xls',
    })
    expect(out).toEqual({ ok: false, reason: 'failed' })
    expect(h.notices[0]).toMatch(/damaged or isn’t a valid \.xls file/)
  })

  it('dispose stops a pending conversion and refuses new ones', async () => {
    const h = harness(
      (_path, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new LegacyConvertError('cancelled', 'cancelled')),
          )
        }),
    )
    const converter = createCloudLegacyConverter(h.deps)
    const pending = converter.convert({ bytes: legacyBytes.ppt, from: 'ppt', name: 'Deck.ppt' })
    await vi.waitFor(() => expect(h.progress.begun).toHaveLength(1))
    converter.dispose()
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' })
    expect(
      await converter.convert({ bytes: legacyBytes.ppt, from: 'ppt', name: 'Deck.ppt' }),
    ).toEqual({ ok: false, reason: 'cancelled' })
    expect(h.notices).toEqual([])
  })
})

const LO_DIR = process.env.GENOFFICE_LO_DIR?.trim() || ''
const hasRealLo = LO_DIR !== '' && existsSync(LO_DIR)

describe.skipIf(!hasRealLo)('UNI-2212 with the real LibreOffice (GENOFFICE_LO_DIR)', () => {
  const real = (): CloudLegacyConverterDeps['convert'] => (path, options) =>
    convertLegacyFile(path, { ...options, loOptions: { envDir: LO_DIR } })

  it.each([['xls'], ['doc'], ['ppt']] as const)(
    'converts a real downloaded %s to valid OOXML of its family',
    async (legacy: Legacy) => {
      const h = harness(real())
      const out = await createCloudLegacyConverter(h.deps).convert({
        bytes: legacyBytes[legacy],
        from: legacy,
        name: `Sample.${legacy}`,
      })
      if (!out.ok) throw new Error(`conversion failed: ${h.notices.join(' | ')}`)
      expect(out.to).toBe(TARGET[legacy])
      expect(detectOoxmlKindFromZipBytes(out.bytes)).toBe(TARGET[legacy])
      expect(h.notices).toEqual([])
    },
    60_000,
  )

  it('opens a real cloud .xls, edits it and saves it as the next version with the conversion', async () => {
    const server = fakeServer({ legacy: 'xls', title: 'Ngân sách.xls' })
    const converter = createCloudLegacyConverter(harness(real()).deps)
    const ctx = setup(server, { converter: { calls: [], fn: (input) => converter.convert(input) } })
    const path = await openDoc(ctx)
    // the working copy is the real LibreOffice output: an xlsx package with a workbook part
    const bytes = new Uint8Array(readFileSync(path))
    expect(detectOoxmlKindFromZipBytes(bytes)).toBe('xlsx')
    expect(binding(path)).toMatchObject({ format: 'xlsx', legacyFrom: 'xls', state: 'ready' })
    // an untouched Save to UniWork commits it as version 2; the original stays version 1
    await ctx.service.save(path)
    expect(commitCalls(server)).toHaveLength(1)
    expect(commitCalls(server)[0]!.body).toMatchObject({
      conversion: { from_format: 'xls', to_format: 'xlsx' },
    })
    expect(server.versions).toHaveLength(2)
    expect(server.versions[0]!.bytes).toEqual(legacyBytes.xls)
    expect(Buffer.from(server.versions[1]!.bytes).equals(Buffer.from(bytes))).toBe(true)
    expect(server.state.title).toBe('Ngân sách.xlsx')
    // and v1 opens read-only through the same converter
    const view = await ctx.service.openVersionView(DOC, 1)
    expect(ctx.service.isReadOnly(view.path)).toBe(true)
    expect(detectOoxmlKindFromZipBytes(new Uint8Array(readFileSync(view.path)))).toBe('xlsx')
  }, 120_000)
})
