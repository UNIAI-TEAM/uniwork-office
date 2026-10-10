#!/usr/bin/env node
// Brand gate on packaged output: what a user sees after installing a release
// build must say UniWork, never the upstream product or company name, and the
// build must carry no update feed. Runs on an electron-builder output directory
// (BUILD_DIR) after packaging:
//
//   node tools/release/check-build-brand.mjs --dir apps/shell/release
//     [--expect win-unpacked | --expect mac-arm64,mac | --expect linux-unpacked] [--json]
//
// The unpacked app directories are required, never optional: the ones named
// with --expect, and the ones the installers imply (a Windows setup .exe needs
// win-unpacked, an arm64 dmg mac-arm64, an x64 dmg mac, an x64 deb / AppImage
// linux-unpacked). A missing one is a problem, so a wrong --dir cannot pass on
// file names alone.
//
// Checked, when present in the directory:
//   - every top-level artifact file name (installers, dmg / zip, blockmaps)
//   - Windows: the version resource of each installer exe and of the app exe
//     in win-unpacked (ProductName, FileDescription, CompanyName,
//     LegalCopyright, OriginalFilename, ...), and the file names next to it
//   - macOS: Info.plist of each .app (bundle id must be com.uniwork.office;
//     CFBundleName, CFBundleDisplayName, CFBundleExecutable, document type
//     names) and the helper app names under Contents/Frameworks
//   - Linux: the file names in linux-unpacked (the executable must be
//     uniwork-office); for each .deb (needs dpkg-deb) the control fields
//     (Package must be uniwork-office), the desktop entry and icon file
//     names, and the desktop entry's MimeType must route the uniwork,
//     uniwork-office and uniwork-office-dev URL schemes (the sign-in callback)
//   - the packaged package.json inside app.asar (productName, author,
//     homepage, description)
//   - no app-update.yml in the app resources and no latest*.yml next to the
//     installers (auto-update stays off)
// The uninstall entry, shortcuts and file-association names come from the
// packaging config, which apps/shell/tests/release-config.test.ts asserts.
// Exit code 1 on any problem or when the directory holds nothing to check.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The upstream product and company names, in any case or separator style. */
export const BRAND = /gen[\s._-]?office|gen[\s._-]?spark/i
export const EXPECTED_BUNDLE_ID = 'com.uniwork.office'
export const EXPECTED_PRODUCT_NAME = 'UniWork Office'
export const EXPECTED_LINUX_NAME = 'uniwork-office'
export const LINUX_URL_SCHEMES = ['uniwork', 'uniwork-office', 'uniwork-office-dev']

const UNPACKED_DIR = /^(?:win|mac|linux)(?:-[a-z0-9]+)?(?:-unpacked)?$/
const VERSION_INFO_KEYS = [
  'ProductName',
  'FileDescription',
  'CompanyName',
  'LegalCopyright',
  'OriginalFilename',
]

// ---------------------------------------------------------------------------
// Windows version resource (VS_VERSIONINFO), read straight from the PE bytes.
// Layout of every node: wLength, wValueLength, wType (u16 each), a NUL-ended
// UTF-16LE key, padding to 32 bits, the value, padding, then child nodes.
// Offsets are aligned relative to the VS_VERSIONINFO start, which a resource
// section keeps 32-bit aligned.

const FIXED_FILE_INFO_SIGNATURE = 0xfeef04bd

function readNode(buf, offset, base) {
  if (offset + 6 > buf.length) return null
  const length = buf.readUInt16LE(offset)
  const valueLength = buf.readUInt16LE(offset + 2)
  const type = buf.readUInt16LE(offset + 4)
  if (length < 6 || offset + length > buf.length) return null
  let keyEnd = offset + 6
  while (keyEnd + 1 < offset + length && buf.readUInt16LE(keyEnd) !== 0) keyEnd += 2
  const key = buf.toString('utf16le', offset + 6, keyEnd)
  const align = (at) => base + ((at - base + 3) & ~3)
  const valueOffset = align(keyEnd + 2)
  // text values (wType 1) count UTF-16 code units, binary ones bytes
  const valueBytes = type === 1 ? valueLength * 2 : valueLength
  return {
    key,
    type,
    valueOffset,
    valueBytes,
    childrenOffset: align(valueOffset + valueBytes),
    end: offset + length,
  }
}

