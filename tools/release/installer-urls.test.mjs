import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  INSTALLER_PLATFORMS,
  buildInstallerUrls,
  installerPlatformOf,
  parseArguments,
} from './installer-urls.mjs'

const SCRIPT = fileURLToPath(new URL('./installer-urls.mjs', import.meta.url))
const BASE = 'https://github.com/OWNER/REPO/releases/download/v0.11.0-dev.3'
const WIN = 'UniWork-Office_0.11.0-dev.3_unsigned_win32_x64-setup.exe'
const MAC_ARM = 'UniWork-Office_0.11.0-dev.3_unsigned_darwin_arm64.dmg'
const MAC_X64 = 'UniWork-Office_0.11.0-dev.3_unsigned_darwin_x64.dmg'

describe('installerPlatformOf', () => {
  it('maps the release artifact names to the server platform keys', () => {
    assert.equal(installerPlatformOf(WIN, 'dev'), 'win32-x64')
    assert.equal(installerPlatformOf(MAC_ARM, 'dev'), 'darwin-arm64')
    assert.equal(installerPlatformOf(MAC_X64, 'dev'), 'darwin-x64')
    assert.equal(
      installerPlatformOf('UniWork-Office_0.11.0-beta.2_unsigned_linux_x64.AppImage', 'beta'),
      'linux-x64-appimage',
    )
  })

  it('ignores files that are not installers', () => {
    for (const name of [
      'SHA256SUMS-win32-x64.txt',
      'UniWork-Office_0.11.0-dev.3_unsigned_darwin_arm64.zip',
      'installer-urls-dev.json',
      'UniWork-Office-0.11.0-x64.exe',
    ]) {
      assert.equal(installerPlatformOf(name, 'dev'), undefined, name)
    }
  })

  it('refuses an installer without the unsigned label', () => {
    assert.throws(
      () => installerPlatformOf('UniWork-Office_0.11.0-dev.3_win32_x64-setup.exe', 'dev'),
      /no "unsigned" label/,
    )
  })

  it('refuses an installer of another channel', () => {
    assert.throws(() => installerPlatformOf(WIN, 'beta'), /not a beta build/)
    assert.throws(
      () => installerPlatformOf('UniWork-Office_0.11.0_unsigned_win32_x64-setup.exe', 'dev'),
      /not a dev build/,
    )
  })

  it('refuses names the server would not serve verbatim', () => {
    assert.throws(
      () => installerPlatformOf('UniWork Office_0.11.0-dev.3_unsigned_win32_x64-setup.exe', 'dev'),
      /unsafe installer file name/,
    )
  })

  it('refuses the stable channel', () => {
    assert.throws(() => installerPlatformOf(WIN, 'stable'), /channel must be one of dev, beta/)
  })
})

describe('buildInstallerUrls', () => {
  it('returns the compact map in the server contract order', () => {
    const urls = buildInstallerUrls({
      channel: 'dev',
      baseUrl: `${BASE}/`,
      files: [MAC_X64, 'SHA256SUMS-darwin.txt', WIN, MAC_ARM],
    })
    assert.deepEqual(Object.keys(urls), ['win32-x64', 'darwin-arm64', 'darwin-x64'])
    assert.equal(urls['win32-x64'], `${BASE}/${WIN}`)
    assert.equal(
      JSON.stringify(urls),
      `{"win32-x64":"${BASE}/${WIN}","darwin-arm64":"${BASE}/${MAC_ARM}","darwin-x64":"${BASE}/${MAC_X64}"}`,
    )
  })

  it('keeps the platform key list identical to the server', () => {
    assert.deepEqual(INSTALLER_PLATFORMS, [
      'win32-x64',
      'win32-x64-zip',
      'darwin-arm64',
      'darwin-x64',
      'linux-x64-deb',
      'linux-x64-appimage',
    ])
  })

  it('refuses two installers for one platform', () => {
    assert.throws(
      () =>
        buildInstallerUrls({
          channel: 'dev',
          baseUrl: BASE,
          files: [WIN, 'UniWork-Office_0.11.0-dev.4_unsigned_win32_x64-setup.exe'],
        }),
      /two dev installers for win32-x64/,
    )
  })

  it('refuses installers of different versions', () => {
    assert.throws(
      () =>
        buildInstallerUrls({
          channel: 'dev',
          baseUrl: BASE,
          files: [WIN, 'UniWork-Office_0.11.0-dev.4_unsigned_darwin_arm64.dmg'],
        }),
      /different versions/,
    )
  })

  it('refuses an empty result', () => {
    assert.throws(
      () => buildInstallerUrls({ channel: 'dev', baseUrl: BASE, files: ['SHA256SUMS-x.txt'] }),
      /no unsigned dev installer/,
    )
  })

  it('refuses a base URL that is not plain https', () => {
    for (const baseUrl of [
      'http://example.com/x',
      'https://user:pw@example.com/x',
      'https://example.com/x?a=1',
      'https://example.com/x#f',
      'releases/download/v1',
    ]) {
      assert.throws(() => buildInstallerUrls({ channel: 'dev', baseUrl, files: [WIN] }), baseUrl)
    }
  })
})

describe('command line', () => {
  it('parses exactly one of --dir and --files', () => {
    assert.deepEqual(parseArguments(['--channel', 'dev', '--base-url', BASE, '--dir', 'out']), {
      channel: 'dev',
      baseUrl: BASE,
      dir: 'out',
    })
    assert.throws(() => parseArguments(['--channel', 'dev', '--base-url', BASE]), /usage/)
    assert.throws(
      () => parseArguments(['--channel', 'dev', '--base-url', BASE, '--dir', 'a', '--files', 'b']),
      /usage/,
    )
    assert.throws(() => parseArguments(['--bogus', 'x']), /unknown argument/)
  })

  it('prints the map for the files in a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'installer-urls-'))
    try {
      for (const name of [WIN, MAC_ARM, 'SHA256SUMS-win32-x64.txt'])
        writeFileSync(join(dir, name), '')
      mkdirSync(join(dir, 'nested_unsigned_win32_x64-setup.exe'))
      const out = execFileSync(
        process.execPath,
        [SCRIPT, '--channel', 'dev', '--base-url', BASE, '--dir', dir],
        { encoding: 'utf8' },
      )
      assert.equal(out, `{"win32-x64":"${BASE}/${WIN}","darwin-arm64":"${BASE}/${MAC_ARM}"}\n`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
