import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import {
  BRAND,
  checkBuildDir,
  checkDebControl,
  checkDesktopEntry,
  checkInfoPlist,
  checkReleaseFeed,
  impliedUnpackedDir,
  parseControl,
  parseDesktopEntry,
  parsePlist,
  parseUpdateFeed,
  parseVersionInfo,
  visibleDebMembers,
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
      homepage: 'https://uniworkos.com',
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
  if (updateFeed) {
    const yml = typeof updateFeed === 'string' ? updateFeed : 'provider: generic\n'
    writeFileSync(join(resources, 'app-update.yml'), yml)
  }
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
  pkg = {},
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
    await writeAsar(root, resources, pkg)
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

  describe('with --update-feed github:UNIAI-TEAM/uniwork-office', () => {
    const feed = parseUpdateFeed('github:UNIAI-TEAM/uniwork-office')
    const githubYml =
      'owner: UNIAI-TEAM\nrepo: uniwork-office\nprovider: github\nchannel: dev\n' +
      'updaterCacheDirName: uniwork-office-updater\n'
    const installer = 'UniWork-Office_0.11.0-dev.0_unsigned_win32_x64-setup.exe'
    const channelYml = (name) =>
      `version: 0.11.0-dev.0\nfiles:\n  - url: ${name}\n    sha512: x\n    size: 1\npath: ${name}\n`

    it('passes the github feed and a channel file that lists the installer', async () => {
      const root = await fakeWindowsOutput({ updateFeed: githubYml })
      writeFileSync(join(root, 'dev.yml'), channelYml(installer))
      const result = checkBuildDir(root, { updateFeed: feed })
      assert.deepEqual(result.problems, [])
      assert.ok(result.checked.includes('win-unpacked app-update.yml'))
    })

    it('flags a missing feed, another repository and a generic feed', async () => {
      for (const [updateFeed, expected] of [
        [false, 'hold no app-update.yml'],
        [
          githubYml.replace('uniwork-office\n', 'other\n'),
          'expected github:UNIAI-TEAM/uniwork-office',
        ],
        [
          'provider: generic\nurl: https://cdn.example\n',
          'expected github:UNIAI-TEAM/uniwork-office',
        ],
      ]) {
        const result = checkBuildDir(await fakeWindowsOutput({ updateFeed }), { updateFeed: feed })
        assert.ok(
          result.problems.some((p) => p.includes(expected)),
          `${expected}: ${result.problems}`,
        )
      }
    })

    it('flags a channel file listing a name that is not in the output', async () => {
      const root = await fakeWindowsOutput({ updateFeed: githubYml })
      writeFileSync(join(root, 'dev.yml'), channelYml('UniWork-Office-0.11.0-dev.0-setup.exe'))
      const result = checkBuildDir(root, { updateFeed: feed })
      assert.ok(result.problems.some((p) => p.includes('which is not in the output')))
    })

    it('still flags any feed in the mac app', async () => {
      const result = checkBuildDir(await fakeMacOutput({ arches: ['arm64'], updateFeed: true }), {
        updateFeed: feed,
      })
      assert.ok(result.problems.some((p) => p.includes('auto-update must stay off')))
    })

    const releaseFeed = { owner: 'UNIAI-TEAM', repo: 'uniwork-office', channel: 'dev' }

    it('passes a mac app that names the repository for its update notice', async () => {
      const root = await fakeMacOutput({ pkg: { uniworkReleaseFeed: releaseFeed } })
      const result = checkBuildDir(root, { updateFeed: feed })
      assert.deepEqual(result.problems, [])
      assert.ok(result.checked.includes('UniWork Office.app uniworkReleaseFeed'))
    })

    it('flags a mac app without the release feed, or with another one', () => {
      for (const pkg of [
        {},
        { uniworkReleaseFeed: { ...releaseFeed, repo: 'other' } },
        { uniworkReleaseFeed: { ...releaseFeed, channel: 'latest' } },
      ]) {
        const problems = []
        checkReleaseFeed('app', pkg, feed, {
          problem: (p) => problems.push(p),
          checked: () => {},
        })
        assert.equal(problems.length, 1, JSON.stringify(pkg))
        assert.ok(problems[0].includes('expected github:UNIAI-TEAM/uniwork-office'))
      }
    })

    it('refuses anything but github:<owner>/<repo>', () => {
      assert.throws(() => parseUpdateFeed('https://github.com/UNIAI-TEAM/uniwork-office'))
      assert.throws(() => parseUpdateFeed('github:UNIAI-TEAM'))
    })
  })

  describe('with --update-feed generic:https://uniworkos.com/downloads/office/update/dev', () => {
    const feedUrl = 'https://uniworkos.com/downloads/office/update/dev'
    const feed = parseUpdateFeed(`generic:${feedUrl}`)
    const genericYml = (url = feedUrl) =>
      `provider: generic\nurl: ${url}\nchannel: dev\nupdaterCacheDirName: uniwork-office-updater\n`
    const installer = 'UniWork-Office_0.11.0-dev.0_unsigned_win32_x64-setup.exe'
    const channelYml = `version: 0.11.0-dev.0\nfiles:\n  - url: ${installer}\n    sha512: x\n    size: 1\npath: ${installer}\n`

    it('parses the generic feed and drops a trailing slash', () => {
      assert.deepEqual(feed, { provider: 'generic', url: feedUrl })
      assert.deepEqual(parseUpdateFeed(`generic:${feedUrl}/`), feed)
    })

    it('passes a generic app-update.yml on exactly that url and a channel file listing the installer', async () => {
      const root = await fakeWindowsOutput({ updateFeed: genericYml() })
      writeFileSync(join(root, 'dev.yml'), channelYml)
      const result = checkBuildDir(root, { updateFeed: feed })
      assert.deepEqual(result.problems, [])
      assert.ok(result.checked.includes('win-unpacked app-update.yml'))
    })

    it('flags a missing feed, another url, the channel directory missing and a github feed', async () => {
      for (const [updateFeed, expected] of [
        [false, 'hold no app-update.yml (expected the generic feed)'],
        [
          genericYml('https://uniworkos.com/downloads/office/update/beta'),
          `expected generic:${feedUrl}`,
        ],
        [
          genericYml('https://uniworkos.com/downloads/office/update'),
          `expected generic:${feedUrl}`,
        ],
        [
          'owner: UNIAI-TEAM\nrepo: uniwork-office\nprovider: github\n',
          `expected generic:${feedUrl}`,
        ],
      ]) {
        const result = checkBuildDir(await fakeWindowsOutput({ updateFeed }), { updateFeed: feed })
        assert.ok(
          result.problems.some((p) => p.includes(expected)),
          `${expected}: ${result.problems}`,
        )
      }
    })

    it('flags a channel file listing a name that is not in the output', async () => {
      const root = await fakeWindowsOutput({ updateFeed: genericYml() })
      writeFileSync(join(root, 'dev.yml'), channelYml.replaceAll(installer, 'other-setup.exe'))
      const result = checkBuildDir(root, { updateFeed: feed })
      assert.ok(result.problems.some((p) => p.includes('which is not in the output')))
    })

    it('expects no feed and no release feed in the mac app', async () => {
      const clean = checkBuildDir(await fakeMacOutput({ arches: ['arm64'] }), { updateFeed: feed })
      assert.deepEqual(clean.problems, [])
      const withFeed = checkBuildDir(await fakeMacOutput({ arches: ['arm64'], updateFeed: true }), {
        updateFeed: feed,
      })
      assert.ok(withFeed.problems.some((p) => p.includes('auto-update must stay off')))
      const withNotice = checkBuildDir(
        await fakeMacOutput({
          arches: ['arm64'],
          pkg: {
            uniworkReleaseFeed: { owner: 'UNIAI-TEAM', repo: 'uniwork-office', channel: 'dev' },
          },
        }),
        { updateFeed: feed },
      )
      assert.ok(withNotice.problems.some((p) => p.includes('carries uniworkReleaseFeed')))
    })

    it('refuses a generic feed that is not a plain https url', () => {
      for (const value of [
        'generic:http://uniworkos.com/downloads/office/update/dev',
        'generic:https://user:pass@uniworkos.com/update',
        'generic:https://uniworkos.com/update?x=1',
        'generic:',
      ]) {
        assert.throws(() => parseUpdateFeed(value), /--update-feed/)
      }
    })
  })

  it('flags a dev channel file when no feed is expected', async () => {
    const root = await fakeWindowsOutput()
    writeFileSync(join(root, 'dev.yml'), 'version: 0.11.0-dev.0\n')
    const result = checkBuildDir(root)
    assert.ok(result.problems.some((p) => p.startsWith('dev.yml: update feed metadata')))
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

  it('flags a release feed in a mac app built without --update-feed', async () => {
    const root = await fakeMacOutput({
      arches: ['arm64'],
      pkg: { uniworkReleaseFeed: { owner: 'UNIAI-TEAM', repo: 'uniwork-office', channel: 'dev' } },
    })
    const result = checkBuildDir(root)
    assert.ok(result.problems.some((p) => p.includes('carries uniworkReleaseFeed')))
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

/** electron-builder's linux layout: linux-unpacked/ next to the deb and AppImage (no .deb here). */
async function fakeLinuxOutput({ executable = 'uniwork-office', unpacked = true } = {}) {
  const root = newRoot()
  writeFileSync(join(root, 'UniWork-Office_0.11.0-dev.0_linux_x64.AppImage'), '')
  if (!unpacked) return root
  const resources = join(root, 'linux-unpacked', 'resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(root, 'linux-unpacked', executable), '')
  await writeAsar(root, resources, {})
  return root
}

const DESKTOP = `[Desktop Entry]
Name=UniWork Office
Exec=/opt/UniWork\ Office/uniwork-office %U
Terminal=false
Type=Application
Icon=uniwork-office
StartupWMClass=uniwork-office
MimeType=application/pdf;x-scheme-handler/uniwork;x-scheme-handler/uniwork-office;x-scheme-handler/uniwork-office-dev;
Categories=Office;

[Desktop Action new]
Name=GenOffice ignored outside the main group
`

describe('Linux packages', () => {
  const collect = () => {
    const problems = []
    return { problems, report: { problem: (p) => p && problems.push(p), checked: () => {} } }
  }

  it('maps deb / AppImage names to linux-unpacked', () => {
    assert.deepEqual(impliedUnpackedDir('UniWork-Office_1.0.0-dev.1_linux_x64.deb'), {
      platform: 'linux',
      dir: 'linux-unpacked',
    })
    assert.deepEqual(impliedUnpackedDir('UniWork Office-1.0.0-arm64.AppImage'), {
      platform: 'linux',
      dir: 'linux-arm64-unpacked',
    })
  })

  it('passes a clean linux-unpacked and requires it for an AppImage', async () => {
    assert.deepEqual(checkBuildDir(await fakeLinuxOutput()).problems, [])
    assert.deepEqual(checkBuildDir(await fakeLinuxOutput({ unpacked: false })).problems, [
      'linux-unpacked: unpacked app directory missing (required by UniWork-Office_0.11.0-dev.0_linux_x64.AppImage)',
    ])
    const upstream = checkBuildDir(await fakeLinuxOutput({ executable: 'genoffice' })).problems
    assert.ok(upstream.some((p) => p.startsWith('linux-unpacked file name:')))
    assert.ok(upstream.includes('linux-unpacked: no "uniwork-office" executable'))
  })

  it('checks the deb control fields', () => {
    const control = parseControl(
      'Package: uniwork-office\nVersion: 0.11.0-dev.1\nMaintainer: UniWork <hello@uniwork.app>\nDescription: UniWork Office\n more text\n',
    )
    assert.equal(control.Description, 'UniWork Office\nmore text')
    const ok = collect()
    checkDebControl('x.deb', control, ok.report)
    assert.deepEqual(ok.problems, [])
    const bad = collect()
    checkDebControl('x.deb', { ...control, Package: 'genoffice' }, bad.report)
    assert.equal(bad.problems.length, 2)
  })

  it('checks the desktop entry names and its URL scheme handlers', () => {
    const entry = parseDesktopEntry(DESKTOP)
    assert.equal(entry.Name, 'UniWork Office')
    const ok = collect()
    checkDesktopEntry('d', entry, ok.report)
    assert.deepEqual(ok.problems, [])
    const bad = collect()
    checkDesktopEntry(
      'd',
      { ...entry, Icon: 'genoffice', MimeType: 'x-scheme-handler/uniwork;' },
      bad.report,
    )
    assert.ok(bad.problems.some((p) => p.startsWith('d Icon:')))
    assert.ok(
      bad.problems.includes(
        'd: MimeType does not route uniwork-office:// (x-scheme-handler/uniwork-office)',
      ),
    )
    assert.ok(bad.problems.some((p) => p.includes('uniwork-office-dev://')))
  })

  it('lists the desktop entries and theme icons of a deb listing', () => {
    const listing = [
      'drwxr-xr-x 0/0 0 2026-10-09 10:00 ./usr/share/applications/',
      '-rw-r--r-- 0/0 300 2026-10-09 10:00 ./usr/share/applications/uniwork-office.desktop',
      '-rw-r--r-- 0/0 900 2026-10-09 10:00 ./usr/share/icons/hicolor/64x64/apps/uniwork-office.png',
      '-rwxr-xr-x 0/0 900 2026-10-09 10:00 ./opt/UniWork Office/resources/cli/genoffice',
    ].join('\n')
    assert.deepEqual(visibleDebMembers(listing), [
      './usr/share/applications/uniwork-office.desktop',
      './usr/share/icons/hicolor/64x64/apps/uniwork-office.png',
    ])
  })
})