function children(buf, node, base) {
  const out = []
  let at = node.childrenOffset
  while (at < node.end) {
    const child = readNode(buf, at, base)
    if (!child || child.end > node.end) break
    out.push(child)
    at = base + ((child.end - base + 3) & ~3)
  }
  return out
}

function parseVersionInfoAt(buf, start) {
  const root = readNode(buf, start, start)
  if (!root || root.key !== 'VS_VERSION_INFO') return null
  if (root.valueBytes !== 52) return null
  if (buf.readUInt32LE(root.valueOffset) !== FIXED_FILE_INFO_SIGNATURE) return null
  const strings = {}
  for (const block of children(buf, root, start)) {
    if (block.key !== 'StringFileInfo') continue
    for (const table of children(buf, block, start)) {
      for (const entry of children(buf, table, start)) {
        const value = buf
          .toString('utf16le', entry.valueOffset, entry.valueOffset + entry.valueBytes)
          .replace(/\0+$/, '')
        if (!(entry.key in strings)) strings[entry.key] = value
      }
    }
  }
  return strings
}

/** The StringFileInfo entries of the first valid VS_VERSIONINFO in a PE file, or null. */
export function parseVersionInfo(buf) {
  const marker = Buffer.from('VS_VERSION_INFO\0', 'utf16le')
  for (let at = buf.indexOf(marker); at !== -1; at = buf.indexOf(marker, at + 2)) {
    if (at < 6) continue
    const strings = parseVersionInfoAt(buf, at - 6)
    if (strings) return strings
  }
  return null
}

// ---------------------------------------------------------------------------
// Property lists: a small XML plist reader (electron-builder writes XML).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeText = (text) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, name) => {
    if (name[0] === '#') {
      return String.fromCodePoint(
        name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10),
      )
    }
    return ENTITIES[name] ?? m
  })

/** Parses an XML property list into plain JS values (dict, array, string, numbers, booleans). */
export function parsePlist(xml) {
  // element tags (attributes ignored) and text; <?xml?> / <!DOCTYPE> / comments dropped
  const tokens = [...xml.matchAll(/<(\/?)([A-Za-z]+)[^>]*?(\/?)>|<[?!][^>]*>|([^<]+)/g)].filter(
    (token) => token[2] !== undefined || token[4] !== undefined,
  )
  let index = 0
  const next = () => tokens[index++]
  const skipText = () => {
    while (index < tokens.length && tokens[index][4] !== undefined && !tokens[index][4].trim()) {
      index += 1
    }
  }
  const textUntil = (tag) => {
    let text = ''
    for (let token = next(); token; token = next()) {
      if (token[1] === '/' && token[2] === tag) return decodeText(text)
      text += token[4] ?? ''
    }
    throw new Error(`unterminated <${tag}>`)
  }
  const value = () => {
    skipText()
    const token = next()
    if (!token || token[4] !== undefined) throw new Error('plist value expected')
    const [, closing, tag, selfClosing] = token
    if (closing) throw new Error(`unexpected </${tag}>`)
    if (selfClosing) {
      if (tag === 'true') return true
      if (tag === 'false') return false
      if (tag === 'dict') return {}
      if (tag === 'array') return []
      return ''
    }
    if (tag === 'dict') {
      const dict = {}
      for (;;) {
        skipText()
        const head = next()
        if (!head) throw new Error('unterminated <dict>')
        if (head[1] === '/' && head[2] === 'dict') return dict
        if (head[2] !== 'key') throw new Error(`<key> expected in <dict>, got <${head[2]}>`)
        const key = textUntil('key')
        dict[key] = value()
      }
    }
    if (tag === 'array') {
      const list = []
      for (;;) {
        skipText()
        if (tokens[index]?.[1] === '/' && tokens[index][2] === 'array') {
          index += 1
          return list
        }
        list.push(value())
      }
    }
    const text = textUntil(tag)
    if (tag === 'integer' || tag === 'real') return Number(text)
    return text
  }
  while (index < tokens.length && tokens[index][2] !== 'plist') index += 1
  if (index >= tokens.length) throw new Error('no <plist> element')
  index += 1
  return value()
}

function readPlistFile(path) {
  const raw = readFileSync(path)
  if (raw.subarray(0, 6).toString('latin1') === 'bplist') {
    if (process.platform !== 'darwin') throw new Error(`${path} is a binary plist (needs plutil)`)
    return parsePlist(
      execFileSync('plutil', ['-convert', 'xml1', '-o', '-', path], { encoding: 'utf8' }),
    )
  }
  return parsePlist(raw.toString('utf8'))
}

