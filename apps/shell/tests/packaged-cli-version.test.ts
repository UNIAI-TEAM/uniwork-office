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
const CLI_BUNDLE_REL = '../../packages/cli/dist/genoffice.cjs'

interface Rebuild {
  script: string
  appVersion: string | undefined
}

interface LibreOfficeCall {
  target: string
}

/**
 * The real beforePack also makes sure the LibreOffice pack exists and downloads
 * it when the cache is cold, which has nothing to do with the CLI version and
 * made these tests depend on the network. The loader serves a stand-in for that
 * one step and records each call, so every beforePack run can prove it stayed on
 * the stand-in (a future change that reaches the real download fails the assert
 * instead of timing out).
 */
function expectLibreOfficeStubbed(calls: LibreOfficeCall[]): void {
  expect(calls).toEqual([{ target: 'linux-x64' }])
}

/**
 * Loads the real packaging config and drives its beforePack hook with a stand-in
 * CLI bundle: `rebuiltWith` is the version the fake rebuild bakes in, so the hook
 * sees exactly what a real GENOFFICE_APP_VERSION rebuild would leave behind.
 */
function loadConfig(opts: {
  baked: string
  extraMetadataVersion?: string
  rebuildApplies?: boolean
}): {
  config: { beforePack: (context: { electronPlatformName: string }) => Promise<void> }
  rebuilds: Rebuild[]
  libreOfficeCalls: LibreOfficeCall[]
} {
  const rebuilds: Rebuild[] = []
  const libreOfficeCalls: LibreOfficeCall[] = []
  let baked = opts.baked
  const configModule = { exports: {} as Record<string, unknown> }
  runInNewContext(readFileSync(resolve(shellRoot, 'electron-builder.cjs'), 'utf8'), {
    module: configModule,
    __dirname: shellRoot,
    process: { platform: 'linux', arch: 'x64', env: {}, execPath: '/usr/bin/node' },
    require: (id: string) => {
      if (id === './package.json') return shellPackage
      if (id === 'node:child_process') {
        return {
          execFileSync: (_file: string, args: string[], runOpts: { env?: NodeJS.ProcessEnv }) => {
            rebuilds.push({ script: args[0], appVersion: runOpts.env?.GENOFFICE_APP_VERSION })
            if (opts.rebuildApplies !== false) baked = runOpts.env?.GENOFFICE_APP_VERSION ?? baked
            return Buffer.from('')
          },
        }
      }
      if (id === 'node:fs') {
        return {
          ...require(id),
          existsSync: () => true,
          readFileSync: (path: string, encoding: string) => {
            if (String(path).endsWith('genoffice.cjs')) {
              return `const __cliAppVersion = ${JSON.stringify(baked)};\n`
            }
            // Packaging also gates on a generated third-party notice. Serve a
            // valid one so the CLI version check is what these tests exercise.
            if (String(path).endsWith('THIRD-PARTY-NOTICES.txt')) {
              return '@embedpdf/pdfium\nCopyright 2014 PDFium Authors\nApache License\ntesseract.js-core\ntessdata_fast\nLeptonica\nPNG Reference Library License\nJean-loup Gailly\nIndependent JPEG Group\nGIFLIB\nSam Leffler\nGoogle Inc.\nOpenLibm\nLibreOffice 26.8.2.2\nMozilla Public License Version 2.0\nhttps://downloadarchive.documentfoundation.org/libreoffice/old/26.8.2.2/src/\nBitstream Vera\n'
            }
            return require('node:fs').readFileSync(path, encoding as BufferEncoding)
          },
        }
      }
      if (id.replace(/\\/g, '/').endsWith('build/prepare-libreoffice.cjs')) {
        return {
          ...require(id),
          // Report the pack as missing so the hook always takes the download path,
          // then record the request instead of fetching anything.
          isPackValid: () => false,
          ensureLibreOfficePack: async (target: string) => {
            libreOfficeCalls.push({ target })
          },
        }
      }
      return require(id)
    },
  })
  const config = configModule.exports as {
    beforePack: (context: { electronPlatformName: string }) => Promise<void>
    extraMetadata?: { version?: string }
  }
  if (opts.extraMetadataVersion) {
    config.extraMetadata = { ...(config.extraMetadata ?? {}), version: opts.extraMetadataVersion }
  }
  return { config, rebuilds, libreOfficeCalls }
}

describe('packaged CLI version agreement', () => {
  it('rebuilds the CLI bundle with the app version when the two disagree', async () => {
    const { config, rebuilds, libreOfficeCalls } = loadConfig({ baked: '9.9.9' })
    await config.beforePack({ electronPlatformName: 'linux' })
    expectLibreOfficeStubbed(libreOfficeCalls)
    expect(rebuilds).toHaveLength(1)
    expect(rebuilds[0].script.replace(/\\/g, '/').endsWith('packages/cli/build.mjs')).toBe(true)
    expect(rebuilds[0].appVersion).toBe(shellPackage.version)
  })

  it('uses the release version electron-builder injects into extraMetadata', async () => {
    const { config, rebuilds, libreOfficeCalls } = loadConfig({
      baked: shellPackage.version,
      extraMetadataVersion: '0.5.149',
    })
    await config.beforePack({ electronPlatformName: 'linux' })
    expectLibreOfficeStubbed(libreOfficeCalls)
    expect(rebuilds).toHaveLength(1)
    expect(rebuilds[0].appVersion).toBe('0.5.149')
  })

  it('leaves an already matching bundle alone', async () => {
    const { config, rebuilds, libreOfficeCalls } = loadConfig({ baked: shellPackage.version })
    await config.beforePack({ electronPlatformName: 'linux' })
    expectLibreOfficeStubbed(libreOfficeCalls)
    expect(rebuilds).toEqual([])
  })

  it('fails the package when the bundle still disagrees after the rebuild', async () => {
    const { config, rebuilds, libreOfficeCalls } = loadConfig({
      baked: '9.9.9',
      rebuildApplies: false,
    })
    await expect(config.beforePack({ electronPlatformName: 'linux' })).rejects.toThrow(
      /but the app ships/,
    )
    expectLibreOfficeStubbed(libreOfficeCalls)
    expect(rebuilds).toHaveLength(1)
  })

  it('packages the CLI bundle whose version the check reads', () => {
    const { config } = loadConfig({ baked: shellPackage.version })
    const shipped = (config as unknown as { extraResources: Array<{ from: string }> })
      .extraResources
    expect(shipped.some((entry) => entry.from === CLI_BUNDLE_REL)).toBe(true)
  })
})
