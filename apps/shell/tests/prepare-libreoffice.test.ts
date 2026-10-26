import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const shellRoot = resolve(import.meta.dirname, '..')
const {
  loadManifest,
  manifestHash,
  verifyArchiveChecksum,
  parseElfNeeded,
  parseMachoNeeded,
  parsePeNeeded,
  verifyBinaryClosure,
  trimUnpackedTree,
  isPackValid,
  writeReadyMarker,
} = require(resolve(shellRoot, 'build/prepare-libreoffice.cjs'))

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Construct a minimal valid 64-bit little-endian ELF buffer whose SHT_DYNAMIC
 * section lists the given DT_NEEDED library names.
 */
function buildSyntheticElf64(neededLibs: string[]): Buffer {
  const strtabParts = [Buffer.from([0])]
  const offsets: number[] = []
  let currentOffset = 1
  for (const lib of neededLibs) {
    offsets.push(currentOffset)
    const b = Buffer.from(`${lib}\0`, 'utf8')
    strtabParts.push(b)
    currentOffset += b.length
  }
  const strtab = Buffer.concat(strtabParts)

  // Each dynamic entry is 16 bytes (d_tag u64 + d_val u64), terminated by DT_NULL (0, 0)
  const dynSize = (neededLibs.length + 1) * 16
  const dynBuf = Buffer.alloc(dynSize)
  for (let i = 0; i < neededLibs.length; i++) {
    dynBuf.writeBigUInt64LE(1n, i * 16) // DT_NEEDED = 1
    dynBuf.writeBigUInt64LE(BigInt(offsets[i]), i * 16 + 8)
  }

  // Layout:
  // 0..64: ELF64 header
  // 64..64+3*64 (256): 3 section headers (NULL, .dynstr, .dynamic)
  // 256..256+strtab.length: .dynstr
  // aligned: .dynamic
  const shoff = 64
  const shentsize = 64
  const shnum = 3
  const strtabOff = shoff + shnum * shentsize
  const dynOff = strtabOff + strtab.length
  const totalLen = dynOff + dynBuf.length

  const buf = Buffer.alloc(totalLen)
  // Magic: 0x7f 'E' 'L' 'F', class=2 (64-bit), data=1 (LE), version=1
  buf[0] = 0x7f
  buf[1] = 0x45
  buf[2] = 0x4c
  buf[3] = 0x46
  buf[4] = 2
  buf[5] = 1
  buf[6] = 1
  buf.writeBigUInt64LE(BigInt(shoff), 40)
  buf.writeUInt16LE(shentsize, 58)
  buf.writeUInt16LE(shnum, 60)

  // Section 1: .dynstr (SHT_STRTAB = 3)
  const sh1 = shoff + shentsize
  buf.writeUInt32LE(3, sh1 + 4)
  buf.writeBigUInt64LE(BigInt(strtabOff), sh1 + 24)
  buf.writeBigUInt64LE(BigInt(strtab.length), sh1 + 32)

  // Section 2: .dynamic (SHT_DYNAMIC = 6, sh_link = 1)
  const sh2 = shoff + 2 * shentsize
  buf.writeUInt32LE(6, sh2 + 4)
  buf.writeBigUInt64LE(BigInt(dynOff), sh2 + 24)
  buf.writeBigUInt64LE(BigInt(dynBuf.length), sh2 + 32)
  buf.writeUInt32LE(1, sh2 + 40)

  strtab.copy(buf, strtabOff)
  dynBuf.copy(buf, dynOff)
  return buf
}

/**
 * Construct a minimal synthetic Mach-O 64-bit little-endian buffer with LC_LOAD_DYLIB commands.
 */
