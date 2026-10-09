import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import {
  BRAND,
  checkBuildDir,
  checkInfoPlist,
  parsePlist,
  parseVersionInfo,
} from './check-build-brand.mjs'

const asar = createRequire(import.meta.url)('@electron/asar')

// --- synthetic VS_VERSIONINFO -------------------------------------------------

const pad4 = (buf) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)])
const utf16z = (text) => Buffer.from(`${text}\0`, 'utf16le')

/** One version-resource node: header, key, padding, value, padding, children. */
function node(key, { value = Buffer.alloc(0), type = 0, valueLength, children = [] } = {}) {
  const head = pad4(Buffer.concat([Buffer.alloc(6), utf16z(key)]))
  const body = Buffer.concat([pad4(value), ...children.map(pad4)])
  const out = Buffer.concat([head, body])
  out.writeUInt16LE(out.length, 0)
  out.writeUInt16LE(valueLength ?? value.length, 2)
  out.writeUInt16LE(type, 4)
  return out
}

function versionResource(strings) {
  const fixed = Buffer.alloc(52)
  fixed.writeUInt32LE(0xfeef04bd, 0)
  const entries = Object.entries(strings).map(([key, text]) =>
    node(key, { value: utf16z(text), type: 1, valueLength: text.length + 1 }),
  )
  return node('VS_VERSION_INFO', {
    value: fixed,
    children: [
      node('StringFileInfo', {
        type: 1,
        children: [node('040904b0', { type: 1, children: entries })],
      }),
      node('VarFileInfo', { type: 1 }),
    ],
  })
}

/** A fake PE: some noise, a stray marker that is not a resource, then the resource. */
function fakeExe(strings) {
  return Buffer.concat([
    Buffer.from('MZ fake header'),
    Buffer.alloc(3),
    Buffer.from('VS_VERSION_INFO\0', 'utf16le'),
    Buffer.alloc(9),
    versionResource(strings),
    Buffer.alloc(16),
  ])
}

const GOOD_STRINGS = {
  CompanyName: 'UniWork',
  FileDescription: 'UniWork Office',
  LegalCopyright: 'Copyright © 2026 UniWork',
  OriginalFilename: 'UniWork Office.exe',
  ProductName: 'UniWork Office',
}

describe('parseVersionInfo', () => {
  it('reads the StringFileInfo entries of a version resource', () => {
    assert.deepEqual(parseVersionInfo(fakeExe(GOOD_STRINGS)), GOOD_STRINGS)
  })

  it('returns null without a version resource', () => {
    assert.equal(parseVersionInfo(Buffer.from('MZ nothing here')), null)
  })
})

// --- plist -----------------------------------------------------------------------

