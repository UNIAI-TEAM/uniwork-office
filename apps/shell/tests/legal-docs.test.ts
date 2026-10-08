import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { LEGAL_DOC_FILES, isLegalDoc, legalDocPath } from '../src/main/legal-docs'
import legal from '../src/shared/legal.json'

const require = createRequire(import.meta.url)
const shellRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(shellRoot, '../..')

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
  it('resolves under Resources/ when packaged and in the checkout in dev', () => {
    const packaged = { packaged: true, resourcesPath: '/r', appPath: '/x/app.asar' }
    expect(legalDocPath('notice', packaged)).toBe(join('/r', 'NOTICE'))
    expect(legalDocPath('thirdParty', packaged)).toBe(join('/r', 'THIRD-PARTY-NOTICES.txt'))
    const dev = { packaged: false, resourcesPath: '/r', appPath: shellRoot }
    for (const doc of Object.keys(LEGAL_DOC_FILES)) {
      if (doc === 'thirdParty') continue
      const path = legalDocPath(doc, dev)!
      expect(path, doc).toBe(join(repoRoot, LEGAL_DOC_FILES[doc as keyof typeof LEGAL_DOC_FILES]))
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

  it('ships every legal document and takes the package identity from legal.json', () => {
    const config = loadBuilderConfig()
    const shipped = new Map(config.extraResources.map((e) => [e.to, e.from]))
    for (const name of Object.values(LEGAL_DOC_FILES)) {
      expect(shipped.has(name), name).toBe(true)
      if (name !== 'THIRD-PARTY-NOTICES.txt') {
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
})
