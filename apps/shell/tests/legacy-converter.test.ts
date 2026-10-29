import { EventEmitter } from 'node:events'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSofficeArgs,
  buildSofficeEnv,
  convertLegacyFile,
  detectOoxmlKindFromZipBytes,
  killAllActiveLegacyConversions,
  LEGACY_INFILTER_FOR_SOURCE,
  LEGACY_TARGET_FOR_SOURCE,
  legacyFormatForPath,
  preflightLegacyBytes,
  preflightLegacyFile,
  preflightOdfBytes,
  resolveLibreOfficePaths,
  sofficeRelativePathForPlatform,
  suggestedOoxmlPathForLegacy,
  validateOoxmlOutputBytes,
  type SpawnSofficeFn,
} from '../src/main/legacy-converter'

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures', 'legacy')
const ODF_FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures', 'odf')
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

interface ZipPart {
  name: string
  method: 0 | 8
  /** bytes stored in the archive (already deflated for method 8) */
  data: Buffer
  /** uncompressed size the central directory claims */
  size: number
}

/** Hand-built ZIP so a test can claim huge parts without producing them. */
function buildZip(parts: readonly ZipPart[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const part of parts) {
    const name = Buffer.from(part.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(part.method, 8)
    local.writeUInt32LE(part.data.length, 18)
    local.writeUInt32LE(part.size, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(part.method, 10)
    central.writeUInt32LE(part.data.length, 20)
    central.writeUInt32LE(part.size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, part.data)
    centrals.push(central, name)
    offset += local.length + name.length + part.data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(parts.length, 8)
  eocd.writeUInt16LE(parts.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

interface CfbNode {
  name: string
  /** present for streams (padded to 4096 so no mini-stream is needed) */
  stream?: true
  children?: CfbNode[]
}

/**
 * Minimal CFB writer for preflight tests: 512-byte sectors, one FAT sector, every
 * stream 4096 zero bytes. Siblings are chained through the right pointer.
 */
function buildCfb(root: readonly CfbNode[]): Buffer {
  const flat: Array<{ node: CfbNode | null; child: number; right: number; start: number }> = [
    { node: null, child: -1, right: -1, start: 0xfffffffe },
  ]
  const place = (nodes: readonly CfbNode[]): number => {
    let first = -1
    let prev = -1
    for (const node of nodes) {
      const id = flat.length
      flat.push({ node, child: -1, right: -1, start: 0xfffffffe })
      if (first < 0) first = id
      if (prev >= 0) flat[prev]!.right = id
      prev = id
      if (node.children) flat[id]!.child = place(node.children)
    }
    return first
  }
  flat[0]!.child = place(root)

  const dirSectors = Math.ceil(flat.length / 4)
  let nextSector = 1 + dirSectors
  const fat = new Array<number>(128).fill(0xffffffff)
  fat[0] = 0xfffffffd
  for (let i = 0; i < dirSectors; i++) fat[1 + i] = i === dirSectors - 1 ? 0xfffffffe : 2 + i
  for (const entry of flat) {
    if (!entry.node?.stream) continue
    entry.start = nextSector
    for (let i = 0; i < 8; i++) fat[nextSector + i] = i === 7 ? 0xfffffffe : nextSector + i + 1
    nextSector += 8
  }

  const header = Buffer.alloc(512, 0)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header)
  header.writeUInt16LE(0x3e, 24)
  header.writeUInt16LE(3, 26)
  header.writeUInt16LE(0xfffe, 28)
  header.writeUInt16LE(9, 30)
  header.writeUInt16LE(6, 32)
  header.writeUInt32LE(1, 44)
  header.writeUInt32LE(1, 48)
  header.writeUInt32LE(4096, 56)
  header.writeUInt32LE(0xfffffffe, 60)
  header.writeUInt32LE(0xfffffffe, 68)
  header.fill(0xff, 76, 512)
  header.writeUInt32LE(0, 76)

  const fatSector = Buffer.alloc(512)
  fat.forEach((value, i) => fatSector.writeUInt32LE(value, i * 4))
  const dir = Buffer.alloc(dirSectors * 512)
  flat.forEach((entry, id) => {
    const at = id * 128
    const name = entry.node?.name ?? 'Root Entry'
    Buffer.from(name, 'utf16le').copy(dir, at)
    dir.writeUInt16LE(name.length * 2 + 2, at + 64)
    dir[at + 66] = entry.node ? (entry.node.stream ? 2 : 1) : 5
    dir[at + 67] = 1
    dir.writeUInt32LE(0xffffffff, at + 68)
    dir.writeUInt32LE(entry.right < 0 ? 0xffffffff : entry.right, at + 72)
    dir.writeUInt32LE(entry.child < 0 ? 0xffffffff : entry.child, at + 76)
    dir.writeUInt32LE(entry.start, at + 116)
    dir.writeUInt32LE(entry.node?.stream ? 4096 : 0, at + 120)
  })
  const streams = Buffer.alloc((nextSector - 1 - dirSectors) * 512)
  return Buffer.concat([header, fatSector, dir, streams])
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return true
  }
}

function makeFakeChild(pid: number): { child: ChildProcess; emitter: EventEmitter } {
  const emitter = new EventEmitter()
  const child = Object.assign(emitter, {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => {
      setImmediate(() => emitter.emit('exit', null))
      return true
    }),
  }) as unknown as ChildProcess
  return { child, emitter }
}

function createFakeChildProcess(opts: {
  pid?: number
  exitCode?: number | null
  stderrText?: string
  onSpawn?: (args: readonly string[], options: { env: NodeJS.ProcessEnv; cwd: string }) => void
  neverExit?: boolean
}): { spawnFn: SpawnSofficeFn; getSpawnCount: () => number } {
  let spawnCount = 0
  const spawnFn: SpawnSofficeFn = (_cmd, args, options) => {
    spawnCount++
    const { child, emitter } = makeFakeChild(opts.pid ?? 42424)
    const stderr = child.stderr as unknown as EventEmitter

    if (opts.onSpawn) opts.onSpawn(args, options)

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
      killGroup: () => {},
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
    it('maps legacy and OpenDocument extensions to target OOXML extensions, infilters and suggested Save As paths', () => {
      expect(legacyFormatForPath('/tmp/report.doc')).toBe('doc')
      expect(legacyFormatForPath('/tmp/sheet.XLS')).toBe('xls')
      expect(legacyFormatForPath('/tmp/slides.Ppt')).toBe('ppt')
      expect(legacyFormatForPath('/tmp/report.odt')).toBe('odt')
      expect(legacyFormatForPath('/tmp/template.OTT')).toBe('ott')
      expect(legacyFormatForPath('/tmp/sheet.ods')).toBe('ods')
      expect(legacyFormatForPath('/tmp/template.OTS')).toBe('ots')
      expect(legacyFormatForPath('/tmp/slides.odp')).toBe('odp')
      expect(legacyFormatForPath('/tmp/template.OTP')).toBe('otp')
      expect(legacyFormatForPath('/tmp/modern.docx')).toBeNull()

      expect(LEGACY_TARGET_FOR_SOURCE).toEqual({
        doc: 'docx',
        odt: 'docx',
        ott: 'docx',
        xls: 'xlsx',
        ods: 'xlsx',
        ots: 'xlsx',
        ppt: 'pptx',
        odp: 'pptx',
        otp: 'pptx',
      })

      // R1: the trimmed LibreOffice pack requires explicit writer8 / calc8 / impress8 infilters for ODF
      expect(LEGACY_INFILTER_FOR_SOURCE).toEqual({
        doc: 'MS Word 97',
        odt: 'writer8',
        ott: 'writer8',
        xls: 'MS Excel 97',
        ods: 'calc8',
        ots: 'calc8',
        ppt: 'MS PowerPoint 97',
        odp: 'impress8',
        otp: 'impress8',
      })

      expect(suggestedOoxmlPathForLegacy('/Users/a/Quarterly Report.doc')).toBe(
        '/Users/a/Quarterly Report.docx',
      )
      expect(suggestedOoxmlPathForLegacy('/Users/a/budget.XLS')).toBe('/Users/a/budget.xlsx')
      expect(suggestedOoxmlPathForLegacy('/Users/a/deck.ppt')).toBe('/Users/a/deck.pptx')
      expect(suggestedOoxmlPathForLegacy('/Users/a/report.odt')).toBe('/Users/a/report.docx')
      expect(suggestedOoxmlPathForLegacy('/Users/a/letter.OTT')).toBe('/Users/a/letter.docx')
      expect(suggestedOoxmlPathForLegacy('/Users/a/budget.ods')).toBe('/Users/a/budget.xlsx')
      expect(suggestedOoxmlPathForLegacy('/Users/a/budget.ots')).toBe('/Users/a/budget.xlsx')
      expect(suggestedOoxmlPathForLegacy('/Users/a/deck.odp')).toBe('/Users/a/deck.pptx')
      expect(suggestedOoxmlPathForLegacy('/Users/a/deck.otp')).toBe('/Users/a/deck.pptx')
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

      for (const [sourceFormat, targetFormat, infilter] of [
        ['odt', 'docx', 'writer8'],
        ['ott', 'docx', 'writer8'],
        ['ods', 'xlsx', 'calc8'],
        ['ots', 'xlsx', 'calc8'],
        ['odp', 'pptx', 'impress8'],
        ['otp', 'pptx', 'impress8'],
      ] as const) {
        const odfArgs = buildSofficeArgs({
          profileDir: '/tmp/job-1/profile',
          sourceFormat,
          targetFormat,
          outDir: '/tmp/job-1/out',
          inputPath: `/tmp/input.${sourceFormat}`,
        })
        expect(odfArgs).toContain(`--infilter=${infilter}`)
        expect(odfArgs).toContain(targetFormat)
      }
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

    it.each([
      ['native-writer.odt', 'odt'],
      ['native-calc.ods', 'ods'],
      ['native-impress.odp', 'odp'],
    ] as const)(
      'refuses password-protected ODF fixture %s (%s) with code "encrypted" without spawning soffice',
      async (fileName, format) => {
        const filePath = join(ODF_FIXTURES_DIR, 'pw', fileName)
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
      ['empty.odt', 'odt'],
      ['not-a-zip.odt', 'odt'],
      ['truncated.odt', 'odt'],
      ['bomb-content-80mib.odt', 'odt'],
      ['wrong-mimetype.odt', 'odt'],
    ] as const)(
      'refuses hostile/corrupt ODF fixture %s (%s) in pre-check with code "corrupt" without spawning soffice (R2)',
      async (fileName, format) => {
        const filePath = join(ODF_FIXTURES_DIR, 'security', fileName)
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

    it.each([
      ['native-writer.odt', 'odt', 'docx'],
      ['native-writer.ott', 'ott', 'docx'],
      ['native-calc.ods', 'ods', 'xlsx'],
      ['native-calc.ots', 'ots', 'xlsx'],
      ['native-impress.odp', 'odp', 'pptx'],
      ['native-impress.otp', 'otp', 'pptx'],
    ] as const)(
      'accepts valid ODF fixture %s (%s -> %s) in preflight and converts via soffice with explicit infilter',
      async (fileName, sourceFormat, targetFormat) => {
        const filePath = join(ODF_FIXTURES_DIR, fileName)
        expect(preflightLegacyFile(filePath)).toEqual({
          kind: 'legacy',
          sourceFormat,
          targetFormat,
        })
        expect(preflightOdfBytes(new Uint8Array(readFileSync(filePath)), sourceFormat)).toEqual({
          kind: 'legacy',
          sourceFormat,
          targetFormat,
        })

        const root = makeTempDir()
        const loDir = join(root, 'lo')
        mkdirSync(join(loDir, 'program'), { recursive: true })
        writeFileSync(join(loDir, 'program', 'soffice.bin'), '')
        const outZip = await makeMinimalOoxmlZip(targetFormat)
        let seenArgs: readonly string[] = []
        const { spawnFn } = createFakeChildProcess({
          onSpawn: (args) => {
            seenArgs = args
            const outDir = args[args.indexOf('--outdir') + 1]!
            const stem = fileName.replace(/\.[^.]+$/, '')
            writeFileSync(join(outDir, `${stem}.${targetFormat}`), outZip)
          },
        })
        const res = await convertLegacyFile(filePath, {
          loOptions: { platform: 'linux', envDir: loDir },
          tempRoot: root,
          spawnFn,
          killTreeDeps: { killGroup: () => {} },
        })
        expect(res.kind).toBe('converted')
        expect(res.sourceFormat).toBe(sourceFormat)
        expect(res.targetFormat).toBe(targetFormat)
        expect(seenArgs).toContain(`--infilter=${LEGACY_INFILTER_FOR_SOURCE[sourceFormat]}`)
      },
    )

    it('refuses an ODF archive whose shortened EOCD count hides an oversized central-directory record without spawning soffice (F1)', async () => {
      const mimeBytes = Buffer.from('application/vnd.oasis.opendocument.text', 'utf8')
      const stylesBytes = deflateRawSync(Buffer.from('<office:document-styles/>', 'utf8'))
      const bombBytes = deflateRawSync(Buffer.from('<office:document-content/>', 'utf8'))
      const archive = buildZip([
        { name: 'mimetype', method: 0, data: mimeBytes, size: mimeBytes.length },
        { name: 'styles.xml', method: 8, data: stylesBytes, size: 25 },
        { name: 'content.xml', method: 8, data: bombBytes, size: 80 * 1024 * 1024 },
      ])
      const eocdOffset = archive.length - 22
      archive.writeUInt16LE(2, eocdOffset + 8)
      archive.writeUInt16LE(2, eocdOffset + 10)

      expect(() => preflightOdfBytes(archive, 'odt')).toThrowError(
        expect.objectContaining({
          name: 'LegacyConvertError',
          code: 'corrupt',
          format: 'odt',
        }),
      )

      const dir = makeTempDir()
      const filePath = join(dir, 'short-eocd.odt')
      writeFileSync(filePath, archive)
      const { spawnFn, getSpawnCount } = createFakeChildProcess({})
      await expect(
        convertLegacyFile(filePath, {
          sourceFormat: 'odt',
          spawnFn,
        }),
      ).rejects.toMatchObject({
        code: 'corrupt',
        format: 'odt',
      })
      expect(getSpawnCount()).toBe(0)
    })

    it('refuses a stored ODF manifest exceeding 64 MiB with forged uncompressed size 1 and refuses deflated length mismatches (F2)', () => {
      const mimeBytes = Buffer.from('application/vnd.oasis.opendocument.text', 'utf8')
      const contentBytes = Buffer.from('<office:document-content/>', 'utf8')
      const hugeManifest = Buffer.alloc(65 * 1024 * 1024, 0x20)
      Buffer.from(
        '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">',
      ).copy(hugeManifest, 0)
      const tail = Buffer.from(
        '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/></manifest:manifest>',
      )
      tail.copy(hugeManifest, hugeManifest.length - tail.length)

      const forgedStoredManifest = buildZip([
        { name: 'mimetype', method: 0, data: mimeBytes, size: mimeBytes.length },
        { name: 'META-INF/manifest.xml', method: 0, data: hugeManifest, size: 1 },
        { name: 'content.xml', method: 0, data: contentBytes, size: contentBytes.length },
      ])
      expect(() => preflightOdfBytes(forgedStoredManifest, 'odt')).toThrowError(
        expect.objectContaining({
          name: 'LegacyConvertError',
          code: 'corrupt',
          format: 'odt',
        }),
      )

      const realManifest = Buffer.from(
        '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/></manifest:manifest>',
        'utf8',
      )
      const mismatchedDeflate = buildZip([
        { name: 'mimetype', method: 0, data: mimeBytes, size: mimeBytes.length },
        {
          name: 'META-INF/manifest.xml',
          method: 8,
          data: deflateRawSync(realManifest),
          size: realManifest.length + 10,
        },
        { name: 'content.xml', method: 0, data: contentBytes, size: contentBytes.length },
      ])
      expect(() => preflightOdfBytes(mismatchedDeflate, 'odt')).toThrowError(
        expect.objectContaining({
          name: 'LegacyConvertError',
          code: 'corrupt',
          format: 'odt',
        }),
      )
    })

    it('refuses cross-family ODF media types (mimetype or manifest root) while allowing document/template within the same family (F3)', async () => {
      const calcPath = join(ODF_FIXTURES_DIR, 'native-calc.ods')
      const calcBytes = new Uint8Array(readFileSync(calcPath))
      expect(() => preflightOdfBytes(calcBytes, 'odt')).toThrowError(
        expect.objectContaining({
          name: 'LegacyConvertError',
          code: 'corrupt',
          format: 'odt',
        }),
      )

      const dir = makeTempDir()
      const misnamedOdt = join(dir, 'actually-calc.odt')
      copyFileSync(calcPath, misnamedOdt)
      const { spawnFn, getSpawnCount } = createFakeChildProcess({})
      await expect(
        convertLegacyFile(misnamedOdt, {
          sourceFormat: 'odt',
          spawnFn,
        }),
      ).rejects.toMatchObject({
        code: 'corrupt',
        format: 'odt',
      })
      expect(getSpawnCount()).toBe(0)

      // Same-family document vs template is accepted
      const writerTemplateBytes = new Uint8Array(
        readFileSync(join(ODF_FIXTURES_DIR, 'native-writer.ott')),
      )
      expect(preflightOdfBytes(writerTemplateBytes, 'odt')).toEqual({
        kind: 'legacy',
        sourceFormat: 'odt',
        targetFormat: 'docx',
      })

      // Manifest root media-type fallback when mimetype entry is absent
      const manifestOnlyBytes = Buffer.from(
        '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/></manifest:manifest>',
        'utf8',
      )
      const contentOnlyBytes = Buffer.from('<office:document-content/>', 'utf8')
      const manifestOnlyCalc = buildZip([
        {
          name: 'META-INF/manifest.xml',
          method: 0,
          data: manifestOnlyBytes,
          size: manifestOnlyBytes.length,
        },
        {
          name: 'content.xml',
          method: 0,
          data: contentOnlyBytes,
          size: contentOnlyBytes.length,
        },
      ])
      expect(preflightOdfBytes(manifestOnlyCalc, 'ods')).toEqual({
        kind: 'legacy',
        sourceFormat: 'ods',
        targetFormat: 'xlsx',
      })
      expect(() => preflightOdfBytes(manifestOnlyCalc, 'odt')).toThrowError(
        expect.objectContaining({
          name: 'LegacyConvertError',
          code: 'corrupt',
          format: 'odt',
        }),
      )
    })

    it('honours UTF-16 BOM on encrypted ODF manifests with code "encrypted" and refuses malformed/unsupported manifest encodings as "corrupt" (F6)', async () => {
      const mimeBytes = Buffer.from('application/vnd.oasis.opendocument.text', 'utf8')
      const contentBytes = Buffer.from('encrypted-payload', 'utf8')
      const manifestText =
        '<?xml version="1.0" encoding="UTF-16"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#sha256-1k" manifest:checksum="abc="/></manifest:file-entry></manifest:manifest>'
      const utf16LeManifest = Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(manifestText, 'utf16le'),
      ])
      const utf16LeArchive = buildZip([
        { name: 'mimetype', method: 0, data: mimeBytes, size: mimeBytes.length },
        {
          name: 'META-INF/manifest.xml',
          method: 8,
          data: deflateRawSync(utf16LeManifest),
          size: utf16LeManifest.length,
        },
        { name: 'content.xml', method: 0, data: contentBytes, size: contentBytes.length },
      ])
      expect(() => preflightOdfBytes(utf16LeArchive, 'odt')).toThrowError(
        expect.objectContaining({
          name: 'LegacyConvertError',
          code: 'encrypted',
          format: 'odt',
        }),
      )

      const dir = makeTempDir()
      const utf16LePath = join(dir, 'utf16le-pw.odt')
      writeFileSync(utf16LePath, utf16LeArchive)
      const { spawnFn, getSpawnCount } = createFakeChildProcess({})
      await expect(
        convertLegacyFile(utf16LePath, {
          sourceFormat: 'odt',
          spawnFn,
        }),
      ).rejects.toMatchObject({
        code: 'encrypted',
        format: 'odt',
      })
      expect(getSpawnCount()).toBe(0)

      // UTF-16BE BOM encrypted manifest also throws encrypted
      const utf16BeBody = Buffer.from(manifestText, 'utf16le')
      utf16BeBody.swap16()
      const utf16BeManifest = Buffer.concat([Buffer.from([0xfe, 0xff]), utf16BeBody])
      const utf16BeArchive = buildZip([
        { name: 'mimetype', method: 0, data: mimeBytes, size: mimeBytes.length },
        {
          name: 'META-INF/manifest.xml',
          method: 0,
          data: utf16BeManifest,
          size: utf16BeManifest.length,
        },
        { name: 'content.xml', method: 0, data: contentBytes, size: contentBytes.length },
      ])
      expect(() => preflightOdfBytes(utf16BeArchive, 'odt')).toThrowError(
        expect.objectContaining({
          name: 'LegacyConvertError',
          code: 'encrypted',
          format: 'odt',
        }),
      )

      // Invalid UTF-8 bytes in manifest -> corrupt
      const invalidUtf8Manifest = Buffer.from([0xff, 0xff, 0xff, 0x3c, 0x3f, 0x78, 0x6d, 0x6c])
      const badEncodingArchive = buildZip([
        { name: 'mimetype', method: 0, data: mimeBytes, size: mimeBytes.length },
        {
          name: 'META-INF/manifest.xml',
          method: 0,
          data: invalidUtf8Manifest,
          size: invalidUtf8Manifest.length,
        },
        { name: 'content.xml', method: 0, data: contentBytes, size: contentBytes.length },
      ])
      expect(() => preflightOdfBytes(badEncodingArchive, 'odt')).toThrowError(
        expect.objectContaining({
          name: 'LegacyConvertError',
          code: 'corrupt',
          format: 'odt',
        }),
      )
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
          killTreeDeps: { killGroup: () => {} },
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
          killTreeDeps: { killGroup: () => {} },
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
            killGroup: (pid) => killedPids.push(pid),
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
            killGroup: (pid) => killedPids.push(pid),
          },
        }),
      ).rejects.toMatchObject({
        code: 'cancelled',
        format: 'xls',
      })
      expect(killedPids).toContain(54321)
    })
  })

  describe('bounded, non-blocking input handling', () => {
    it('answers a misnamed ZIP claiming 64 x 16 MiB parts without blocking the event loop', async () => {
      const dir = makeTempDir()
      const huge = deflateRawSync(Buffer.alloc(16 * 1024 * 1024))
      const contentTypes = Buffer.from('<Types/>')
      const zip = buildZip([
        { name: '[Content_Types].xml', method: 0, data: contentTypes, size: contentTypes.length },
        ...Array.from({ length: 64 }, () => ({
          name: 'word/document.xml',
          method: 8 as const,
          data: huge,
          size: 16 * 1024 * 1024,
        })),
      ])
      const input = join(dir, 'bomb.doc')
      writeFileSync(input, zip)

      let last = performance.now()
      let maxGap = 0
      const heartbeat = setInterval(() => {
        const now = performance.now()
        maxGap = Math.max(maxGap, now - last)
        last = now
      }, 5)
      try {
        const res = await convertLegacyFile(input)
        maxGap = Math.max(maxGap, performance.now() - last)
        expect(res.kind).toBe('ooxml_misnamed')
      } finally {
        clearInterval(heartbeat)
      }
      expect(maxGap).toBeLessThan(250)
    })

    it('refuses a directory, an oversize file and (on POSIX) a FIFO without reading them', async () => {
      const dir = makeTempDir()
      const asDir = join(dir, 'folder.doc')
      mkdirSync(asDir)
      await expect(convertLegacyFile(asDir)).rejects.toMatchObject({ code: 'unsupported' })

      const huge = join(dir, 'huge.xls')
      writeFileSync(huge, '')
      truncateSync(huge, 200 * 1024 * 1024 + 1)
      await expect(convertLegacyFile(huge)).rejects.toMatchObject({
        code: 'unsupported',
        format: 'xls',
      })

      if (process.platform !== 'win32') {
        const fifo = join(dir, 'pipe.ppt')
        execFileSync('mkfifo', [fifo])
        await expect(convertLegacyFile(fifo)).rejects.toMatchObject({
          code: 'unsupported',
          format: 'ppt',
        })
      }
    })

    it('checks a converted ZIP by its central directory without inflating any part', () => {
      const contentTypes = Buffer.from('<Types/>')
      const claimsHugeMain = buildZip([
        { name: '[Content_Types].xml', method: 0, data: contentTypes, size: contentTypes.length },
        {
          name: 'word/document.xml',
          method: 8,
          data: Buffer.from('not a deflate stream'),
          size: 3 * 1024 * 1024 * 1024,
        },
      ])
      expect(() => validateOoxmlOutputBytes(claimsHugeMain, 'docx')).not.toThrow()
      expect(() => validateOoxmlOutputBytes(claimsHugeMain, 'xlsx')).toThrowError(
        expect.objectContaining({ code: 'failed' }),
      )
    })
  })

  describe('streams of the document itself decide format and encryption (R1-15)', () => {
    it('keeps an unencrypted .doc legacy when only an embedded object carries EncryptionInfo', () => {
      const nested = buildCfb([
        { name: 'WordDocument', stream: true },
        {
          name: 'ObjectPool',
          children: [{ name: 'Embedded', children: [{ name: 'EncryptionInfo', stream: true }] }],
        },
      ])
      expect(preflightLegacyBytes(nested, 'doc')).toEqual({
        kind: 'legacy',
        sourceFormat: 'doc',
        targetFormat: 'docx',
      })

      const rootLevel = buildCfb([
        { name: 'WordDocument', stream: true },
        { name: 'EncryptionInfo', stream: true },
      ])
      expect(() => preflightLegacyBytes(rootLevel, 'doc')).toThrowError(
        expect.objectContaining({ code: 'encrypted' }),
      )
    })
  })

  describe('job isolation and lifecycle', () => {
    const makeFakeLo = (): { root: string; loDir: string } => {
      const root = makeTempDir()
      const loDir = join(root, 'lo')
      mkdirSync(join(loDir, 'program'), { recursive: true })
      writeFileSync(join(loDir, 'program', 'soffice.bin'), '')
      return { root, loDir }
    }

    it.skipIf(process.platform === 'win32')(
      'creates the job, its staged input and its output owner-only',
      async () => {
        const { root, loDir } = makeFakeLo()
        const modes: Record<string, number> = {}
        const docx = await makeMinimalOoxmlZip('docx')
        const { spawnFn } = createFakeChildProcess({
          onSpawn: (args, options) => {
            const outDir = args[args.indexOf('--outdir') + 1]!
            const input = args[args.length - 1]!
            modes.jobsRoot = statSync(dirname(options.cwd)).mode & 0o777
            modes.job = statSync(options.cwd).mode & 0o777
            modes.input = statSync(input).mode & 0o777
            modes.out = statSync(outDir).mode & 0o777
            writeFileSync(join(outDir, 'vn-template.docx'), docx)
          },
        })
        await convertLegacyFile(join(FIXTURES_DIR, 'vn-template.doc'), {
          loOptions: { platform: 'linux', envDir: loDir },
          tempRoot: root,
          spawnFn,
          killTreeDeps: { killGroup: () => {} },
        })
        for (const [what, mode] of Object.entries(modes)) {
          expect(mode & 0o077, `${what} is ${mode.toString(8)}`).toBe(0)
        }
      },
    )

    it('converts the bytes it inspected, not whatever the path holds later, and resolves a relative path', async () => {
      const { root, loDir } = makeFakeLo()
      const dir = makeTempDir()
      const source = join(dir, 'snap.doc')
      copyFileSync(join(FIXTURES_DIR, 'vn-template.doc'), source)
      const inspected = readFileSync(source)
      const seen: { path?: string; bytes?: Buffer } = {}
      const docx = await makeMinimalOoxmlZip('docx')
      const { spawnFn } = createFakeChildProcess({
        onSpawn: (args) => {
          writeFileSync(source, 'replaced after preflight')
          seen.path = args[args.length - 1]!
          seen.bytes = readFileSync(seen.path)
          writeFileSync(join(args[args.indexOf('--outdir') + 1]!, 'snap.docx'), docx)
        },
      })
      const res = await convertLegacyFile(relative(process.cwd(), source), {
        loOptions: { platform: 'linux', envDir: loDir },
        tempRoot: root,
        spawnFn: spawnFn,
        killTreeDeps: { killGroup: () => {} },
      })
      expect(res.kind).toBe('converted')
      expect(res.suggestedSaveAsPath).toBe(join(dir, 'snap.docx'))
      expect(isAbsolute(seen.path!)).toBe(true)
      expect(seen.path).not.toBe(source)
      expect(Buffer.compare(seen.bytes!, inspected)).toBe(0)
    })

    it('gives the exit-81 retry only the time left of one deadline', async () => {
      const { root, loDir } = makeFakeLo()
      let spawns = 0
      let firstSpawnAt = 0
      const spawnFn: SpawnSofficeFn = () => {
        spawns++
        if (spawns === 1) firstSpawnAt = Date.now()
        const { child, emitter } = makeFakeChild(50_000 + spawns)
        if (spawns === 1) setTimeout(() => emitter.emit('exit', 81), 400)
        return child
      }
      await expect(
        convertLegacyFile(join(FIXTURES_DIR, 'vn-template.doc'), {
          loOptions: { platform: 'linux', envDir: loDir },
          tempRoot: root,
          timeoutMs: 600,
          spawnFn,
          killTreeDeps: { killGroup: () => {} },
        }),
      ).rejects.toMatchObject({ code: 'timeout' })
      expect(spawns).toBe(2)
      expect(Date.now() - firstSpawnAt).toBeLessThan(800)
    })

    it('rejects queued jobs and refuses new ones once the converter is disposed', async () => {
      vi.resetModules()
      const fresh = await import('../src/main/legacy-converter')
      const { root, loDir } = makeFakeLo()
      const { spawnFn, getSpawnCount } = createFakeChildProcess({ pid: 31337, neverExit: true })
      const killed: number[] = []
      const run = (signal?: AbortSignal) =>
        fresh
          .convertLegacyFile(join(FIXTURES_DIR, 'vn-template.doc'), {
            loOptions: { platform: 'linux', envDir: loDir },
            tempRoot: root,
            timeoutMs: 10_000,
            signal,
            spawnFn,
            killTreeDeps: { killGroup: (pid) => killed.push(pid) },
          })
          .catch((err: unknown) => err)
      const a = new AbortController()
      const b = new AbortController()
      const active = [run(a.signal), run(b.signal)]
      await vi.waitFor(() => expect(getSpawnCount()).toBe(2))
      const queued = run()

      fresh.disposeLegacyConverter({ killGroup: (pid) => killed.push(pid) })
      expect(await queued).toMatchObject({ code: 'cancelled' })
      expect(await run()).toMatchObject({ code: 'cancelled' })
      a.abort()
      b.abort()
      expect(await Promise.all(active)).toEqual([
        expect.objectContaining({ code: 'cancelled' }),
        expect.objectContaining({ code: 'cancelled' }),
      ])
      expect(getSpawnCount()).toBe(2)
      expect(killed).toContain(31337)
    })

    it.skipIf(process.platform === 'win32')(
      'kills a helper that outlives soffice once soffice has exited normally',
      async () => {
        const { root, loDir } = makeFakeLo()
        const dir = makeTempDir()
        const docxPath = join(dir, 'fixture.docx')
        writeFileSync(docxPath, await makeMinimalOoxmlZip('docx'))
        const pidFile = join(dir, 'helper.pid')
        const script = join(dir, 'fake-soffice.cjs')
        writeFileSync(
          script,
          [
            "const { spawn } = require('node:child_process')",
            "const fs = require('node:fs')",
            'const [src, out, pidFile] = process.argv.slice(2)',
            "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
            'fs.writeFileSync(pidFile, String(helper.pid))',
            'fs.copyFileSync(src, out)',
            'helper.unref()',
          ].join('\n'),
        )
        const spawnFn: SpawnSofficeFn = (_cmd, args, options) => {
          const outDir = args[args.indexOf('--outdir') + 1]!
          const stem = basename(args[args.length - 1]!).replace(/\.[^.]+$/, '')
          return spawn(
            process.execPath,
            [script, docxPath, join(outDir, `${stem}.docx`), pidFile],
            { env: options.env, cwd: options.cwd, stdio: 'ignore', detached: true },
          )
        }
        let helperPid = 0
        try {
          const res = await convertLegacyFile(join(FIXTURES_DIR, 'vn-template.doc'), {
            loOptions: { platform: 'linux', envDir: loDir },
            tempRoot: root,
            spawnFn,
          })
          expect(res.kind).toBe('converted')
          helperPid = Number(readFileSync(pidFile, 'utf8'))
          expect(helperPid).toBeGreaterThan(0)
          await vi.waitFor(() => expect(isProcessAlive(helperPid)).toBe(false), { timeout: 3000 })
        } finally {
          if (helperPid > 0 && isProcessAlive(helperPid)) process.kill(helperPid, 'SIGKILL')
        }
      },
    )
  })

  describe.skipIf(!hasRealLo)('Real LibreOffice 26.8.2.2 integration (GENOFFICE_LO_DIR)', () => {
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
  })
})
