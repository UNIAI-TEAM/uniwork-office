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

async function fakeWindowsOutput({
  installer = 'UniWork-Office_0.11.0-dev.0_unsigned_win32_x64-setup.exe',
  exeStrings = GOOD_STRINGS,
  pkg = {},
  updateFeed = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'brand-out-'))
  roots.push(root)
  writeFileSync(join(root, installer), fakeExe(GOOD_STRINGS))
  writeFileSync(join(root, `${installer}.blockmap`), '')
  writeFileSync(join(root, 'builder-debug.yml'), '')
  const unpacked = join(root, 'win-unpacked')
  mkdirSync(join(unpacked, 'resources'), { recursive: true })
  writeFileSync(join(unpacked, 'UniWork Office.exe'), fakeExe(exeStrings))
  if (updateFeed)
    writeFileSync(join(unpacked, 'resources', 'app-update.yml'), 'provider: generic\n')
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
  await asar.createPackage(app, join(unpacked, 'resources', 'app.asar'))
  rmSync(app, { recursive: true })
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

  it('fails on a directory with nothing to check', () => {
    const root = mkdtempSync(join(tmpdir(), 'brand-empty-'))
    roots.push(root)
    assert.match(checkBuildDir(root).problems[0], /no packaged output/)
  })
})
