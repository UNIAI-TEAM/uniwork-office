/**
 * Build-time fetch, SHA-256 verification, unpacking, KEEP-manifest trimming,
 * binary dependency closure verification, 24-font / legal-file verification,
 * and pre-initialised template-profile generation for the bundled LibreOffice
 * 26.8.2.2 converter pack.
 *
 * Output is cached per version + platform + arch under:
 *   apps/shell/build/.cache/libreoffice-<version>/<platform>-<arch>/libreoffice/
 * (the `--cache-dir` option only redirects this preparer CLI; packaging always reads the
 * default cache, so a custom root can never feed an installer).
 *
 * Usage:
 *   node apps/shell/build/prepare-libreoffice.cjs [--target <platform>-<arch>] [--all] [--cache-dir <dir>]
 */
'use strict'

const { execFileSync, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, dirname, join, resolve } = require('node:path')
const { pipeline } = require('node:stream/promises')

const MANIFEST_PATH = join(__dirname, 'libreoffice-manifest.json')
const DEFAULT_CACHE_ROOT = join(__dirname, '.cache')
const READY_MARKER = '.ready.json'

/** Linux system libraries provided by glibc / standard desktop environment */
const LINUX_SYSTEM_LIBS = new Set([
  'ld-linux-aarch64.so.1',
  'ld-linux-x86-64.so.2',
  'libICE.so.6',
  'libSM.so.6',
  'libX11-xcb.so.1',
  'libX11.so.6',
  'libXext.so.6',
  'libavahi-client.so.3',
  'libavahi-common.so.3',
  'libc.so.6',
  'libcairo.so.2',
  'libcups.so.2',
  'libdbus-1.so.3',
  'libdl.so.2',
  'libexpat.so.1',
  'libfontconfig.so.1',
  'libfreetype.so.6',
  'libgcc_s.so.1',
  'libgio-2.0.so.0',
  'libglib-2.0.so.0',
  'libgmodule-2.0.so.0',
  'libgobject-2.0.so.0',
  'libgssapi_krb5.so.2',
  'libm.so.6',
  'libnspr4.so',
  'libnss3.so',
  'libnssutil3.so',
  'libplc4.so',
  'libplds4.so',
  'libpthread.so.0',
  'libresolv.so.2',
  'librt.so.1',
  'libsmime3.so',
  'libssl3.so',
  'libstdc++.so.6',
  'libxcb.so.1',
  'libz.so.1',
])

/** Helper binaries in program/ that are never invoked in --headless conversion */
const LINUX_HELPER_SKIP = new Set(['lo_kde5filepicker', 'python.bin', 'opencltest'])

/** Windows OS / UCRT / VC++ system DLLs */
const WIN_SYSTEM_DLLS = new Set([
  'advapi32.dll',
  'bcrypt.dll',
  'comctl32.dll',
  'comdlg32.dll',
  'crypt32.dll',
  'd2d1.dll',
  'd3d11.dll',
  'd3d9.dll',
  'dbghelp.dll',
  'dnsapi.dll',
  'dwmapi.dll',
  'dwrite.dll',
  'dxgi.dll',
  'fontsub.dll',
  'gdi32.dll',
  'gdiplus.dll',
  'glu32.dll',
  'hid.dll',
  'httpapi.dll',
  'imm32.dll',
  'iphlpapi.dll',
  'kernel32.dll',
  'mfplat.dll',
  'mfplay.dll',
  'mfreadwrite.dll',
  'mpr.dll',
  'msimg32.dll',
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'msvcp140_atomic_wait.dll',
  'msvcp140_codecvt_ids.dll',
  'msvcrt.dll',
  'ncrypt.dll',
  'netapi32.dll',
  'normaliz.dll',
  'ntdll.dll',
  'ole32.dll',
  'oleacc.dll',
  'oleaut32.dll',
  'oledlg.dll',
  'opengl32.dll',
  'powrprof.dll',
  'MPR.dll'.toLowerCase(),
  'propsys.dll',
  'psapi.dll',
  'rpcrt4.dll',
  'secur32.dll',
  'setupapi.dll',
  'shell32.dll',
  'shfolder.dll',
  'shlwapi.dll',
  'urlmon.dll',
  'user32.dll',
  'userenv.dll',
  'usp10.dll',
  'uxtheme.dll',
  'vccorlib140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'vcruntime140_threads.dll',
  'version.dll',
  'wer.dll',
  'winhttp.dll',
  'wininet.dll',
  'winmm.dll',
  'winspool.drv',
  'wintrust.dll',
  'wldap32.dll',
  'ws2_32.dll',
  'wsock32.dll',
  'wtsapi32.dll',
])

