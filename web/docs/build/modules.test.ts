import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs, WEB_MODULE_NAMES as CLI_MODULES } from '../../scripts/build-web.mjs'
import { OFFICE_MODULES } from '../protocol/types'
import { buildCspManifest } from './csp'
import {
  DEFAULT_WEB_MODULE,
  moduleOutDir,
  resolveWebModule,
  WEB_MODULE_NAMES,
  WEB_MODULES,
} from './modules'

const repoRoot = resolve(__dirname, '../../..')

describe('module registry', () => {
  it('has one entry per protocol OfficeModule, and the CLI knows the same list', () => {
    expect([...WEB_MODULE_NAMES]).toEqual([...OFFICE_MODULES])
    expect(CLI_MODULES).toEqual([...WEB_MODULE_NAMES])
    expect(Object.keys(WEB_MODULES)).toEqual([...WEB_MODULE_NAMES])
    for (const [name, spec] of Object.entries(WEB_MODULES)) expect(spec.module).toBe(name)
  })

  it.each(WEB_MODULE_NAMES.filter((m) => m !== 'docs'))(
    '%s: index.html loads the installer first, then the renderer; files exist',
    (m) => {
      const spec = WEB_MODULES[m]
      expect(spec.root).toBe(`web/modules/${m}`)
      for (const f of [spec.installer, spec.renderer, spec.rendererConfig ?? ''])
        expect(existsSync(resolve(repoRoot, f)), f).toBe(true)
      const html = readFileSync(resolve(repoRoot, spec.root, 'index.html'), 'utf8')
      const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((x) =>
        resolve(repoRoot, spec.root, x[1]),
      )
      expect(scripts).toEqual([resolve(repoRoot, spec.installer), resolve(repoRoot, spec.renderer)])
      expect(html).not.toMatch(/Content-Security-Policy"/)
      const installer = readFileSync(resolve(repoRoot, spec.installer), 'utf8')
      expect(installer).toContain(`module: '${m}'`)
      for (const g of spec.globals.filter((x) => x !== 'projectApi'))
        expect(installer).toMatch(new RegExp(`\\b${g}: `))
    },
  )

  it('docs keeps its pre-registry layout (web/docs, no renderer config, no CSP additions)', () => {
    expect(DEFAULT_WEB_MODULE).toBe('docs')
    expect(WEB_MODULES.docs).toMatchObject({ root: 'web/docs', globals: ['desktop', 'projectApi'] })
    expect(WEB_MODULES.docs.rendererConfig).toBeUndefined()
    expect(WEB_MODULES.docs.csp).toBeUndefined()
  })

  it('every CSP addition is valid, explained, and leaves the locked directives alone', () => {
    const base = buildCspManifest()
    for (const spec of Object.values(WEB_MODULES)) {
      const m = buildCspManifest({ extra: spec.csp })
      expect(m.directives['frame-ancestors']).toEqual(["'self'"])
      expect(m.directives['connect-src']).toEqual(["'self'"])
      expect(m.directives['default-src']).toEqual(["'none'"])
      expect(Object.values(m.directives).flat()).not.toContain("'unsafe-eval'")
      if (spec.csp) {
        expect(spec.csp.why.length).toBeGreaterThanOrEqual(Object.keys(spec.csp.directives).length)
        const docs = spec.csp.documents ?? []
        expect(m.notes).toEqual([...base.notes, ...spec.csp.why, ...docs.flatMap((d) => d.why)])
        // a document with its own policy (html preview.html) is sandboxed and offline
        for (const d of m.documents ?? []) {
          expect(d.directives.sandbox).not.toContain('allow-same-origin')
          expect(d.directives['connect-src']).toEqual(["'none'"])
          expect(d.directives['form-action']).toEqual(["'none'"])
          expect(d.directives['frame-ancestors']).toEqual(["'self'"])
          const { 'frame-ancestors': _a, ...own } = d.directives
          expect(Object.values(own).flat()).not.toContain("'self'")
        }
      } else expect(m).toEqual(base)
    }
  })
})

describe('module selection', () => {
  it('argv --module wins over WEB_MODULE; default docs; unknown modules are refused', () => {
    expect(resolveWebModule({}, [])).toBe('docs')
    expect(resolveWebModule({ WEB_MODULE: 'sheets' }, [])).toBe('sheets')
    expect(resolveWebModule({ WEB_MODULE: 'sheets' }, ['--module', 'pdf'])).toBe('pdf')
    expect(resolveWebModule({}, ['--module=html'])).toBe('html')
    expect(() => resolveWebModule({ WEB_MODULE: 'word' }, [])).toThrow(/unknown web module "word"/)
    expect(() => resolveWebModule({}, ['--module'])).toThrow(/unknown web module/)
  })

  it('output: dist-web/<module>/<version>, WEB_DOCS_OUT_DIR still overrides', () => {
    expect(moduleOutDir('/r', 'docs', '0.1.0-abc', {})).toBe('/r/dist-web/docs/0.1.0-abc')
    expect(moduleOutDir('/r', 'slides', '0.1.0-abc', {})).toBe('/r/dist-web/slides/0.1.0-abc')
    expect(moduleOutDir('/r', 'pdf', 'v', { WEB_DOCS_OUT_DIR: 'out/x' })).toBe('/r/out/x')
  })

  it('build-web.mjs: --module / --all / WEB_MODULE, other args pass through to vite', () => {
    expect(parseArgs([], {})).toEqual({ modules: ['docs'], viteArgs: [] })
    expect(parseArgs([], { WEB_MODULE: 'pdf' }).modules).toEqual(['pdf'])
    expect(parseArgs(['--module', 'slides', '--minify', 'false'], {})).toEqual({
      modules: ['slides'],
      viteArgs: ['--minify', 'false'],
    })
    expect(parseArgs(['--module=sheets'], {}).modules).toEqual(['sheets'])
    expect(parseArgs(['--all'], {}).modules).toEqual([...WEB_MODULE_NAMES])
    expect(() => parseArgs(['--module', 'exe'], {})).toThrow(/unknown web module "exe"/)
    expect(() => parseArgs(['--all'], { WEB_DOCS_OUT_DIR: 'x' })).toThrow(/WEB_DOCS_OUT_DIR/)
  })
})
