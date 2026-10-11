import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const shellRoot = resolve(import.meta.dirname, '..')
const shellPackage = JSON.parse(readFileSync(resolve(shellRoot, 'package.json'), 'utf-8')) as {
  version: string
}

// The upstream product / company names; nothing a user sees may carry them.
const BRAND = /gen[\s._-]?office|gen[\s._-]?spark/i

interface BuilderConfig {
  appId: string
  productName: string
  artifactName: string
  copyright: string
  publish?: unknown
  extraMetadata?: { version?: string }
  fileAssociations: { ext: string; name: string; description?: string; rank?: string }[]
  nsis: Record<string, unknown>
  mac: Record<string, unknown> & { target: { target: string; arch: string[] }[] }
  dmg: Record<string, unknown>
  win: { extraResources: { from: string; to: string }[] }
  linux: { target: { target: string; arch: string[] }[]; maintainer: string; vendor: string }
  deb: Record<string, unknown>
  appImage?: Record<string, unknown>
  protocols: { name: string; schemes: string[] }[]
  beforePack: (context: { electronPlatformName: string }) => Promise<void>
}

/**
 * Loads the real packaging config with the given environment. The fs stubs only
 * matter for beforePack: every packaging input exists and the CLI bundle already
 * carries `bakedCliVersion`, so the release-version check is what runs.
 */
function loadConfig(env: Record<string, string | undefined>, bakedCliVersion = ''): BuilderConfig {
  const configModule = { exports: {} as Record<string, unknown> }
  runInNewContext(readFileSync(resolve(shellRoot, 'electron-builder.cjs'), 'utf8'), {
    module: configModule,
    __dirname: shellRoot,
    process: { platform: 'linux', arch: 'x64', env, execPath: '/usr/bin/node' },
    require: (id: string) => {
      if (id === './package.json') return shellPackage
      if (id === 'node:child_process') {
        return {
          execFileSync: () => {
            throw new Error('no rebuild expected')
          },
        }
      }
      if (id === 'node:fs') {
        return {
          ...require(id),
          existsSync: () => true,
          readFileSync: (path: string, encoding: string) => {
            if (String(path).endsWith('genoffice.cjs')) {
              return `const __cliAppVersion = ${JSON.stringify(bakedCliVersion)};\n`
            }
            if (String(path).endsWith('THIRD-PARTY-NOTICES.txt')) {
              return '@embedpdf/pdfium\nCopyright 2014 PDFium Authors\nApache License\n'
            }
            return require('node:fs').readFileSync(path, encoding as BufferEncoding)
          },
        }
      }
      return require(id)
    },
  })
  return configModule.exports as unknown as BuilderConfig
}

function withVersion(config: BuilderConfig, version: string): BuilderConfig {
  config.extraMetadata = { ...(config.extraMetadata ?? {}), version }
  return config
}

describe('installer identity', () => {
  const config = loadConfig({})

  it('names the app, its uninstall entry and shortcuts UniWork Office', () => {
    // NSIS derives the uninstall DisplayName and the shortcut names from
    // productName unless nsis.uninstallDisplayName / shortcutName override them
    expect(config.productName).toBe('UniWork Office')
    expect(config.appId).toBe('com.uniwork.office')
    expect(config.nsis.uninstallDisplayName).toBeUndefined()
    expect(config.nsis.shortcutName).toBeUndefined()
    expect(config.copyright).not.toMatch(BRAND)
  })

  it('registers file associations under neutral type names', () => {
    for (const association of config.fileAssociations) {
      expect(association.name).not.toMatch(BRAND)
      expect(association.description ?? '').not.toMatch(BRAND)
    }
  })

  it('offers every type as an alternate handler: macOS must not make the app the default silently', () => {
    expect(config.fileAssociations.length).toBeGreaterThan(0)
    for (const association of config.fileAssociations) {
      expect(association.rank, association.ext).toBe('Alternate')
    }
  })

  it('keeps plain local packaging on its usual names, signing and no update feed', () => {
    expect(config.artifactName).toBe('UniWork-Office-${version}-${arch}.${ext}')
    expect(config.nsis.artifactName).toBeUndefined()
    expect(config.mac.artifactName).toBeUndefined()
    expect(config.mac.identity).toBeUndefined()
    expect(config.mac.notarize).toBe(true)
    expect(config.dmg.sign).toBe(true)
    expect(config.publish).toBeUndefined()
  })
})

