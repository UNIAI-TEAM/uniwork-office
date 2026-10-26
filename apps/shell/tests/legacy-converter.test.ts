import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LegacyConvertError,
  buildSofficeArgs,
  buildSofficeEnv,
  convertLegacyFile,
  detectOoxmlKindFromZipBytes,
  killAllActiveLegacyConversions,
  legacyFormatForPath,
  preflightLegacyBytes,
  preflightLegacyFile,
  resolveLibreOfficePaths,
  sofficeRelativePathForPlatform,
  suggestedOoxmlPathForLegacy,
  validateOoxmlOutputBytes,
  type SpawnSofficeFn,
} from '../src/main/legacy-converter'

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures', 'legacy')
const LO_DIR = process.env.GENOFFICE_LO_DIR?.trim() || ''
const hasRealLo = Boolean(LO_DIR && resolveLibreOfficePaths({ envDir: LO_DIR }))

async function makeMinimalOoxmlZip(kind: 'docx' | 'xlsx' | 'pptx'): Promise<Uint8Array> {
  const mainPart =
    kind === 'docx'
      ? 'word/document.xml'
      : kind === 'xlsx'
        ? 'xl/workbook.xml'
        : 'ppt/presentation.xml'
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  )
  zip.file(mainPart, '<root/>')
  return zip.generateAsync({ type: 'uint8array' })
}

function createFakeChildProcess(opts: {
  pid?: number
  exitCode?: number | null
  stderrText?: string
  onSpawn?: (args: readonly string[]) => void
  neverExit?: boolean
}): { spawnFn: SpawnSofficeFn; getSpawnCount: () => number } {
  let spawnCount = 0
  const spawnFn: SpawnSofficeFn = (_cmd, args) => {
    spawnCount++
    const emitter = new EventEmitter()
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const child = Object.assign(emitter, {
      pid: opts.pid ?? 42424,
      stdout,
      stderr,
      kill: vi.fn(() => {
        setImmediate(() => emitter.emit('exit', null))
        return true
      }),
    }) as unknown as ChildProcess

    if (opts.onSpawn) opts.onSpawn(args)

    if (!opts.neverExit) {
      setImmediate(() => {
        if (opts.stderrText) stderr.emit('data', Buffer.from(opts.stderrText, 'utf8'))
        emitter.emit('exit', opts.exitCode ?? 0)
      })
    }
    return child
  }
  return { spawnFn, getSpawnCount: () => spawnCount }
}