function buildSyntheticMacho64(dylibs: string[]): Buffer {
  const cmds: Buffer[] = []
  for (const dep of dylibs) {
    const strBytes = Buffer.from(`${dep}\0`, 'utf8')
    const rawLen = 24 + strBytes.length
    const cmdsize = (rawLen + 7) & ~7
    const cmd = Buffer.alloc(cmdsize)
    cmd.writeUInt32LE(0x0c, 0) // LC_LOAD_DYLIB
    cmd.writeUInt32LE(cmdsize, 4)
    cmd.writeUInt32LE(24, 8) // name offset
    strBytes.copy(cmd, 24)
    cmds.push(cmd)
  }
  const cmdsBuf = Buffer.concat(cmds)
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0) // MH_MAGIC_64
  header.writeUInt32LE(cmds.length, 16) // ncmds
  header.writeUInt32LE(cmdsBuf.length, 20) // sizeofcmds
  return Buffer.concat([header, cmdsBuf])
}

describe('libreoffice-manifest.json', () => {
  const manifest = loadManifest()

  it('pins official TDF 26.8.2.2 archive URLs and SHA-256 digests for all 6 desktop targets', () => {
    expect(manifest.version).toBe('26.8.2.2')
    expect(manifest.buildId).toBe('9dea406ab7695df6325b11b0e19fdca8db4b7276')
    expect(manifest.sourceUrl).toBe(
      'https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.2.2/src/',
    )
    const targets = Object.keys(manifest.archives).sort()
    expect(targets).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64',
    ])
    for (const target of targets) {
      const entry = manifest.archives[target]
      expect(entry.url).toMatch(
        /^https:\/\/downloadarchive\.documentfoundation\.org\/libreoffice\/old\/26\.8\.2\.2\//,
      )
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(manifest.keep[entry.keepKey]?.length).toBeGreaterThan(200)
    }
    expect(manifest.fonts24).toHaveLength(24)
  })
})

