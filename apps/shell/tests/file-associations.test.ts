import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { LAUNCHABLE_EXTS } from '../src/main/launch-paths'
import { OFFICE_TYPES } from '../src/main/default-app'

const require = createRequire(import.meta.url)
// Inspect packaging metadata without downloading Electron or compiling OCR
// helpers (same approach as shell-new.test.ts).
const configModule = { exports: {} as ReturnType<typeof require> }
runInNewContext(readFileSync(resolve(import.meta.dirname, '../electron-builder.cjs'), 'utf8'), {
  module: configModule,
  __dirname: resolve(import.meta.dirname, '..'),
  process: { platform: 'linux', arch: 'x64', env: {} },
  require: (id: string) =>
    id === 'node:fs' ? { ...require(id), existsSync: () => true } : require(id),
})
const config = configModule.exports

describe('packaged file associations', () => {
  // The OS can only offer GenOffice in "Open With" (mac CFBundleDocumentTypes,
  // the Linux desktop MimeType list, the NSIS ProgIds) for types the bundle
  // declares. A routing entry without a matching declaration means a file the
  // app opens fine can never reach it from Finder/Explorer — the .txt/.json
  // gap this closes.
  it('keeps LAUNCHABLE_EXTS and electron-builder fileAssociations in 1-to-1 agreement', () => {
    const declaredExts = config.fileAssociations.map((entry: { ext: string }) => entry.ext)
    expect(new Set(declaredExts)).toEqual(new Set(LAUNCHABLE_EXTS))
    expect(declaredExts).toHaveLength(LAUNCHABLE_EXTS.length)
  })

  it('gives every association the mimeType the Linux desktop entry needs', () => {
    for (const association of config.fileAssociations) {
      expect(
        association.mimeType,
        `.${association.ext} declares no mimeType — the Linux target drops it`,
      ).toBeTruthy()
    }
  })

  it('registers the six OpenDocument formats as rank Alternate with plain descriptions and matching Linux MimeType entries', () => {
    const expectedOdf = [
      {
        ext: 'ods',
        name: 'OpenDocument Spreadsheet',
        description: 'OpenDocument Spreadsheet',
        role: 'Editor',
        rank: 'Alternate',
        icon: 'xlsx',
        mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
      },
      {
        ext: 'ots',
        name: 'OpenDocument Spreadsheet Template',
        description: 'OpenDocument Spreadsheet Template',
        role: 'Editor',
        rank: 'Alternate',
        icon: 'xlsx',
        mimeType: 'application/vnd.oasis.opendocument.spreadsheet-template',
      },
      {
        ext: 'odt',
        name: 'OpenDocument Text',
        description: 'OpenDocument Text',
        role: 'Editor',
        rank: 'Alternate',
        icon: 'docx',
        mimeType: 'application/vnd.oasis.opendocument.text',
      },
      {
        ext: 'ott',
        name: 'OpenDocument Text Template',
        description: 'OpenDocument Text Template',
        role: 'Editor',
        rank: 'Alternate',
        icon: 'docx',
        mimeType: 'application/vnd.oasis.opendocument.text-template',
      },
      {
        ext: 'odp',
        name: 'OpenDocument Presentation',
        description: 'OpenDocument Presentation',
        role: 'Editor',
        rank: 'Alternate',
        icon: 'pptx',
        mimeType: 'application/vnd.oasis.opendocument.presentation',
      },
      {
        ext: 'otp',
        name: 'OpenDocument Presentation Template',
        description: 'OpenDocument Presentation Template',
        role: 'Editor',
        rank: 'Alternate',
        icon: 'pptx',
        mimeType: 'application/vnd.oasis.opendocument.presentation-template',
      },
    ]

    const repoRoot = resolve(import.meta.dirname, '../../..')
    const flatpakDesktop = readFileSync(
      resolve(repoRoot, 'packaging/flatpak/com.genoffice.app.desktop'),
      'utf8',
    )
    const nixRecipe = readFileSync(resolve(repoRoot, 'packaging/nix/genoffice.nix'), 'utf8')
    const flatpakMetainfo = readFileSync(
      resolve(repoRoot, 'packaging/flatpak/com.genoffice.app.metainfo.xml'),
      'utf8',
    )
    const flatpakMimes = (flatpakDesktop.match(/^MimeType=(.+)$/m)?.[1] ?? '')
      .split(';')
      .filter(Boolean)
    const nixMimes = (nixRecipe.match(/^\s*MimeType=(.+)$/m)?.[1] ?? '').split(';').filter(Boolean)

    for (const expected of expectedOdf) {
      expect(LAUNCHABLE_EXTS).toContain(expected.ext)
      const entry = config.fileAssociations.find(
        (item: { ext: string }) => item.ext === expected.ext,
      )
      expect(entry).toEqual(expected)
      expect(flatpakMimes).toContain(expected.mimeType)
      expect(nixMimes).toContain(expected.mimeType)
      expect(flatpakMetainfo).toContain(`<mediatype type="${expected.mimeType}" />`)
      expect(OFFICE_TYPES.some((t) => t.ext === expected.ext || t.mime === expected.mimeType)).toBe(
        false,
      )
    }
  })
})