// ---------------------------------------------------------------------------
// Checks

/** Returns the brand problem for one value, or null. */
function brandProblem(where, value) {
  if (value === undefined || value === null) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const hit = BRAND.exec(text)
  return hit ? `${where}: "${text}" names ${hit[0]}` : null
}

function loadAsar() {
  const require = createRequire(import.meta.url)
  return require('@electron/asar')
}

/** Packaged package.json fields a user can see (About, uninstall entry, deb/rpm metadata). */
export function checkPackageJson(where, pkg, report) {
  for (const field of ['productName', 'author', 'homepage', 'description']) {
    report.problem(brandProblem(`${where} ${field}`, pkg[field]))
  }
  if (pkg.productName !== EXPECTED_PRODUCT_NAME) {
    report.problem(
      `${where} productName is "${pkg.productName}", expected "${EXPECTED_PRODUCT_NAME}"`,
    )
  }
}

function checkAsar(where, asarPath, report) {
  if (!existsSync(asarPath)) {
    report.problem(`${where}: no app.asar`)
    return
  }
  const pkg = JSON.parse(loadAsar().extractFile(asarPath, 'package.json').toString('utf8'))
  report.checked(`${where} package.json`)
  checkPackageJson(`${where} package.json`, pkg, report)
}

function checkNoUpdateFeed(where, resourcesDir, report) {
  if (existsSync(join(resourcesDir, 'app-update.yml'))) {
    report.problem(`${where}: resources hold app-update.yml (auto-update must stay off)`)
  }
}

export function checkVersionInfo(where, strings, report, { requireKeys = false } = {}) {
  if (!strings) {
    report.problem(`${where}: no readable version resource`)
    return
  }
  report.checked(`${where} version info`)
  for (const [key, value] of Object.entries(strings)) {
    report.problem(brandProblem(`${where} ${key}`, value))
  }
  if (requireKeys) {
    for (const key of ['ProductName', 'FileDescription']) {
      if (!strings[key]) report.problem(`${where}: version info has no ${key}`)
    }
  }
}

function checkWindowsUnpacked(dir, report) {
  const where = basename(dir)
  for (const name of readdirSync(dir)) report.problem(brandProblem(`${where} file name`, name))
  const appExe = join(dir, `${EXPECTED_PRODUCT_NAME}.exe`)
  if (!existsSync(appExe)) {
    report.problem(`${where}: no "${EXPECTED_PRODUCT_NAME}.exe"`)
  } else {
    checkVersionInfo(
      `${where}/${basename(appExe)}`,
      parseVersionInfo(readFileSync(appExe)),
      report,
      {
        requireKeys: true,
      },
    )
  }
  checkAsar(where, join(dir, 'resources', 'app.asar'), report)
  checkNoUpdateFeed(where, join(dir, 'resources'), report)
}

/** Brand / identity problems in a parsed mac Info.plist. */
export function checkInfoPlist(where, plist, report) {
  report.checked(`${where} Info.plist`)
  if (plist.CFBundleIdentifier !== EXPECTED_BUNDLE_ID) {
    report.problem(
      `${where} CFBundleIdentifier is "${plist.CFBundleIdentifier}", expected "${EXPECTED_BUNDLE_ID}"`,
    )
  }
  for (const key of [
    'CFBundleIdentifier',
    'CFBundleName',
    'CFBundleDisplayName',
    'CFBundleExecutable',
  ]) {
    report.problem(brandProblem(`${where} ${key}`, plist[key]))
  }
  for (const type of plist.CFBundleDocumentTypes ?? []) {
    report.problem(brandProblem(`${where} CFBundleDocumentTypes name`, type.CFBundleTypeName))
  }
}

function checkMacApp(appDir, report) {
  const where = basename(appDir)
  report.problem(brandProblem('app bundle name', where))
  checkInfoPlist(where, readPlistFile(join(appDir, 'Contents', 'Info.plist')), report)
  const frameworks = join(appDir, 'Contents', 'Frameworks')
  if (existsSync(frameworks)) {
    for (const name of readdirSync(frameworks)) {
      report.problem(brandProblem(`${where} helper`, name))
    }
  }
  const resources = join(appDir, 'Contents', 'Resources')
  checkAsar(where, join(resources, 'app.asar'), report)
  checkNoUpdateFeed(where, resources, report)
}