function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

function manifestHash(manifest = loadManifest()) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16)
}

function getCacheRoot(customCacheRoot) {
  return resolve(customCacheRoot || DEFAULT_CACHE_ROOT)
}

function getTargetPackDir(target, { manifest = loadManifest(), cacheRoot } = {}) {
  if (!manifest.archives[target]) {
    throw new Error(`Unsupported LibreOffice target: "${target}"`)
  }
  return join(getCacheRoot(cacheRoot), `libreoffice-${manifest.version}`, target, 'libreoffice')
}

async function computeFileSha256(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolvePromise)
    stream.on('error', rejectPromise)
  })
  return hash.digest('hex')
}

function computeFileSha256Sync(filePath) {
  const hash = createHash('sha256')
  const fd = require('node:fs').openSync(filePath, 'r')
  const buf = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    while ((bytesRead = require('node:fs').readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead))
    }
  } finally {
    require('node:fs').closeSync(fd)
  }
  return hash.digest('hex')
}

function verifyArchiveChecksum(filePath, expectedSha256) {
  if (!existsSync(filePath)) {
    throw new Error(`Archive missing: ${filePath}`)
  }
  const actual = computeFileSha256Sync(filePath)
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `SHA-256 mismatch for ${basename(filePath)}: expected ${expectedSha256}, got ${actual}`,
    )
  }
  return actual
}

/**
 * Parse DT_NEEDED shared library names from a 64-bit ELF binary.
 */
function parseElfNeeded(buf) {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46 || buf[4] !== 2) return []
  const le = buf[5] === 1
  const u16 = (off) => (le ? buf.readUInt16LE(off) : buf.readUInt16BE(off))
  const u32 = (off) => (le ? buf.readUInt32LE(off) : buf.readUInt32BE(off))
  const u64 = (off) => Number(le ? buf.readBigUInt64LE(off) : buf.readBigUInt64BE(off))

  const shoff = u64(40)
  const shentsize = u16(58)
  const shnum = u16(60)
  if (!shoff || !shnum || shoff + shnum * shentsize > buf.length) return []

  const sections = []
  for (let i = 0; i < shnum; i++) {
    const base = shoff + i * shentsize
    sections.push({
      type: u32(base + 4),
      offset: u64(base + 24),
      size: u64(base + 32),
      link: u32(base + 40),
    })
  }

  const needed = []
  for (const sec of sections) {
    if (sec.type !== 6) continue // SHT_DYNAMIC
    const strSec = sections[sec.link]
    if (!strSec || strSec.offset + strSec.size > buf.length) continue
    const strtab = buf.subarray(strSec.offset, strSec.offset + strSec.size)
    const end = Math.min(sec.offset + sec.size, buf.length)
    for (let pos = sec.offset; pos + 16 <= end; pos += 16) {
      const tag = u64(pos)
      const val = u64(pos + 8)
      if (tag === 0) break
      if (tag === 1 && val < strtab.length) {
        const nul = strtab.indexOf(0, val)
        needed.push(strtab.subarray(val, nul === -1 ? strtab.length : nul).toString('utf8'))
      }
    }
  }
  return needed
}

/**
 * Parse LC_LOAD_DYLIB / LC_REEXPORT_DYLIB paths from a 64-bit Mach-O binary.
 */
function parseMachoNeeded(buf) {
  if (buf.length < 32) return []
  const magic = buf.readUInt32LE(0)
  if (magic !== 0xfeedfacf && magic !== 0xcffaedfe) return []
  const le = magic === 0xfeedfacf
  const u32 = (off) => (le ? buf.readUInt32LE(off) : buf.readUInt32BE(off))
  const ncmds = u32(16)
  let pos = 32
  const needed = []
  for (let i = 0; i < ncmds && pos + 8 <= buf.length; i++) {
    const cmd = u32(pos)
    const cmdsize = u32(pos + 4)
    if (cmdsize < 8 || pos + cmdsize > buf.length) break
    if (cmd === 0x0c || cmd === 0x18 || cmd === 0x8000001c || cmd === 0x8000001f) {
      const strOff = u32(pos + 8)
      if (strOff < cmdsize) {
        const start = pos + strOff
        const limit = pos + cmdsize
        const nul = buf.indexOf(0, start)
        const end = nul === -1 || nul > limit ? limit : nul
        needed.push(buf.subarray(start, end).toString('utf8'))
      }
    }
    pos += cmdsize
  }
  return needed
}