describe('legacy-converter', () => {
  const tempDirs: string[] = []
  const makeTempDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'legacy-conv-test-'))
    tempDirs.push(d)
    return d
  }

  afterEach(() => {
    killAllActiveLegacyConversions({
      killPosixTree: () => {},
      killPid: () => {},
      runTaskkill: () => {},
    })
    while (tempDirs.length > 0) {
      const d = tempDirs.pop()!
      rmSync(d, { recursive: true, force: true })
    }
  })

  describe('format helpers & LibreOffice path resolution', () => {
    it('maps legacy extensions to target OOXML extensions and suggested Save As paths', () => {
      expect(legacyFormatForPath('/tmp/report.doc')).toBe('doc')
      expect(legacyFormatForPath('/tmp/sheet.XLS')).toBe('xls')
      expect(legacyFormatForPath('/tmp/slides.Ppt')).toBe('ppt')
      expect(legacyFormatForPath('/tmp/modern.docx')).toBeNull()

      expect(suggestedOoxmlPathForLegacy('/Users/a/Quarterly Report.doc')).toBe(
        '/Users/a/Quarterly Report.docx',
      )
      expect(suggestedOoxmlPathForLegacy('/Users/a/budget.XLS')).toBe('/Users/a/budget.xlsx')
      expect(suggestedOoxmlPathForLegacy('/Users/a/deck.ppt')).toBe('/Users/a/deck.pptx')
    })

    it('resolves platform-specific soffice paths under resourcesPath or GENOFFICE_LO_DIR', () => {
      expect(sofficeRelativePathForPlatform('linux')).toBe(join('program', 'soffice.bin'))
      expect(sofficeRelativePathForPlatform('win32')).toBe(join('program', 'soffice.exe'))
      expect(sofficeRelativePathForPlatform('darwin')).toBe(
        join('LibreOffice.app', 'Contents', 'MacOS', 'soffice'),
      )

      const root = makeTempDir()
      const linuxLo = join(root, 'libreoffice')
      mkdirSync(join(linuxLo, 'program'), { recursive: true })
      mkdirSync(join(linuxLo, 'template-profile'), { recursive: true })
      writeFileSync(join(linuxLo, 'program', 'soffice.bin'), '')

      const resolved = resolveLibreOfficePaths({
        platform: 'linux',
        envDir: '',
        resourcesPath: root,
      })
      expect(resolved).toBeNull()

      const resolvedBundled = resolveLibreOfficePaths({
        platform: 'linux',
        envDir: undefined,
        resourcesPath: root,
      })
      // If process.env.GENOFFICE_LO_DIR is unset in the test process, falls back to resourcesPath
      if (!process.env.GENOFFICE_LO_DIR) {
        expect(resolvedBundled).toEqual({
          rootDir: linuxLo,
          sofficeBinary: join(linuxLo, 'program', 'soffice.bin'),
          templateProfileDir: join(linuxLo, 'template-profile'),
        })
      }

      const resolvedEnv = resolveLibreOfficePaths({
        platform: 'linux',
        envDir: linuxLo,
      })
      expect(resolvedEnv).toEqual({
        rootDir: linuxLo,
        sofficeBinary: join(linuxLo, 'program', 'soffice.bin'),
        templateProfileDir: join(linuxLo, 'template-profile'),
      })
    })

    it('builds hardened soffice args and network-isolated environment', () => {
      const args = buildSofficeArgs({
        profileDir: '/tmp/job-1/profile',
        sourceFormat: 'xls',
        targetFormat: 'xlsx',
        outDir: '/tmp/job-1/out',
        inputPath: '/tmp/input.xls',
      })
      expect(args).toContain('--headless')
      expect(args).toContain('--norestore')
      expect(args).toContain('--nologo')
      expect(args).toContain('--infilter=MS Excel 97')
      expect(args).toContain('--convert-to')
      expect(args).toContain('xlsx')

      const env = buildSofficeEnv(
        {
          rootDir: '/opt/lo',
          sofficeBinary: '/opt/lo/program/soffice.bin',
          templateProfileDir: '/opt/lo/template-profile',
        },
        { PATH: '/usr/bin' },
        'linux',
      )
      expect(env.http_proxy).toBe('http://127.0.0.1:0')
      expect(env.https_proxy).toBe('http://127.0.0.1:0')
      expect(env.LD_LIBRARY_PATH).toContain('/opt/lo/program')
    })
  })

  describe('TypeScript CFB & encryption pre-check (no soffice spawn)', () => {
    it.each([
      ['poi-PasswordProtected.doc', 'doc'],
      ['poi-password_cryptoapi.doc', 'doc'],
      ['poi-password.xls', 'xls'],
      ['poi-xor-encryption-abc.xls', 'xls'],
      ['poi-Password_Protected-hello.ppt', 'ppt'],
      ['poi-ppt_with_png_encrypted.ppt', 'ppt'],
    ] as const)(
      'refuses password-protected fixture %s (%s) with code "encrypted" without spawning soffice',
      async (fileName, format) => {
        const filePath = join(FIXTURES_DIR, fileName)
        expect(() => preflightLegacyFile(filePath, format)).toThrowError(
          expect.objectContaining({
            name: 'LegacyConvertError',
            code: 'encrypted',
            format,
          }),
        )

        const { spawnFn, getSpawnCount } = createFakeChildProcess({})
        await expect(
          convertLegacyFile(filePath, {
            sourceFormat: format,
            spawnFn,
          }),
        ).rejects.toMatchObject({
          code: 'encrypted',
          format,
        })
        expect(getSpawnCount()).toBe(0)
      },
    )

    it.each([
      ['broken-truncated.doc', 'doc'],
      ['broken-truncated.xls', 'xls'],
      ['broken-truncated.ppt', 'ppt'],
    ] as const)(
      'refuses truncated/corrupt CFB fixture %s (%s) with code "corrupt" without spawning soffice',
      async (fileName, format) => {
        const filePath = join(FIXTURES_DIR, fileName)
        expect(() => preflightLegacyFile(filePath, format)).toThrowError(
          expect.objectContaining({
            name: 'LegacyConvertError',
            code: 'corrupt',
            format,
          }),
        )

        const { spawnFn, getSpawnCount } = createFakeChildProcess({})
        await expect(
          convertLegacyFile(filePath, {
            sourceFormat: format,
            spawnFn,
          }),
        ).rejects.toMatchObject({
          code: 'corrupt',
          format,
        })
        expect(getSpawnCount()).toBe(0)
      },
    )

    it('detects an OOXML ZIP file misnamed with a .doc/.xls/.ppt extension without spawning soffice', async () => {
      const dir = makeTempDir()
      const misnamedDoc = join(dir, 'actually-modern.doc')
      const docxBytes = await makeMinimalOoxmlZip('docx')
      writeFileSync(misnamedDoc, docxBytes)

      const pre = preflightLegacyBytes(docxBytes, 'doc')
      expect(pre).toEqual({
        kind: 'ooxml_misnamed',
        sourceFormat: 'doc',
        detectedFormat: 'docx',
      })

      const { spawnFn, getSpawnCount } = createFakeChildProcess({})
      const res = await convertLegacyFile(misnamedDoc, { spawnFn })
      expect(res.kind).toBe('ooxml_misnamed')
      expect(res.targetFormat).toBe('docx')
      expect(res.suggestedSaveAsPath).toBe(join(dir, 'actually-modern.docx'))
      expect(getSpawnCount()).toBe(0)
    })

    it('accepts valid unencrypted .doc, .xls, and .ppt fixtures in preflight', () => {
      expect(preflightLegacyFile(join(FIXTURES_DIR, 'vn-template.doc'))).toEqual({
        kind: 'legacy',
        sourceFormat: 'doc',
        targetFormat: 'docx',
      })
      expect(preflightLegacyFile(join(FIXTURES_DIR, 'vn-budget.xls'))).toEqual({
        kind: 'legacy',
        sourceFormat: 'xls',
        targetFormat: 'xlsx',
      })
      expect(preflightLegacyFile(join(FIXTURES_DIR, 'poi-WithMaster.ppt'))).toEqual({
        kind: 'legacy',
        sourceFormat: 'ppt',
        targetFormat: 'pptx',
      })
    })
  })

  describe('OOXML output validation, timeout, cancellation & converter_missing', () => {
    it('throws converter_missing when no bundled LibreOffice is present', async () => {
      const inputPath = join(FIXTURES_DIR, 'vn-budget.xls')
      await expect(
        convertLegacyFile(inputPath, {
          loOptions: { envDir: '' },
        }),
      ).rejects.toMatchObject({
        code: 'converter_missing',
        format: 'xls',
      })
    })

    it('rejects when soffice exits 0 without producing an output file or produces invalid ZIP bytes', async () => {
      const root = makeTempDir()
      const loDir = join(root, 'lo')
      mkdirSync(join(loDir, 'program'), { recursive: true })
      writeFileSync(join(loDir, 'program', 'soffice.bin'), '')

      // Case 1: soffice exits 0 but writes no file
      const { spawnFn: spawnEmpty } = createFakeChildProcess({
        exitCode: 0,
        stderrText: 'Error: source file could not be loaded',
      })
      await expect(
        convertLegacyFile(join(FIXTURES_DIR, 'vn-template.doc'), {
          loOptions: { platform: 'linux', envDir: loDir },
          tempRoot: root,
          spawnFn: spawnEmpty,
          killTreeDeps: { killPosixTree: () => {} },
        }),
      ).rejects.toMatchObject({
        code: 'corrupt',
        format: 'doc',
      })

      // Case 2: soffice writes a non-ZIP or wrong-main-part ZIP
      const badZipBytes = await makeMinimalOoxmlZip('xlsx')
      const { spawnFn: spawnBadZip } = createFakeChildProcess({
        exitCode: 0,
        onSpawn: (args) => {
          const outIdx = args.indexOf('--outdir')
          const outDir = args[outIdx + 1]!
          // Write a valid xlsx zip when docx was requested
          writeFileSync(join(outDir, 'vn-template.docx'), badZipBytes)
        },
      })
      await expect(
        convertLegacyFile(join(FIXTURES_DIR, 'vn-template.doc'), {
          loOptions: { platform: 'linux', envDir: loDir },
          tempRoot: root,
          spawnFn: spawnBadZip,
          killTreeDeps: { killPosixTree: () => {} },
        }),
      ).rejects.toMatchObject({
        code: 'failed',
        format: 'doc',
      })
    })

    it('kills the process tree and rejects with code "timeout" when soffice exceeds timeoutMs', async () => {
      const root = makeTempDir()
      const loDir = join(root, 'lo')
      mkdirSync(join(loDir, 'program'), { recursive: true })
      writeFileSync(join(loDir, 'program', 'soffice.bin'), '')

      const killedPids: number[] = []
      const { spawnFn } = createFakeChildProcess({
        pid: 98765,
        neverExit: true,
      })

      await expect(
        convertLegacyFile(join(FIXTURES_DIR, 'vn-template.doc'), {
          loOptions: { platform: 'linux', envDir: loDir },
          tempRoot: root,
          timeoutMs: 30,
          spawnFn,
          killTreeDeps: {
            platform: 'linux',
            killPosixTree: (pid) => killedPids.push(pid),
          },
        }),
      ).rejects.toMatchObject({
        code: 'timeout',
        format: 'doc',
      })
      expect(killedPids).toContain(98765)
    })

    it('supports AbortSignal cancellation and cleans up the job temp directory', async () => {
      const root = makeTempDir()
      const loDir = join(root, 'lo')
      mkdirSync(join(loDir, 'program'), { recursive: true })
      writeFileSync(join(loDir, 'program', 'soffice.bin'), '')

      const controller = new AbortController()
      const killedPids: number[] = []
      const { spawnFn } = createFakeChildProcess({
        pid: 54321,
        neverExit: true,
        onSpawn: () => {
          setImmediate(() => controller.abort())
        },
      })

      await expect(
        convertLegacyFile(join(FIXTURES_DIR, 'vn-budget.xls'), {
          loOptions: { platform: 'linux', envDir: loDir },
          tempRoot: root,
          signal: controller.signal,
          spawnFn,
          killTreeDeps: {
            platform: 'linux',
            killPosixTree: (pid) => killedPids.push(pid),
          },
        }),
      ).rejects.toMatchObject({
        code: 'cancelled',
        format: 'xls',
      })
      expect(killedPids).toContain(54321)
    })
  })

  describe.skipIf(!hasRealLo)(
    'Real LibreOffice 26.8.2.2 integration (GENOFFICE_LO_DIR)',
    () => {
      it('converts .doc -> .docx, .xls -> .xlsx, and .ppt -> .pptx with valid OOXML parts without touching originals', async () => {
        const cases: Array<{
          file: string
          source: 'doc' | 'xls' | 'ppt'
          target: 'docx' | 'xlsx' | 'pptx'
        }> = [
          { file: 'poi-test-fields.doc', source: 'doc', target: 'docx' },
          { file: 'poi-FormatKM.xls', source: 'xls', target: 'xlsx' },
          { file: 'poi-WithMaster.ppt', source: 'ppt', target: 'pptx' },
        ]

        for (const c of cases) {
          const inputPath = join(FIXTURES_DIR, c.file)
          const beforeBytes = readFileSync(inputPath)
          const res = await convertLegacyFile(inputPath, {
            loOptions: { envDir: LO_DIR },
            timeoutMs: 30_000,
          })
          expect(res.kind).toBe('converted')
          expect(res.sourceFormat).toBe(c.source)
          expect(res.targetFormat).toBe(c.target)
          expect(res.bytes.byteLength).toBeGreaterThan(1000)
          expect(detectOoxmlKindFromZipBytes(res.bytes)).toBe(c.target)
          expect(() => validateOoxmlOutputBytes(res.bytes, c.target)).not.toThrow()
          // Original file is untouched
          expect(Buffer.compare(beforeBytes, readFileSync(inputPath))).toBe(0)
        }
      }, 60_000)

      it('enforces a tiny timeout against a real soffice process and kills the process tree', async () => {
        const inputPath = join(FIXTURES_DIR, 'poi-WithMaster.ppt')
        await expect(
          convertLegacyFile(inputPath, {
            loOptions: { envDir: LO_DIR },
            timeoutMs: 1,
          }),
        ).rejects.toMatchObject({
          code: 'timeout',
          format: 'ppt',
        })
      }, 15_000)
    },
  )
})