function checkLinuxUnpacked(dir, report) {
  const where = basename(dir)
  for (const name of readdirSync(dir)) report.problem(brandProblem(`${where} file name`, name))
  if (!existsSync(join(dir, EXPECTED_LINUX_NAME))) {
    report.problem(`${where}: no "${EXPECTED_LINUX_NAME}" executable`)
  }
  checkAsar(where, join(dir, 'resources', 'app.asar'), report)
  checkNoUpdateFeed(where, join(dir, 'resources'), report)
}

/** Parses `dpkg-deb -f` output (RFC 822 style, continuation lines folded in). */
export function parseControl(text) {
  const fields = {}
  let last = null
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) && last) {
      fields[last] += `\n${line.trim()}`
      continue
    }
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line)
    if (match) {
      last = match[1]
      fields[last] = match[2]
    }
  }
  return fields
}

/** Brand / identity problems in a deb's control fields. */
export function checkDebControl(where, fields, report) {
  report.checked(`${where} control`)
  if (fields.Package !== EXPECTED_LINUX_NAME) {
    report.problem(`${where} Package is "${fields.Package}", expected "${EXPECTED_LINUX_NAME}"`)
  }
  for (const key of ['Package', 'Maintainer', 'Vendor', 'Homepage', 'Description']) {
    report.problem(brandProblem(`${where} ${key}`, fields[key]))
  }
}

/** Parses the [Desktop Entry] group of a .desktop file. */
export function parseDesktopEntry(text) {
  const entry = {}
  let inMain = false
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/^\[.*\]$/.test(trimmed)) {
      inMain = trimmed === '[Desktop Entry]'
      continue
    }
    const at = line.indexOf('=')
    if (inMain && at > 0) entry[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return entry
}

/** Brand problems in a desktop entry, and the URL schemes it must route. */
export function checkDesktopEntry(where, entry, report) {
  report.checked(`${where} desktop entry`)
  for (const key of ['Name', 'GenericName', 'Comment', 'Exec', 'Icon', 'StartupWMClass']) {
    report.problem(brandProblem(`${where} ${key}`, entry[key]))
  }
  const mimeTypes = (entry.MimeType ?? '').split(';').filter(Boolean)
  for (const scheme of LINUX_URL_SCHEMES) {
    if (!mimeTypes.includes(`x-scheme-handler/${scheme}`)) {
      report.problem(`${where}: MimeType does not route ${scheme}:// (x-scheme-handler/${scheme})`)
    }
  }
}

/**
 * Package members a user sees by name: the desktop entries and the theme
 * icons (`dpkg-deb -c` lines end with the member path).
 */
export function visibleDebMembers(listing) {
  return listing
    .split(/\r?\n/)
    .map((line) => /\s(\.\/\S.*?)(?: -> .*)?$/.exec(line)?.[1])
    .filter((member) => member && /^\.\/usr\/share\/(?:applications|icons)\/.*[^/]$/.test(member))
}

function checkDeb(name, path, report) {
  const run = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  let members
  try {
    checkDebControl(name, parseControl(run('dpkg-deb', ['-f', path])), report)
    members = visibleDebMembers(run('dpkg-deb', ['-c', path]))
  } catch (error) {
    report.problem(`${name}: dpkg-deb cannot read it (${error.message ?? error})`)
    return
  }
  for (const member of members) report.problem(brandProblem(`${name} file`, member))
  const desktop = members.filter((member) => member.endsWith('.desktop'))
  if (desktop.length !== 1) {
    report.problem(`${name}: expected one desktop entry, found ${desktop.length}`)
    return
  }
  const text = run('sh', [
    '-c',
    'dpkg-deb --fsys-tarfile "$1" | tar -xOf - "$2"',
    'sh',
    path,
    desktop[0],
  ])
  checkDesktopEntry(`${name} ${desktop[0]}`, parseDesktopEntry(text), report)
}

/**
 * The unpacked directories an installer implies: a Windows setup exe its
 * win[-arch]-unpacked, a dmg its mac[-arch] (x64 is plain `mac`), a deb or
 * AppImage its linux[-arch]-unpacked (x64 is plain linux-unpacked). Null when the
 * arch is not in the name; then any directory of that platform satisfies it.
 */