describe('prepare-libreoffice manifest & trim logic', () => {
  it('verifies SHA-256 checksums and rejects tampered or missing archives', () => {
    const dir = makeTempDir('lo-checksum-')
    const archivePath = join(dir, 'sample.tar.gz')
    const payload = Buffer.from('official-tdf-archive-payload-26.8.2.2', 'utf8')
    writeFileSync(archivePath, payload)
    const expected = createHash('sha256').update(payload).digest('hex')

    expect(verifyArchiveChecksum(archivePath, expected)).toBe(expected)
    expect(() => verifyArchiveChecksum(archivePath, '0'.repeat(64))).toThrow(/SHA-256 mismatch/)
    expect(() => verifyArchiveChecksum(join(dir, 'nonexistent.tar.gz'), expected)).toThrow(
      /Archive missing/,
    )
  })

  it('trims a fake unpacked tree by the keep manifest, drops unkept files, and generates template-profile', () => {
    const root = makeTempDir('lo-trim-ok-')
    const srcRoot = join(root, 'unpacked')
    const dstRoot = join(root, 'trimmed')

    const fakeManifest = {
      version: '26.8.2.2',
      buildId: '9dea406ab7695df6325b11b0e19fdca8db4b7276',
      archives: {
        'linux-arm64': {
          url: 'https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.2.2/deb/aarch64/LibreOffice_26.8.2.2_Linux_aarch64_deb.tar.gz',
          sha256: '54a780b666fcda7510c2eebe85265b71dd209db280fc16882fca5589015ca505',
          format: 'deb-tar.gz',
          keepKey: 'linux',
          sofficeRelPath: 'program/soffice.bin',
          binaryDir: 'program',
        },
      },
      fonts24: ['LiberationSans-Regular.ttf', 'Carlito-Regular.ttf'],
      keep: {
        linux: [
          'LICENSE',
          'LICENSE.html',
          'NOTICE',
          'presets/config/autotbl.fmt',
          'program/soffice.bin',
          'program/libmergedlo.so',
          'program/libuno_sal.so.3',
          'share/fonts/truetype/LiberationSans-Regular.ttf',
          'share/fonts/truetype/Carlito-Regular.ttf',
          'share/registry/main.xcd',
        ],
      },
    }

    for (const rel of fakeManifest.keep.linux) {
      const full = join(srcRoot, rel)
      mkdirSync(dirname(full), { recursive: true })
      if (rel === 'program/soffice.bin') {
        writeFileSync(full, buildSyntheticElf64(['libmergedlo.so', 'libuno_sal.so.3', 'libc.so.6']))
      } else if (rel.endsWith('.so') || rel.endsWith('.so.3')) {
        writeFileSync(full, buildSyntheticElf64(['libc.so.6']))
      } else {
        writeFileSync(full, `content of ${rel}`)
      }
    }
    // Add unkept bloat files that must be stripped
    mkdirSync(join(srcRoot, 'help'), { recursive: true })
    writeFileSync(join(srcRoot, 'help/index.html'), 'bloat help')
    mkdirSync(join(srcRoot, 'share/extensions/dict-en'), { recursive: true })
    writeFileSync(join(srcRoot, 'share/extensions/dict-en/en.aff'), 'bloat dict')

    trimUnpackedTree({
      sourceRoot: srcRoot,
      destDir: dstRoot,
      target: 'linux-arm64',
      manifest: fakeManifest,
    })
    writeReadyMarker(dstRoot, 'linux-arm64', fakeManifest)

    expect(isPackValid(dstRoot, 'linux-arm64', fakeManifest)).toBe(true)
    expect(existsSync(join(dstRoot, 'help'))).toBe(false)
    expect(existsSync(join(dstRoot, 'share/extensions'))).toBe(false)
    expect(existsSync(join(dstRoot, 'program/soffice.bin'))).toBe(true)

    const xcu = readFileSync(
      join(dstRoot, 'template-profile/user/registrymodifications.xcu'),
      'utf8',
    )
    expect(xcu).toContain(
      '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>',
    )
    expect(xcu).toContain(
      '<prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>',
    )
    expect(xcu).toContain(fakeManifest.buildId)
    expect(readFileSync(join(dstRoot, 'template-profile/user/extensions/buildid'), 'utf8')).toBe(
      fakeManifest.buildId,
    )
  })

  it('fails the build when any kept file from the manifest is missing', () => {
    const root = makeTempDir('lo-trim-missing-')
    const srcRoot = join(root, 'unpacked')
    const dstRoot = join(root, 'trimmed')

    const fakeManifest = {
      version: '26.8.2.2',
      buildId: '9dea406ab7695df6325b11b0e19fdca8db4b7276',
      archives: {
        'linux-arm64': {
          url: 'https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.2.2/deb/aarch64/LibreOffice_26.8.2.2_Linux_aarch64_deb.tar.gz',
          sha256: '54a780b666fcda7510c2eebe85265b71dd209db280fc16882fca5589015ca505',
          format: 'deb-tar.gz',
          keepKey: 'linux',
          sofficeRelPath: 'program/soffice.bin',
          binaryDir: 'program',
        },
      },
      fonts24: [],
      keep: {
        linux: [
          'LICENSE',
          'LICENSE.html',
          'NOTICE',
          'presets/config/autotbl.fmt',
          'program/soffice.bin',
          'program/libmswordlo.so',
        ],
      },
    }

    // Create all except program/libmswordlo.so
    for (const rel of fakeManifest.keep.linux) {
      if (rel === 'program/libmswordlo.so') continue
      const full = join(srcRoot, rel)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, 'stub')
    }

    expect(() =>
      trimUnpackedTree({
        sourceRoot: srcRoot,
        destDir: dstRoot,
        target: 'linux-arm64',
        manifest: fakeManifest,
      }),
    ).toThrow(/Missing 1 kept file\(s\) for linux-arm64: program\/libmswordlo\.so/)
  })

  it('fails binary closure check when a required shared library is absent on Linux or macOS', () => {
    const root = makeTempDir('lo-closure-fail-')
    const linuxDir = join(root, 'linux')
    mkdirSync(join(linuxDir, 'program'), { recursive: true })
    // soffice.bin needs libicudata.so.78, which is absent from program/
    writeFileSync(
      join(linuxDir, 'program/soffice.bin'),
      buildSyntheticElf64(['libicudata.so.78', 'libc.so.6']),
    )

    expect(() => verifyBinaryClosure(linuxDir, 'linux-arm64')).toThrow(
      /Missing required shared libraries in linux-arm64 trimmed pack: soffice\.bin -> libicudata\.so\.78/,
    )

    const macDir = join(root, 'mac')
    mkdirSync(join(macDir, 'LibreOffice.app/Contents/MacOS'), { recursive: true })
    mkdirSync(join(macDir, 'LibreOffice.app/Contents/Frameworks'), { recursive: true })
    writeFileSync(
      join(macDir, 'LibreOffice.app/Contents/MacOS/soffice'),
      buildSyntheticMacho64(['@executable_path/../Frameworks/libmergedlo.dylib']),
    )

    expect(() => verifyBinaryClosure(macDir, 'darwin-arm64')).toThrow(
      /Missing required shared libraries in darwin-arm64 trimmed pack: soffice -> @executable_path\/\.\.\/Frameworks\/libmergedlo\.dylib/,
    )
  })

  it('creates the macOS urelibs -> ../Frameworks symlink and top-level legal copies', () => {
    const root = makeTempDir('lo-trim-mac-')
    const srcRoot = join(root, 'unpacked')
    const dstRoot = join(root, 'trimmed')

    const fakeManifest = {
      version: '26.8.2.2',
      buildId: '9dea406ab7695df6325b11b0e19fdca8db4b7276',
      archives: {
        'darwin-arm64': {
          url: 'https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.2.2/mac/aarch64/LibreOffice_26.8.2.2_MacOS_aarch64.dmg',
          sha256: '9f24fe83ab1ed5c95eb3df580119f32932f713e577feeac02bf619fb00749b55',
          format: 'dmg',
          keepKey: 'darwin',
          sofficeRelPath: 'LibreOffice.app/Contents/MacOS/soffice',
          binaryDir: 'LibreOffice.app/Contents/Frameworks',
        },
      },
      fonts24: ['Carlito-Regular.ttf'],
      keep: {
        darwin: [
          'LibreOffice.app/Contents/Resources/LICENSE',
          'LibreOffice.app/Contents/Resources/LICENSE.html',
          'LibreOffice.app/Contents/Resources/NOTICE',
          'LibreOffice.app/Contents/Resources/presets/config/autotbl.fmt',
          'LibreOffice.app/Contents/Resources/fonts/truetype/Carlito-Regular.ttf',
          'LibreOffice.app/Contents/MacOS/soffice',
          'LibreOffice.app/Contents/MacOS/urelibs',
          'LibreOffice.app/Contents/Frameworks/libmergedlo.dylib',
        ],
      },
    }

    for (const rel of fakeManifest.keep.darwin) {
      if (rel.endsWith('/urelibs')) continue
      const full = join(srcRoot, rel)
      mkdirSync(dirname(full), { recursive: true })
      if (rel.endsWith('/soffice')) {
        writeFileSync(
          full,
          buildSyntheticMacho64([
            '@executable_path/../Frameworks/libmergedlo.dylib',
            '/usr/lib/libSystem.B.dylib',
          ]),
        )
      } else if (rel.endsWith('.dylib')) {
        writeFileSync(full, buildSyntheticMacho64(['/usr/lib/libSystem.B.dylib']))
      } else {
        writeFileSync(full, `mac ${rel}`)
      }
    }

    trimUnpackedTree({
      sourceRoot: srcRoot,
      destDir: dstRoot,
      target: 'darwin-arm64',
      manifest: fakeManifest,
    })

    const urelibsPath = join(dstRoot, 'LibreOffice.app/Contents/MacOS/urelibs')
    expect(lstatSync(urelibsPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(urelibsPath)).toBe('../Frameworks')
    expect(existsSync(join(dstRoot, 'LICENSE'))).toBe(true)
    expect(existsSync(join(dstRoot, 'NOTICE'))).toBe(true)
    expect(manifestHash(fakeManifest)).toMatch(/^[0-9a-f]{16}$/)
  })
})