/**
 * Parse imported DLL names from a 32/64-bit PE binary.
 */
function parsePeNeeded(buf) {
  if (buf.length < 64 || buf[0] !== 0x4d || buf[1] !== 0x5a) return []
  const peOff = buf.readUInt32LE(0x3c)
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return []
  const numSec = buf.readUInt16LE(peOff + 6)
  const optSz = buf.readUInt16LE(peOff + 20)
  const optOff = peOff + 24
  if (optOff + optSz > buf.length) return []
  const magic = buf.readUInt16LE(optOff)
  const ddOff = optOff + (magic === 0x20b ? 112 : 96)
  if (ddOff + 16 > optOff + optSz) return []
  const impRva = buf.readUInt32LE(ddOff + 8)
  if (!impRva) return []

  const secOff = optOff + optSz
  const secs = []
  for (let i = 0; i < numSec && secOff + (i + 1) * 40 <= buf.length; i++) {
    const base = secOff + i * 40
    const vsz = buf.readUInt32LE(base + 8)
    const vrva = buf.readUInt32LE(base + 12)
    const rsz = buf.readUInt32LE(base + 16)
    const rptr = buf.readUInt32LE(base + 20)
    secs.push({ vrva, sz: Math.max(vsz, rsz), rptr })
  }
  const rvaToOff = (rva) => {
    for (const s of secs) {
      if (rva >= s.vrva && rva < s.vrva + s.sz) {
        return s.rptr + (rva - s.vrva)
      }
    }
    return null
  }

  let off = rvaToOff(impRva)
  if (off === null) return []
  const needed = []
  while (off + 20 <= buf.length) {
    const ilt = buf.readUInt32LE(off)
    const nameRva = buf.readUInt32LE(off + 12)
    const iat = buf.readUInt32LE(off + 16)
    if (ilt === 0 && nameRva === 0 && iat === 0) break
    const noff = rvaToOff(nameRva)
    if (noff !== null && noff < buf.length) {
      const nul = buf.indexOf(0, noff)
      needed.push(buf.subarray(noff, nul === -1 ? buf.length : nul).toString('utf8'))
    }
    off += 20
  }
  return needed
}

/**
 * Verify that all shared libraries required by kept binaries in the trimmed tree
 * are present (either in the trimmed bundle or in the OS system library allowlist).
 */