export function impliedUnpackedDir(name) {
  if (/\.exe$/i.test(name)) {
    const arch = /(?:^|[_-])(arm64|ia32|x64)(?:[_-]|-setup|\.exe$)/i.exec(name)?.[1]?.toLowerCase()
    if (!arch) return { platform: 'win', dir: null }
    return { platform: 'win', dir: arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked` }
  }
  if (/\.dmg$/i.test(name)) {
    const arch = /(?:^|[_-])(arm64|x64|universal)\.dmg$/i.exec(name)?.[1]?.toLowerCase()
    if (!arch) return { platform: 'mac', dir: null }
    return { platform: 'mac', dir: arch === 'x64' ? 'mac' : `mac-${arch}` }
  }
  if (/\.(?:deb|AppImage)$/i.test(name)) {
    const arch = /[_-](arm64|x64|amd64|x86_64)\.(?:deb|AppImage)$/i.exec(name)?.[1]?.toLowerCase()
    if (!arch) return { platform: 'linux', dir: null }
    const x64 = arch === 'x64' || arch === 'amd64' || arch === 'x86_64'
    return { platform: 'linux', dir: x64 ? 'linux-unpacked' : `linux-${arch}-unpacked` }
  }
  return null
}

/** Runs every check on an electron-builder output directory. */
export function checkBuildDir(dir, { expect = [] } = {}) {
  const problems = []
  const checked = []
  const report = {
    problem: (message) => message && problems.push(message),
    checked: (what) => checked.push(what),
  }
  const inspected = new Set()
  const required = new Map(expect.map((name) => [name, '--expect']))
  const requiredPlatforms = new Map()
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!UNPACKED_DIR.test(name)) continue
      inspected.add(name)
      if (name.startsWith('win')) {
        checkWindowsUnpacked(path, report)
      } else if (name.startsWith('mac')) {
        const apps = readdirSync(path).filter((entry) => entry.endsWith('.app'))
        if (apps.length === 0) report.problem(`${name}: no .app bundle`)
        for (const app of apps) checkMacApp(join(path, app), report)
      } else {
        checkLinuxUnpacked(path, report)
      }
      continue
    }
    checked.push(`file name ${name}`)
    report.problem(brandProblem('artifact name', name))
    if (/^latest(?:-[a-z0-9]+)?\.yml$/i.test(name)) {
      report.problem(`${name}: update feed metadata in the output (auto-update must stay off)`)
    }
    if (/\.exe$/i.test(name)) {
      checkVersionInfo(name, parseVersionInfo(readFileSync(path)), report, { requireKeys: true })
    }
    if (/\.deb$/i.test(name)) checkDeb(name, path, report)
    const implied = impliedUnpackedDir(name)
    if (implied?.dir) required.set(implied.dir, name)
    else if (implied) requiredPlatforms.set(implied.platform, name)
  }
  for (const [name, by] of required) {
    if (!inspected.has(name)) {
      problems.push(`${name}: unpacked app directory missing (required by ${by})`)
    }
  }
  for (const [platform, by] of requiredPlatforms) {
    if (![...inspected].some((name) => name.startsWith(platform))) {
      problems.push(`no ${platform} unpacked app directory (required by ${by})`)
    }
  }
  if (checked.length === 0) problems.push(`${dir}: no packaged output to check`)
  return { checked, problems }
}

function main(argv) {
  let dir
  let json = false
  const expect = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dir') dir = argv[++index]
    else if (argv[index] === '--expect') {
      expect.push(...(argv[++index] ?? '').split(',').filter(Boolean))
    } else if (argv[index] === '--json') json = true
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  if (!dir) {
    throw new Error(
      'usage: check-build-brand.mjs --dir <electron-builder output> [--expect <dir>[,<dir>]] [--json]',
    )
  }
  for (const name of expect) {
    if (!UNPACKED_DIR.test(name)) throw new Error(`--expect ${name}: not an unpacked app directory`)
  }
  const result = checkBuildDir(resolve(dir), { expect })
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    for (const what of result.checked) console.log(`checked: ${what}`)
    for (const problem of result.problems) console.error(`BRAND: ${problem}`)
    console.log(
      `check-build-brand: ${result.problems.length} problem(s), ${result.checked.length} item(s) checked`,
    )
  }
  return result.problems.length === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`check-build-brand: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