describe('dev / beta release builds', () => {
  it('use the download-server names with the unsigned label', () => {
    const config = loadConfig({ UNIWORK_RELEASE_CHANNEL: 'dev' })
    expect(config.nsis.artifactName).toBe(
      'UniWork-Office_${version}_unsigned_win32_${arch}-setup.${ext}',
    )
    expect(config.mac.artifactName).toBe('UniWork-Office_${version}_unsigned_darwin_${arch}.${ext}')
  })

  it('name the Linux packages for the download server and drop the rpm', () => {
    const config = loadConfig({ UNIWORK_RELEASE_CHANNEL: 'beta', CSC_LINK: 'file:///cert.p12' })
    // never signed, and x64 spelled out (${arch} would be amd64 / x86_64)
    expect(config.deb.artifactName).toBe('UniWork-Office_${version}_unsigned_linux_x64.${ext}')
    expect(config.appImage?.artifactName).toBe(
      'UniWork-Office_${version}_unsigned_linux_x64.${ext}',
    )
    expect(config.linux.target.map((entry) => entry.target)).toEqual(['AppImage', 'deb'])
    expect(config.deb.packageName).toBe('uniwork-office')
    expect(`${config.linux.maintainer} ${config.linux.vendor}`).not.toMatch(BRAND)
    expect(loadConfig({}).linux.target.map((entry) => entry.target)).toEqual([
      'AppImage',
      'deb',
      'rpm',
    ])
  })

  it('declare every sign-in callback scheme for the Linux desktop entry', () => {
    const schemes = (config: BuilderConfig) => config.protocols.flatMap((entry) => entry.schemes)
    expect(schemes(loadConfig({ UNIWORK_RELEASE_CHANNEL: 'dev' }))).toEqual([
      'uniwork',
      'uniwork-office',
      'uniwork-office-dev',
    ])
    expect(schemes(loadConfig({}))).toEqual(['uniwork', 'uniwork-office'])
  })

  it('publish nothing and build only the mac dmgs', () => {
    const config = loadConfig({ UNIWORK_RELEASE_CHANNEL: 'dev', GH_TOKEN: 'token' })
    expect(config.publish).toBeNull()
    expect(config.mac.target.map((entry) => entry.target)).toEqual(['dmg'])
    expect(loadConfig({}).mac.target.map((entry) => entry.target)).toEqual(['dmg', 'zip'])
  })

  it('treat empty signing variables as unset', () => {
    const env: Record<string, string | undefined> = {
      UNIWORK_RELEASE_CHANNEL: 'dev',
      CSC_LINK: '',
      CSC_KEY_PASSWORD: '',
      CSC_NAME: '',
      APPLE_ID: '',
      APPLE_APP_SPECIFIC_PASSWORD: '',
      APPLE_TEAM_ID: '',
    }
    const config = loadConfig(env)
    // electron-builder would take CSC_LINK="" as a certificate path
    for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'APPLE_ID']) {
      expect(key in env).toBe(false)
    }
    expect(config.mac.identity).toBe('-')
    expect(config.mac.artifactName).toBe('UniWork-Office_${version}_unsigned_darwin_${arch}.${ext}')
  })

  it('ad-hoc sign the mac app without hardened runtime, notarization or dmg signing', () => {
    const config = loadConfig({ UNIWORK_RELEASE_CHANNEL: 'beta' })
    expect(config.mac.identity).toBe('-')
    expect(config.mac.hardenedRuntime).toBe(false)
    expect(config.mac.notarize).toBe(false)
    expect(config.dmg.sign).toBe(false)
  })

  it('drop the unsigned label and keep real signing once a certificate is configured', () => {
    const config = loadConfig({
      UNIWORK_RELEASE_CHANNEL: 'dev',
      CSC_LINK: 'file:///cert.p12',
      GENOFFICE_WIN_SIGN_MODE: 'test',
    })
    expect(config.nsis.artifactName).toBe('UniWork-Office_${version}_win32_${arch}-setup.${ext}')
    expect(config.mac.artifactName).toBe('UniWork-Office_${version}_darwin_${arch}.${ext}')
    expect(config.mac.identity).toBeUndefined()
    expect(config.mac.notarize).toBe(true)
  })

  it('refuse stable and unknown channels', () => {
    expect(() => loadConfig({ UNIWORK_RELEASE_CHANNEL: 'stable' })).toThrow(/dev, beta/)
    expect(() => loadConfig({ UNIWORK_RELEASE_CHANNEL: 'nightly' })).toThrow(/dev, beta/)
  })

  it('refuse an update feed', () => {
    expect(() =>
      loadConfig({
        UNIWORK_RELEASE_CHANNEL: 'dev',
        GENOFFICE_UPDATE_URL: 'https://updates.example/office',
      }),
    ).toThrow(/GENOFFICE_UPDATE_URL/)
  })

  it('require the <shell version>-<channel>.<n> version at packaging time', async () => {
    const good = `${shellPackage.version}-dev.7`
    await expect(
      withVersion(loadConfig({ UNIWORK_RELEASE_CHANNEL: 'dev' }, good), good).beforePack({
        electronPlatformName: 'linux',
      }),
    ).resolves.toBeUndefined()

    for (const bad of [shellPackage.version, `${shellPackage.version}-beta.7`, '9.9.9-dev.1']) {
      await expect(
        withVersion(loadConfig({ UNIWORK_RELEASE_CHANNEL: 'dev' }, bad), bad).beforePack({
          electronPlatformName: 'linux',
        }),
      ).rejects.toThrow(/release builds need version/)
    }
  })
})

describe('Windows sidecar target', () => {
  const sidecarSource = (config: BuilderConfig) =>
    config.win.extraResources.find((entry) => entry.to === 'native/xlsx-sidecar.exe')?.from

  it('defaults to the MinGW cross-compile output', () => {
    expect(sidecarSource(loadConfig({}))).toContain('/target/x86_64-pc-windows-gnu/release/')
  })

  it('takes the MSVC output on a Windows build host', () => {
    expect(
      sidecarSource(loadConfig({ GENOFFICE_WIN_SIDECAR_TARGET: 'x86_64-pc-windows-msvc' })),
    ).toContain('/target/x86_64-pc-windows-msvc/release/')
  })

  it('refuses other targets', () => {
    expect(() => loadConfig({ GENOFFICE_WIN_SIDECAR_TARGET: 'i686-pc-windows-msvc' })).toThrow(
      /GENOFFICE_WIN_SIDECAR_TARGET/,
    )
  })
})
