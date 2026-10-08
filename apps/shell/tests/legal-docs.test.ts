import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { LEGAL_DOC_FILES, isLegalDoc, legalDocPath, openLegalDoc } from '../src/main/legal-docs'
import legal from '../src/shared/legal.json'

const require = createRequire(import.meta.url)
const shellRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(shellRoot, '../..')
const DOCS = Object.keys(LEGAL_DOC_FILES) as Array<keyof typeof LEGAL_DOC_FILES>

function loadBuilderConfig(): {
  copyright: string
  linux: { maintainer: string; vendor: string }
  extraMetadata: { author: { name: string; email: string }; homepage: string }
  extraResources: Array<{ from: string; to: string }>
} {
  const configModule = { exports: {} as ReturnType<typeof require> }
  runInNewContext(readFileSync(join(shellRoot, 'electron-builder.cjs'), 'utf8'), {
    module: configModule,
    __dirname: shellRoot,
    process: { platform: 'linux', arch: 'x64', env: {} },
    require: (id: string) =>
      id === 'node:fs' ? { ...require(id), existsSync: () => true } : require(id),
  })
  return configModule.exports
}

describe('legal documents', () => {
  it('resolves the .txt copies under Resources/ when packaged', () => {
    const packaged = { packaged: true, resourcesPath: '/r', appPath: '/x/app.asar' }
    expect(legalDocPath('license', packaged)).toBe(join('/r', 'LICENSE.txt'))
    expect(legalDocPath('notice', packaged)).toBe(join('/r', 'NOTICE.txt'))
    expect(legalDocPath('modifications', packaged)).toBe(join('/r', 'MODIFICATIONS.txt'))
    expect(legalDocPath('thirdParty', packaged)).toBe(join('/r', 'THIRD-PARTY-NOTICES.txt'))
    for (const doc of DOCS) expect(LEGAL_DOC_FILES[doc].shipped, doc).toMatch(/\.txt$/)
  })

  it('resolves the repo-root originals in dev', () => {
    const dev = { packaged: false, resourcesPath: '/r', appPath: shellRoot }
    for (const doc of DOCS) {
      if (doc === 'thirdParty') continue
      const path = legalDocPath(doc, dev)!
      expect(path, doc).toBe(join(repoRoot, LEGAL_DOC_FILES[doc].source))
      expect(existsSync(path), doc).toBe(true)
    }
    expect(legalDocPath('thirdParty', dev)).toBe(
      join(shellRoot, 'build', 'THIRD-PARTY-NOTICES.txt'),
    )
  })

  it('accepts only the known documents (no paths, no URLs)', () => {
    const env = { packaged: true, resourcesPath: '/r', appPath: '/a' }
    for (const bad of ['../etc/passwd', 'https://example.com', 'toString', '', null, 1]) {
      expect(isLegalDoc(bad)).toBe(false)
      expect(legalDocPath(bad, env)).toBeNull()
    }
  })

  it('falls back to a temp .txt copy only for an extension-less original', async () => {
    const dev = { packaged: false, resourcesPath: '/r', appPath: '/repo/apps/shell' }
    const opened: string[] = []
    const copies: Array<[string, string]> = []
    const io = (results: string[]) => ({
      openPath: async (path: string) => {
        opened.push(path)
        return results.shift() ?? ''
      },
      exists: () => true,
      copyFile: (from: string, to: string) => void copies.push([from, to]),
      tempDir: () => '/tmp/legal',
    })

    expect(await openLegalDoc('notice', dev, io(['']))).toBe(true)
    expect(copies).toEqual([])

    opened.length = 0
    expect(await openLegalDoc('notice', dev, io(['no app', '']))).toBe(true)
    expect(opened).toEqual([join('/repo', 'NOTICE'), join('/tmp/legal', 'NOTICE.txt')])
    expect(copies).toEqual([[join('/repo', 'NOTICE'), join('/tmp/legal', 'NOTICE.txt')]])

    copies.length = 0
    expect(await openLegalDoc('thirdParty', dev, io(['no app']))).toBe(false)
    expect(copies).toEqual([]) // a .txt that fails is not copied

    expect(await openLegalDoc('notice', dev, { ...io([]), exists: () => false })).toBe(false)
    expect(await openLegalDoc('../NOTICE', dev, io([]))).toBe(false)
  })

  it('ships every legal document as .txt and takes the package identity from legal.json', () => {
    const config = loadBuilderConfig()
    const shipped = new Map(config.extraResources.map((e) => [e.to, e.from]))
    for (const doc of DOCS) {
      const { source, shipped: name } = LEGAL_DOC_FILES[doc]
      expect(shipped.has(name), name).toBe(true)
      if (doc !== 'thirdParty') {
        expect(shipped.get(name)).toBe(`../../${source}`)
        expect(existsSync(join(shellRoot, shipped.get(name)!)), name).toBe(true)
      }
    }
    expect(config.copyright).toBe(`Copyright © ${legal.copyrightYear} ${legal.company}`)
    expect(config.copyright).not.toMatch(/GenOffice|Mainfunc|Genspark/)
    expect(config.linux.maintainer).toBe(`${legal.company} <${legal.email}>`)
    expect(config.linux.vendor).toBe(legal.company)
    expect(config.extraMetadata.author).toEqual({ name: legal.company, email: legal.email })
    expect(config.extraMetadata.homepage).toBe(legal.homepage)
    expect(legal.homepage).not.toMatch(/github/i)
  })

  it('the standalone Docs package ships the same .txt legal files', () => {
    const docs = JSON.parse(readFileSync(join(repoRoot, 'apps/docs/package.json'), 'utf8')) as {
      build: { extraResources: Array<{ from: string; to: string }> }
    }
    const to = docs.build.extraResources.map((e) => e.to)
    for (const doc of ['license', 'notice', 'modifications'] as const) {
      expect(to).toContain(LEGAL_DOC_FILES[doc].shipped)
    }
  })
})