function verifyBinaryClosure(trimmedDir, target) {
  const missing = []
  if (target.startsWith('linux-')) {
    const progDir = join(trimmedDir, 'program')
    if (!existsSync(progDir)) {
      throw new Error(`Missing program directory in ${trimmedDir}`)
    }
    const present = new Set(readdirSync(progDir))
    for (const file of present) {
      if (LINUX_HELPER_SKIP.has(file)) continue
      const full = join(progDir, file)
      const st = lstatSync(full)
      if (!st.isFile() || st.isSymbolicLink()) continue
      const needed = parseElfNeeded(readFileSync(full))
      for (const lib of needed) {
        if (!present.has(lib) && !LINUX_SYSTEM_LIBS.has(lib)) {
          missing.push(`${file} -> ${lib}`)
        }
      }
    }
  } else if (target.startsWith('darwin-')) {
    const contentsDir = join(trimmedDir, 'LibreOffice.app', 'Contents')
    const fwDir = join(contentsDir, 'Frameworks')
    const macosDir = join(contentsDir, 'MacOS')
    if (!existsSync(fwDir) || !existsSync(macosDir)) {
      throw new Error(`Missing Contents/{Frameworks,MacOS} in ${trimmedDir}`)
    }
    const presentFw = new Set(readdirSync(fwDir))
    for (const dir of [macosDir, fwDir]) {
      for (const file of readdirSync(dir)) {
        const full = join(dir, file)
        const st = lstatSync(full)
        if (!st.isFile() || st.isSymbolicLink()) continue
        const needed = parseMachoNeeded(readFileSync(full))
        for (const dep of needed) {
          if (dep.startsWith('@')) {
            const libName = basename(dep)
            if (!presentFw.has(libName)) {
              missing.push(`${file} -> ${dep}`)
            }
          }
        }
      }
    }
  } else if (target.startsWith('win32-')) {
    const progDir = join(trimmedDir, 'program')
    if (!existsSync(progDir)) {
      throw new Error(`Missing program directory in ${trimmedDir}`)
    }
    const presentLower = new Set(readdirSync(progDir).map((f) => f.toLowerCase()))
    for (const file of readdirSync(progDir)) {
      const full = join(progDir, file)
      const st = lstatSync(full)
      if (!st.isFile() || st.isSymbolicLink()) continue
      const needed = parsePeNeeded(readFileSync(full))
      for (const dll of needed) {
        const lower = dll.toLowerCase()
        if (
          !presentLower.has(lower) &&
          !WIN_SYSTEM_DLLS.has(lower) &&
          !lower.startsWith('api-ms-win-')
        ) {
          missing.push(`${file} -> ${dll}`)
        }
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required shared libraries in ${target} trimmed pack: ${missing.join(', ')}`,
    )
  }
}

/**
 * Generate the pre-initialised UserInstallation template-profile inside
 * `<trimmedDir>/template-profile` (macro security Very High = 3, external links disabled,
 * ooSetupInstCompleted = true, matching buildid so first run never exits 81).
 */
function generateTemplateProfile(trimmedDir, target, manifest = loadManifest()) {
  const buildId = manifest.buildId
  const profDir = join(trimmedDir, 'template-profile')
  rmSync(profDir, { recursive: true, force: true })

  const autotblSrc = target.startsWith('darwin-')
    ? join(
        trimmedDir,
        'LibreOffice.app',
        'Contents',
        'Resources',
        'presets',
        'config',
        'autotbl.fmt',
      )
    : join(trimmedDir, 'presets', 'config', 'autotbl.fmt')
  if (!existsSync(autotblSrc)) {
    throw new Error(`Missing preset autotbl.fmt for template profile: ${autotblSrc}`)
  }

  const userConfigDir = join(profDir, 'user', 'config')
  mkdirSync(userConfigDir, { recursive: true })
  copyFileSync(autotblSrc, join(userConfigDir, 'autotbl.fmt'))

  const extRoot = join(profDir, 'user', 'extensions')
  mkdirSync(extRoot, { recursive: true })
  writeFileSync(join(extRoot, 'buildid'), buildId, 'utf8')

  for (const syncSub of ['bundled', 'shared']) {
    const dir = join(extRoot, syncSub)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'lastsynchronized'), '1', 'utf8')
  }

  const backendDirs = [
    join(extRoot, 'bundled'),
    join(extRoot, 'shared'),
    join(extRoot, 'tmp'),
    join(profDir, 'user', 'uno_packages', 'cache'),
  ]
  for (const base of backendDirs) {
    const confDir = join(
      base,
      'registry',
      'com.sun.star.comp.deployment.configuration.PackageRegistryBackend',
    )
    const helpDir = join(
      base,
      'registry',
      'com.sun.star.comp.deployment.help.PackageRegistryBackend',
    )
    mkdirSync(confDir, { recursive: true })
    mkdirSync(helpDir, { recursive: true })
    writeFileSync(
      join(confDir, 'backenddb.xml'),
      '<?xml version="1.0"?>\n<conf:configuration-backend-db xmlns:conf="http://openoffice.org/extensionmanager/configuration-registry/2010"/>\n',
      'utf8',
    )
    writeFileSync(
      join(helpDir, 'backenddb.xml'),
      '<?xml version="1.0"?>\n<help:help-backend-db xmlns:help="http://openoffice.org/extensionmanager/help-registry/2010"/>\n',
      'utf8',
    )
  }

  const xcu = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseSystemFileDialog" oor:op="fuse"><value>false</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Logging/Settings"><node oor:name="unopkg" oor:op="replace"><prop oor:name="LogLevel" oor:op="fuse"><value>2147483647</value></prop><prop oor:name="DefaultHandler" oor:op="fuse"><value>com.sun.star.logging.FileHandler</value></prop><node oor:name="HandlerSettings"><prop oor:name="FileURL" oor:op="fuse"><value>$(userurl)/$(loggername).log</value></prop></node><prop oor:name="DefaultFormatter" oor:op="fuse"><value>com.sun.star.logging.PlainTextFormatter</value></prop><node oor:name="FormatterSettings"></node></node></item>',
    '<item oor:path="/org.openoffice.Setup/L10N"><prop oor:name="ooLocale" oor:op="fuse"><value>en-US</value></prop></item>',
    `<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="LastCompatibilityCheckID" oor:op="fuse"><value>${buildId}</value></prop></item>`,
    '<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="OfficeRestartInProgress" oor:op="fuse"><value>false</value></prop></item>',
    '<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="ooSetupInstCompleted" oor:op="fuse"><value>true</value></prop></item>',
    '</oor:items>',
    '',
  ].join('\n')
  writeFileSync(join(profDir, 'user', 'registrymodifications.xcu'), xcu, 'utf8')
}

/**
 * Trim an unpacked raw installation root into `destDir` using the platform's
 * checked-in KEEP manifest, normalize legal files, verify the 24-font set and
 * binary dependency closure, and generate `template-profile/`.
 */
function trimUnpackedTree({
  sourceRoot,
  destDir,
  target,
  manifest = loadManifest(),
  skipBinaryClosure = false,
}) {
  const archiveMeta = manifest.archives[target]
  if (!archiveMeta) {
    throw new Error(`Unknown target "${target}"`)
  }
  const keepList = manifest.keep[archiveMeta.keepKey]
  if (!Array.isArray(keepList) || keepList.length === 0) {
    throw new Error(`Empty keep manifest for "${archiveMeta.keepKey}"`)
  }

  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })

  const missingFiles = []
  for (const relPath of keepList) {
    const srcPath = join(sourceRoot, relPath)
    const dstPath = join(destDir, relPath)
    // Special case on macOS: Contents/MacOS/urelibs -> ../Frameworks symlink
    if (relPath === 'LibreOffice.app/Contents/MacOS/urelibs' && !existsSync(srcPath)) {
      mkdirSync(dirname(dstPath), { recursive: true })
      symlinkSync('../Frameworks', dstPath)
      continue
    }
    let st = null
    try {
      st = lstatSync(srcPath)
    } catch {
      st = null
    }
    if (!st) {
      missingFiles.push(relPath)
      continue
    }
    mkdirSync(dirname(dstPath), { recursive: true })
    if (st.isSymbolicLink()) {
      const linkTarget = readlinkSync(srcPath)
      symlinkSync(linkTarget, dstPath)
    } else if (st.isFile()) {
      copyFileSync(srcPath, dstPath)
      chmodSync(dstPath, st.mode)
    } else {
      missingFiles.push(relPath)
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(
      `Missing ${missingFiles.length} kept file(s) for ${target}: ${missingFiles.slice(0, 10).join(', ')}`,
    )
  }

  // Ensure uniform LICENSE / LICENSE.html / NOTICE at the top of destDir (and in Contents/Resources on mac)
  if (target.startsWith('win32-')) {
    const licTxt = join(destDir, 'license.txt')
    const licUpper = join(destDir, 'LICENSE')
    if (existsSync(licTxt) && !existsSync(licUpper)) {
      copyFileSync(licTxt, licUpper)
    }
  } else if (target.startsWith('darwin-')) {
    const macRes = join(destDir, 'LibreOffice.app', 'Contents', 'Resources')
    for (const legalFile of ['LICENSE', 'LICENSE.html', 'NOTICE']) {
      const srcLegal = join(macRes, legalFile)
      const topLegal = join(destDir, legalFile)
      if (existsSync(srcLegal) && !existsSync(topLegal)) {
        copyFileSync(srcLegal, topLegal)
      }
    }
  }

  for (const legalFile of ['LICENSE', 'LICENSE.html', 'NOTICE']) {
    if (!existsSync(join(destDir, legalFile))) {
      throw new Error(`Missing required legal file ${legalFile} in ${destDir}`)
    }
  }

  // Verify the 24-font metric-compatible core set
  const fontDir = target.startsWith('darwin-')
    ? join(destDir, 'LibreOffice.app', 'Contents', 'Resources', 'fonts', 'truetype')
    : join(destDir, 'share', 'fonts', 'truetype')
  const missingFonts = (manifest.fonts24 || []).filter((f) => !existsSync(join(fontDir, f)))
  if (missingFonts.length > 0) {
    throw new Error(`Missing required font(s) in ${target}: ${missingFonts.join(', ')}`)
  }

  // Verify soffice entrypoint exists
  const sofficePath = join(destDir, archiveMeta.sofficeRelPath)
  if (!existsSync(sofficePath)) {
    throw new Error(`Missing soffice entrypoint in ${target}: ${archiveMeta.sofficeRelPath}`)
  }

  if (!skipBinaryClosure) {
    verifyBinaryClosure(destDir, target)
  }

  generateTemplateProfile(destDir, target, manifest)
}

/**
 * Validate an existing cached pack directory. Returns true if valid.
 */
function isPackValid(packDir, target, manifest = loadManifest()) {
  try {
    const markerPath = join(packDir, READY_MARKER)
    if (!existsSync(markerPath)) return false
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (
      marker.version !== manifest.version ||
      marker.target !== target ||
      marker.manifestHash !== manifestHash(manifest)
    ) {
      return false
    }
    const archiveMeta = manifest.archives[target]
    const keepList = manifest.keep[archiveMeta.keepKey]
    for (const rel of keepList) {
      const p = join(packDir, rel)
      try {
        lstatSync(p)
      } catch {
        return false
      }
    }
    for (const legalFile of ['LICENSE', 'LICENSE.html', 'NOTICE']) {
      if (!existsSync(join(packDir, legalFile))) return false
    }
    if (
      !existsSync(join(packDir, 'template-profile', 'user', 'registrymodifications.xcu')) ||
      !existsSync(join(packDir, 'template-profile', 'user', 'extensions', 'buildid'))
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function writeReadyMarker(packDir, target, manifest = loadManifest()) {
  writeFileSync(
    join(packDir, READY_MARKER),
    `${JSON.stringify(
      {
        version: manifest.version,
        target,
        manifestHash: manifestHash(manifest),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

async function downloadFile(url, destPath) {
  mkdirSync(dirname(destPath), { recursive: true })
  const tmpPath = `${destPath}.part-${process.pid}`
  rmSync(tmpPath, { force: true })
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`)
  }
  await pipeline(res.body, createWriteStream(tmpPath))
  renameSync(tmpPath, destPath)
}

function findTool(candidates, extraPaths = []) {
  const pathDirs = [
    ...extraPaths,
    ...(process.env.PATH ? process.env.PATH.split(process.platform === 'win32' ? ';' : ':') : []),
  ]
  for (const name of candidates) {
    if (name.includes('/') || name.includes('\\')) {
      if (existsSync(name)) return name
      continue
    }
    for (const dir of pathDirs) {
      const full = join(dir, process.platform === 'win32' && !name.endsWith('.exe') ? `${name}.exe` : name)
      if (existsSync(full)) return full
      if (process.platform === 'win32' && existsSync(join(dir, name))) return join(dir, name)
    }
  }
  return null
}

function scratchToolsEnv() {
  const home = process.env.HOME || ''
  const scratchRoot = join(home, 'scratch', 'legacy-formats', 'trim', 'tools', 'root')
  if (!existsSync(scratchRoot)) return { extraBins: [], env: process.env }
  const libDirs = [
    join(scratchRoot, 'usr', 'lib', 'aarch64-linux-gnu'),
    join(scratchRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
    join(scratchRoot, 'usr', 'lib'),
  ].filter(existsSync)
  const ldPath = [
    ...libDirs,
    ...(process.env.LD_LIBRARY_PATH ? [process.env.LD_LIBRARY_PATH] : []),
  ].join(':')
  return {
    extraBins: [join(scratchRoot, 'usr', 'bin')],
    env: { ...process.env, LD_LIBRARY_PATH: ldPath },
  }
}

function unpackDebTarGz(archivePath, workDir) {
  const tarDir = join(workDir, 'tar')
  const rootDir = join(workDir, 'root')
  mkdirSync(tarDir, { recursive: true })
  mkdirSync(rootDir, { recursive: true })
  execFileSync('tar', ['-xzf', archivePath, '-C', tarDir], { stdio: 'inherit' })

  const topEntries = readdirSync(tarDir)
  let debsDir = null
  for (const entry of topEntries) {
    const candidate = join(tarDir, entry, 'DEBS')
    if (existsSync(candidate)) {
      debsDir = candidate
      break
    }
  }
  if (!debsDir) {
    throw new Error(`No DEBS directory found after unpacking ${archivePath}`)
  }

  for (const deb of readdirSync(debsDir).filter((f) => f.endsWith('.deb')).sort()) {
    execFileSync('dpkg-deb', ['-x', join(debsDir, deb), rootDir], { stdio: 'inherit' })
  }

  const optDir = join(rootDir, 'opt')
  const loDirName = existsSync(optDir)
    ? readdirSync(optDir).find((d) => d.startsWith('libreoffice'))
    : null
  if (!loDirName) {
    throw new Error(`No opt/libreoffice* directory found after extracting .deb packages`)
  }
  const sourceRoot = join(optDir, loDirName)
  const monoFallback = join(__dirname, '../../docs/src/renderer/fonts/LiberationMono-Regular.ttf')
  const monoDest = join(sourceRoot, 'share/fonts/truetype/LiberationMono-Regular.ttf')
  if (!existsSync(monoDest) && existsSync(monoFallback)) {
    mkdirSync(dirname(monoDest), { recursive: true })
    copyFileSync(monoFallback, monoDest)
  }
  return sourceRoot
}

function unpackDmg(archivePath, workDir) {
  const outRoot = join(workDir, 'dmg-root')
  mkdirSync(outRoot, { recursive: true })

  if (process.platform === 'darwin') {
    const mountPoint = join(workDir, 'mnt')
    mkdirSync(mountPoint, { recursive: true })
    execFileSync(
      'hdiutil',
      ['attach', archivePath, '-mountpoint', mountPoint, '-nobrowse', '-readonly', '-quiet'],
      { stdio: 'inherit' },
    )
    try {
      const appSrc = join(mountPoint, 'LibreOffice.app')
      if (!existsSync(appSrc)) {
        throw new Error(`LibreOffice.app not found in mounted DMG ${archivePath}`)
      }
      execFileSync('cp', ['-R', appSrc, join(outRoot, 'LibreOffice.app')], { stdio: 'inherit' })
    } finally {
      spawnSync('hdiutil', ['detach', mountPoint, '-force', '-quiet'], { stdio: 'ignore' })
    }
  } else {
    const { extraBins, env } = scratchToolsEnv()
    const sevenZ = findTool(['7z', '7zz', '7za'], extraBins)
    if (!sevenZ) {
      throw new Error(`7z is required to unpack macOS .dmg on ${process.platform}`)
    }
    // 7z exits with code 2 when ignoring the Applications -> /Applications symlink in TDF DMGs
    spawnSync(sevenZ, ['x', '-y', `-o${outRoot}`, archivePath], { stdio: 'inherit', env })
    const findApp = (dir, depth = 0) => {
      if (depth > 3 || !existsSync(dir)) return null
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (entry === 'LibreOffice.app' && statSync(full).isDirectory()) return full
        try {
          if (lstatSync(full).isDirectory()) {
            const found = findApp(full, depth + 1)
            if (found) return found
          }
        } catch {
          // ignore broken symlinks
        }
      }
      return null
    }
    const foundApp = findApp(outRoot)
    if (!foundApp) {
      throw new Error(`LibreOffice.app not found after 7z extraction of ${archivePath}`)
    }
    const topApp = join(outRoot, 'LibreOffice.app')
    if (foundApp !== topApp) {
      renameSync(foundApp, topApp)
    }
  }

  const monoFallback = join(__dirname, '../../docs/src/renderer/fonts/LiberationMono-Regular.ttf')
  const monoDest = join(
    outRoot,
    'LibreOffice.app/Contents/Resources/fonts/truetype/LiberationMono-Regular.ttf',
  )
  if (!existsSync(monoDest) && existsSync(monoFallback)) {
    mkdirSync(dirname(monoDest), { recursive: true })
    copyFileSync(monoFallback, monoDest)
  }
  return outRoot
}

function unpackMsi(archivePath, workDir) {
  const outRoot = join(workDir, 'msi-root')
  mkdirSync(outRoot, { recursive: true })

  if (process.platform === 'win32') {
    const winMsi = archivePath.replace(/\//g, '\\')
    const winOut = outRoot.replace(/\//g, '\\')
    execFileSync('msiexec.exe', ['/a', winMsi, '/qn', `TARGETDIR=${winOut}`], {
      stdio: 'inherit',
    })
  } else {
    const { extraBins, env } = scratchToolsEnv()
    const msiextract = findTool(['msiextract'], extraBins)
    if (!msiextract) {
      throw new Error(`msiextract (msitools) is required to unpack .msi on ${process.platform}`)
    }
    execFileSync(msiextract, ['-C', outRoot, archivePath], { stdio: 'inherit', env })
  }

  // Locate the LibreOffice root directory (msiexec puts it under LibreOffice/ or Program Files/LibreOffice/;
  // msiextract names it "LibreOffice:." or "LibreOffice")
  const candidates = [
    join(outRoot, 'LibreOffice:.'),
    join(outRoot, 'LibreOffice'),
    join(outRoot, 'PFiles', 'LibreOffice'),
    join(outRoot, 'Program Files', 'LibreOffice'),
  ]
  const loRoot = candidates.find((c) => existsSync(join(c, 'program', 'soffice.exe'))) || outRoot
  if (!existsSync(join(loRoot, 'program', 'soffice.exe'))) {
    throw new Error(`program/soffice.exe not found after unpacking ${archivePath}`)
  }

  // Merge Windows MSI top-level Fonts/ directory into share/fonts/truetype/
  const topFonts = join(outRoot, 'Fonts')
  const destFonts = join(loRoot, 'share', 'fonts', 'truetype')
  if (existsSync(topFonts)) {
    mkdirSync(destFonts, { recursive: true })
    for (const f of readdirSync(topFonts)) {
      const srcF = join(topFonts, f)
      const dstF = join(destFonts, f)
      if (!existsSync(dstF) && statSync(srcF).isFile()) {
        copyFileSync(srcF, dstF)
      }
    }
  }

  const monoFallback = join(__dirname, '../../docs/src/renderer/fonts/LiberationMono-Regular.ttf')
  const monoDest = join(destFonts, 'LiberationMono-Regular.ttf')
  if (!existsSync(monoDest) && existsSync(monoFallback)) {
    mkdirSync(destFonts, { recursive: true })
    copyFileSync(monoFallback, monoDest)
  }

  return loRoot
}

/**
 * Ensure the trimmed LibreOffice converter pack for `target` (`<platform>-<arch>`)
 * is built and verified in the cache directory. Reuses the cached directory when valid.
 */
async function ensureLibreOfficePack(target, { manifest = loadManifest(), cacheRoot } = {}) {
  const archiveMeta = manifest.archives[target]
  if (!archiveMeta) {
    throw new Error(`Unsupported LibreOffice target: "${target}"`)
  }
  const packDir = getTargetPackDir(target, { manifest, cacheRoot })
  if (isPackValid(packDir, target, manifest)) {
    return packDir
  }

  const stageDir = `${packDir}.tmp-${process.pid}`
  rmSync(stageDir, { recursive: true, force: true })

  const downloadsDir = join(getCacheRoot(cacheRoot), 'downloads')
  const archiveFileName = basename(new URL(archiveMeta.url).pathname)
  const archivePath = join(downloadsDir, archiveFileName)

  if (existsSync(archivePath)) {
    try {
      verifyArchiveChecksum(archivePath, archiveMeta.sha256)
    } catch {
      rmSync(archivePath, { force: true })
    }
  }
  if (!existsSync(archivePath)) {
    console.log(`Downloading ${archiveMeta.url} ...`)
    await downloadFile(archiveMeta.url, archivePath)
  }
  verifyArchiveChecksum(archivePath, archiveMeta.sha256)

  const workDir = mkdtempSync(join(tmpdir(), `lo-unpack-${target}-`))
  try {
    let sourceRoot
    if (archiveMeta.format === 'deb-tar.gz') {
      sourceRoot = unpackDebTarGz(archivePath, workDir)
    } else if (archiveMeta.format === 'dmg') {
      sourceRoot = unpackDmg(archivePath, workDir)
    } else if (archiveMeta.format === 'msi') {
      sourceRoot = unpackMsi(archivePath, workDir)
    } else {
      throw new Error(`Unsupported archive format: ${archiveMeta.format}`)
    }

    trimUnpackedTree({
      sourceRoot,
      destDir: stageDir,
      target,
      manifest,
    })
    writeReadyMarker(stageDir, target, manifest)
    rmSync(packDir, { recursive: true, force: true })
    mkdirSync(dirname(packDir), { recursive: true })
    renameSync(stageDir, packDir)
    return packDir
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    rmSync(stageDir, { recursive: true, force: true })
  }
}

async function main(argv) {
  let targets = []
  let cacheRoot = undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target' && argv[i + 1]) {
      targets.push(argv[++i])
    } else if (arg === '--all') {
      targets = Object.keys(loadManifest().archives)
    } else if (arg === '--cache-dir' && argv[i + 1]) {
      cacheRoot = argv[++i]
    } else if (arg === '--print-hash') {
      process.stdout.write(`${manifestHash()}\n`)
      return
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (targets.length === 0) {
    targets = [`${process.platform}-${process.arch}`]
  }
  for (const target of targets) {
    const out = await ensureLibreOfficePack(target, { cacheRoot })
    console.log(`Prepared LibreOffice ${target}: ${out}`)
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = {
  MANIFEST_PATH,
  READY_MARKER,
  loadManifest,
  manifestHash,
  getCacheRoot,
  getTargetPackDir,
  computeFileSha256,
  computeFileSha256Sync,
  verifyArchiveChecksum,
  parseElfNeeded,
  parseMachoNeeded,
  parsePeNeeded,
  verifyBinaryClosure,
  generateTemplateProfile,
  trimUnpackedTree,
  isPackValid,
  writeReadyMarker,
  ensureLibreOfficePack,
}
