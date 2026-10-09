import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fontBuildOptions } from './plugin'
import { assertSafeVersion, formatVersion, resolveVersion } from './version'

let dir = ''
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

describe('version', () => {
  it('is package version + short sha, marked when dirty', () => {
    expect(formatVersion('0.1.0', '4a70857', false)).toBe('0.1.0-4a70857')
    expect(formatVersion('0.1.0', '4a70857', true)).toBe('0.1.0-4a70857-dirty')
  })

  it('refuses versions that cannot be a safe path / URL segment', () => {
    for (const bad of ['', '../x', 'a/b', 'a b', 'a..b', '.hidden', 'x'.repeat(65), 'a?b'])
      expect(() => assertSafeVersion(bad)).toThrow()
    expect(assertSafeVersion('1.2.3-abc1234')).toBe('1.2.3-abc1234')
  })

  it('resolves from package.json + env overrides outside a git checkout', () => {
    dir = mkdtempSync(join(tmpdir(), 'web-docs-version-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '2.3.4' }))
    expect(resolveVersion(dir, {})).toEqual({
      version: '2.3.4-nogit',
      packageVersion: '2.3.4',
      gitSha: 'nogit',
      dirty: false,
    })
    expect(resolveVersion(dir, { WEB_DOCS_GIT_SHA: 'deadbee' })).toMatchObject({
      version: '2.3.4-deadbee',
      dirty: false,
    })
    expect(resolveVersion(dir, { WEB_DOCS_VERSION: 'release-7' })).toMatchObject({
      version: 'release-7',
      packageVersion: '2.3.4',
    })
  })
})

describe('font build options (lazy fonts)', () => {
  it('never inlines font files into the CSS as data: URIs', () => {
    for (const f of ['a.ttf', 'b.woff2', 'c.WOFF', 'd.otf'])
      expect(fontBuildOptions.assetsInlineLimit(f)).toBe(false)
    // other assets keep Vite's default decision
    expect(fontBuildOptions.assetsInlineLimit('icon.png')).toBeUndefined()
  })

  it('emits fonts under fonts/, everything else under assets/', () => {
    expect(fontBuildOptions.assetFileNames({ names: ['Carlito-Regular.ttf'] })).toBe(
      'fonts/[name]-[hash][extname]',
    )
    expect(fontBuildOptions.assetFileNames({ name: 'x.woff2' })).toBe(
      'fonts/[name]-[hash][extname]',
    )
    expect(fontBuildOptions.assetFileNames({ names: ['index.css'] })).toBe(
      'assets/[name]-[hash][extname]',
    )
  })
})