const plistXml = ({
  id = 'com.uniwork.office',
  name = 'UniWork Office',
  docName = 'Word Document',
} = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${id}</string>
  <key>CFBundleName</key>
  <string>${name}</string>
  <key>CFBundleDisplayName</key>
  <string>${name}</string>
  <key>CFBundleExecutable</key>
  <string>${name}</string>
  <key>LSRequiresNativeExecution</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <integer>1</integer>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeExtensions</key>
      <array><string>docx</string></array>
      <key>CFBundleTypeName</key>
      <string>${docName}</string>
    </dict>
  </array>
  <key>NSHumanReadableCopyright</key>
  <string>Copyright &#169; 2026 UniWork &amp; friends</string>
</dict>
</plist>
`

describe('parsePlist', () => {
  it('reads dicts, arrays, strings, numbers, booleans and entities', () => {
    const plist = parsePlist(plistXml())
    assert.equal(plist.CFBundleIdentifier, 'com.uniwork.office')
    assert.equal(plist.LSRequiresNativeExecution, true)
    assert.equal(plist.NSHighResolutionCapable, 1)
    assert.deepEqual(plist.CFBundleDocumentTypes, [
      { CFBundleTypeExtensions: ['docx'], CFBundleTypeName: 'Word Document' },
    ])
    assert.equal(plist.NSHumanReadableCopyright, 'Copyright © 2026 UniWork & friends')
  })
})

function collect(fn) {
  const problems = []
  const report = { problem: (p) => p && problems.push(p), checked: () => {} }
  fn(report)
  return problems
}

describe('checkInfoPlist', () => {
  it('accepts the UniWork identity', () => {
    assert.deepEqual(
      collect((report) => checkInfoPlist('UniWork Office.app', parsePlist(plistXml()), report)),
      [],
    )
  })

  it('flags an upstream bundle id, name and document type name', () => {
    const problems = collect((report) =>
      checkInfoPlist(
        'X.app',
        parsePlist(
          plistXml({ id: 'com.genspark.office', name: 'Gen Office', docName: 'GenOffice Doc' }),
        ),
        report,
      ),
    )
    assert.ok(problems.some((p) => p.includes('expected "com.uniwork.office"')))
    assert.ok(problems.some((p) => p.includes('CFBundleName')))
    assert.ok(problems.some((p) => p.includes('CFBundleDocumentTypes')))
  })
})

describe('BRAND', () => {
  it('matches the upstream names in any style and nothing else', () => {
    for (const text of [
      'GenOffice',
      'genoffice',
      'Gen Office',
      'GEN_OFFICE',
      'Genspark',
      'gen-spark',
    ]) {
      assert.match(text, BRAND)
    }
    for (const text of ['UniWork Office', 'general office', 'Regenerate']) {
      assert.doesNotMatch(text, BRAND)
    }
  })
})

// --- whole output directory ----------------------------------------------------------

const roots = []
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

function newRoot() {
  const root = mkdtempSync(join(tmpdir(), 'brand-out-'))
  roots.push(root)
  return root
}

async function writeAsar(root, resources, pkg) {
  const app = join(root, 'app-src')
  mkdirSync(app)
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({
      name: '@genoffice/shell',
      productName: 'UniWork Office',
      author: { name: 'UniWork', email: 'hello@uniwork.app' },
      homepage: 'https://uniwork.app',
      description: 'UniWork Office shell',
      ...pkg,
    }),
  )
  await asar.createPackage(app, join(resources, 'app.asar'))
  rmSync(app, { recursive: true })
}

async function fakeWindowsOutput({
  installer = 'UniWork-Office_0.11.0-dev.0_unsigned_win32_x64-setup.exe',
  installerStrings = GOOD_STRINGS,
  exeStrings = GOOD_STRINGS,
  pkg = {},
  updateFeed = false,
  unpacked = true,
} = {}) {
  const root = newRoot()
  writeFileSync(join(root, installer), fakeExe(installerStrings))
  writeFileSync(join(root, `${installer}.blockmap`), '')
  writeFileSync(join(root, 'builder-debug.yml'), '')
  if (!unpacked) return root
  const resources = join(root, 'win-unpacked', 'resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(root, 'win-unpacked', 'UniWork Office.exe'), fakeExe(exeStrings))
  if (updateFeed) writeFileSync(join(resources, 'app-update.yml'), 'provider: generic\n')
  await writeAsar(root, resources, pkg)
  return root
}

/** electron-builder's mac layout: mac-arm64/ and mac/ (x64), each with the .app. */
async function fakeMacOutput({
  arches = ['arm64', 'x64'],
  unpacked = arches,
  helper = 'UniWork Office Helper.app',
  plist = plistXml(),
  updateFeed = false,
} = {}) {
  const root = newRoot()
  for (const arch of arches) {
    writeFileSync(join(root, `UniWork-Office_0.11.0-dev.0_unsigned_darwin_${arch}.dmg`), '')
  }
  for (const arch of unpacked) {
    const appDir = join(root, arch === 'x64' ? 'mac' : `mac-${arch}`, 'UniWork Office.app')
    const contents = join(appDir, 'Contents')
    const resources = join(contents, 'Resources')
    mkdirSync(resources, { recursive: true })
    mkdirSync(join(contents, 'Frameworks', helper), { recursive: true })
    mkdirSync(join(contents, 'Frameworks', 'Electron Framework.framework'))
    writeFileSync(join(contents, 'Info.plist'), plist)
    if (updateFeed) writeFileSync(join(resources, 'app-update.yml'), 'provider: generic\n')
    await writeAsar(root, resources, {})
  }
  return root
}

describe('checkBuildDir', () => {
  it('passes a clean Windows output (the internal package name is not user-visible)', async () => {
    const result = checkBuildDir(await fakeWindowsOutput())
    assert.deepEqual(result.problems, [])
    assert.ok(result.checked.includes('win-unpacked/UniWork Office.exe version info'))
    assert.ok(result.checked.includes('win-unpacked package.json'))
  })

  it('flags an upstream installer name', async () => {
    const result = checkBuildDir(
      await fakeWindowsOutput({ installer: 'GenOffice-Setup-0.11.0.exe' }),
    )
    assert.ok(result.problems.some((p) => p.startsWith('artifact name')))
  })

  it('flags upstream exe version strings', async () => {
    const result = checkBuildDir(
      await fakeWindowsOutput({ exeStrings: { ...GOOD_STRINGS, CompanyName: 'Genspark Inc.' } }),
    )
    assert.ok(result.problems.some((p) => p.includes('CompanyName')))
  })

  it('flags upstream package.json fields inside app.asar', async () => {
    const result = checkBuildDir(
      await fakeWindowsOutput({
        pkg: { homepage: 'https://genoffice.example', productName: 'GenOffice' },
      }),
    )
    assert.ok(result.problems.some((p) => p.includes('homepage')))
    assert.ok(result.problems.some((p) => p.includes('expected "UniWork Office"')))
  })

  it('flags a baked update feed', async () => {
    const result = checkBuildDir(await fakeWindowsOutput({ updateFeed: true }))
    assert.ok(result.problems.some((p) => p.includes('app-update.yml')))
  })

  it('flags an upstream-branded installer exe', async () => {
    const result = checkBuildDir(
      await fakeWindowsOutput({
        installerStrings: { ...GOOD_STRINGS, FileDescription: 'GenOffice Setup' },
      }),
    )
    assert.deepEqual(result.problems, [
      'UniWork-Office_0.11.0-dev.0_unsigned_win32_x64-setup.exe FileDescription: "GenOffice Setup" names GenOffice',
    ])
  })

  it('flags update feed metadata next to the installers', async () => {
    const root = await fakeWindowsOutput()
    writeFileSync(join(root, 'latest.yml'), 'version: 0.11.0\n')
    writeFileSync(join(root, 'latest-mac.yml'), 'version: 0.11.0\n')
    const result = checkBuildDir(root)
    assert.ok(result.problems.some((p) => p.startsWith('latest.yml: update feed')))
    assert.ok(result.problems.some((p) => p.startsWith('latest-mac.yml: update feed')))
  })

  it('fails when the installer is present but win-unpacked is missing', async () => {
    const root = await fakeWindowsOutput({ unpacked: false })
    assert.deepEqual(checkBuildDir(root).problems, [
      'win-unpacked: unpacked app directory missing (required by UniWork-Office_0.11.0-dev.0_unsigned_win32_x64-setup.exe)',
    ])
    assert.ok(
      checkBuildDir(root, { expect: ['win-unpacked'] }).problems.some((p) =>
        p.startsWith('win-unpacked: unpacked app directory missing'),
      ),
    )
  })

  it('fails when an --expect directory is missing', async () => {
    const result = checkBuildDir(await fakeWindowsOutput(), { expect: ['win-unpacked', 'mac'] })
    assert.deepEqual(result.problems, [
      'mac: unpacked app directory missing (required by --expect)',
    ])
  })

  it('passes a clean dual-arch mac output', async () => {
    const result = checkBuildDir(await fakeMacOutput(), { expect: ['mac-arm64', 'mac'] })
    assert.deepEqual(result.problems, [])
    assert.ok(result.checked.includes('UniWork Office.app Info.plist'))
    assert.ok(result.checked.includes('UniWork Office.app package.json'))
  })

  it('fails when a dmg is present but its mac directory is missing', async () => {
    const result = checkBuildDir(await fakeMacOutput({ unpacked: ['arm64'] }))
    assert.deepEqual(result.problems, [
      'mac: unpacked app directory missing (required by UniWork-Office_0.11.0-dev.0_unsigned_darwin_x64.dmg)',
    ])
  })

  it('flags an upstream mac helper, Info.plist and a baked update feed', async () => {
    const result = checkBuildDir(
      await fakeMacOutput({
        arches: ['arm64'],
        helper: 'GenOffice Helper (Renderer).app',
        plist: plistXml({ id: 'ai.genspark.office' }),
        updateFeed: true,
      }),
    )
    assert.ok(result.problems.some((p) => p.startsWith('UniWork Office.app helper:')))
    assert.ok(result.problems.some((p) => p.includes('CFBundleIdentifier is "ai.genspark.office"')))
    assert.ok(result.problems.some((p) => p.includes('app-update.yml')))
  })

  it('reads a binary Info.plist only through plutil (macOS)', async () => {
    const root = await fakeMacOutput({ arches: ['arm64'], plist: 'bplist00' })
    if (process.platform === 'darwin') {
      assert.throws(() => checkBuildDir(root))
    } else {
      assert.throws(() => checkBuildDir(root), /binary plist \(needs plutil\)/)
    }
  })

  it('fails on a directory with nothing to check', () => {
    const root = mkdtempSync(join(tmpdir(), 'brand-empty-'))
    roots.push(root)
    assert.match(checkBuildDir(root).problems[0], /no packaged output/)
  })
})
