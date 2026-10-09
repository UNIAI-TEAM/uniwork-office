import { describe, expect, it } from 'vitest'
import {
  buildCspDirectives,
  buildCspManifest,
  buildHeadersManifest,
  cspOptionsFromEnv,
  serializeCsp,
} from './csp'

describe('csp', () => {
  const m = buildCspManifest()

  it('is a closed, same-origin policy for the frame', () => {
    expect(m.header).toBe('Content-Security-Policy')
    expect(m.directives['default-src']).toEqual(["'none'"])
    expect(m.directives['script-src']).toEqual(["'self'"])
    expect(m.directives['font-src']).toEqual(["'self'"])
    expect(m.directives['connect-src']).toEqual(["'self'"])
    expect(m.directives['frame-ancestors']).toEqual(["'self'"])
    expect(m.directives['object-src']).toEqual(["'none'"])
    expect(m.directives['base-uri']).toEqual(["'self'"])
  })

  it('never allows eval, remote scripts or data:/blob: network access (clipboard data: URL case)', () => {
    const all = Object.values(m.directives).flat()
    expect(all).not.toContain("'unsafe-eval'")
    expect(all).not.toContain('*')
    expect(m.directives['script-src']).not.toContain("'unsafe-inline'")
    expect(
      m.directives['connect-src'].some((s) => s.startsWith('data:') || s.startsWith('blob:')),
    ).toBe(false)
    // images are the only data:/blob: consumers
    expect(m.directives['img-src']).toEqual(expect.arrayContaining(['data:', 'blob:']))
  })

  it('value is the serialization of directives, one directive per segment', () => {
    expect(m.value).toBe(serializeCsp(m.directives))
    expect(m.value).toContain("frame-ancestors 'self'")
    expect(m.value.split('; ').length).toBe(Object.keys(m.directives).length)
  })

  it('adds extra connect-src / frame-ancestors origins (frame moved to another origin)', () => {
    const d = buildCspDirectives({
      connectSrc: ['https://api.example.com'],
      frameAncestors: ['https://app.example.com'],
    })
    expect(d['connect-src']).toEqual(["'self'", 'https://api.example.com'])
    expect(d['frame-ancestors']).toEqual(["'self'", 'https://app.example.com'])
  })

  it('rejects sources that would inject another directive', () => {
    expect(() => buildCspDirectives({ connectSrc: ['https://a.example; script-src *'] })).toThrow(
      /invalid CSP source/,
    )
    expect(() => buildCspDirectives({ connectSrc: ['a,b'] })).toThrow()
  })

  it('reads options from env (space or comma separated)', () => {
    expect(
      cspOptionsFromEnv({
        WEB_DOCS_CSP_CONNECT_SRC: 'https://a.example, https://b.example',
        WEB_DOCS_CSP_FRAME_ANCESTORS: '',
      }),
    ).toEqual({
      connectSrc: ['https://a.example', 'https://b.example'],
      frameAncestors: [],
    })
  })

  it('headers manifest sends the same CSP on index.html, immutable cache on hashed assets', () => {
    const h = buildHeadersManifest(m)
    const index = h.rules.find((r) => r.source === '/index.html')
    expect(index?.headers['Content-Security-Policy']).toBe(m.value)
    expect(index?.headers['Cache-Control']).toBe('no-cache')
    expect(h.rules.find((r) => r.source === '/assets/**')?.headers['Cache-Control']).toMatch(
      /immutable/,
    )
    expect(h.rules.find((r) => r.source === '/fonts/**')?.headers['Cache-Control']).toMatch(
      /immutable/,
    )
    // the catch-all comes last so specific rules win
    expect(h.rules.at(-1)?.source).toBe('/**')
  })
})

describe('csp module additions (GO-B4/B5/B6)', () => {
  it('appends sources, creates missing directives, drops a replaced none, adds notes', () => {
    const m = buildCspManifest({
      extra: {
        directives: {
          'script-src': ["'wasm-unsafe-eval'"],
          'media-src': ["'self'", 'blob:'],
          'frame-src': ['blob:'],
        },
        why: ['because'],
      },
    })
    expect(m.directives['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(m.directives['media-src']).toEqual(["'self'", 'blob:'])
    expect(m.directives['frame-src']).toEqual(['blob:'])
    expect(m.value).toContain("script-src 'self' 'wasm-unsafe-eval';")
    expect(m.notes.at(-1)).toBe('because')
  })

  it('refuses to widen locked directives or smuggle sources', () => {
    const extra = (directives: Record<string, string[]>) => () =>
      buildCspDirectives({ extra: { directives, why: [] } })
    expect(extra({ 'frame-ancestors': ['https://evil.test'] })).toThrow(/cannot widen/)
    expect(extra({ 'connect-src': ['*'] })).toThrow(/cannot widen/)
    expect(extra({ 'script-src': ["'unsafe-eval'"] })).toThrow(/invalid CSP source/)
    expect(extra({ 'img-src': ['x; script-src *'] })).toThrow(/invalid CSP source/)
    expect(extra({ 'Bad Name': ["'self'"] })).toThrow(/invalid CSP directive/)
  })
})

describe('per-module header rules (GO-B4/B5/B6)', () => {
  it('docs: unchanged rules without options', () => {
    const h = buildHeadersManifest(buildCspManifest())
    expect(h.rules.map((r) => r.source)).toEqual(['/index.html', '/assets/**', '/fonts/**', '/**'])
  })

  it('alsoOn sends the policy on more paths; immutableDirs adds cache rules', () => {
    const csp = buildCspManifest({
      extra: { directives: {}, alsoOn: ['/assets/**'], why: [] },
    })
    expect(csp.appliesTo).toEqual(['/index.html', '/assets/**'])
    const h = buildHeadersManifest(csp, { immutableDirs: ['pdfjs'] })
    expect(h.rules.map((r) => r.source)).toEqual([
      '/index.html',
      '/assets/**',
      '/assets/**',
      '/fonts/**',
      '/pdfjs/**',
      '/**',
    ])
    expect(h.rules[1].headers).toEqual({ 'Content-Security-Policy': csp.value })
    expect(h.rules[4].headers['Cache-Control']).toContain('immutable')
  })

  it('refuses odd paths', () => {
    expect(() =>
      buildCspManifest({ extra: { directives: {}, alsoOn: ['/../x/**'], why: [] } }),
    ).toThrow(/invalid headers.json source/)
    expect(() => buildHeadersManifest(buildCspManifest(), { immutableDirs: ['../x'] })).toThrow(
      /invalid dir/,
    )
  })
})

describe('documents with their own sandboxed policy (html preview, UNI-1014)', () => {
  const preview = {
    path: '/preview.html',
    directives: {
      'default-src': ["'none'"],
      'script-src': ["'unsafe-inline'", "'unsafe-eval'", 'https:'],
      'connect-src': ["'none'"],
      'form-action': ["'none'"],
      sandbox: ['allow-scripts', 'allow-popups'],
    },
    why: ['preview: why'],
  }

  it('builds the policy (+ the frame ancestors), lists it in csp.json, serves it first', () => {
    const csp = buildCspManifest({
      frameAncestors: ['https://app.example'],
      extra: { directives: { 'frame-src': ["'self'"] }, why: ['frame why'], documents: [preview] },
    })
    expect(csp.directives['frame-src']).toEqual(["'self'"])
    expect(csp.documents).toEqual([
      {
        path: '/preview.html',
        directives: { ...preview.directives, 'frame-ancestors': ["'self'", 'https://app.example'] },
        value:
          "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; connect-src 'none'; form-action 'none'; sandbox allow-scripts allow-popups; frame-ancestors 'self' https://app.example",
      },
    ])
    expect(csp.notes.slice(-2)).toEqual(['frame why', 'preview: why'])
    const h = buildHeadersManifest(csp)
    expect(h.rules[0]).toEqual({
      source: '/preview.html',
      headers: { 'Content-Security-Policy': csp.documents![0].value, 'Cache-Control': 'no-cache' },
    })
    expect(h.rules[1].source).toBe('/index.html')
    // without documents csp.json stays as it was
    expect('documents' in buildCspManifest()).toBe(false)
  })

  it('refuses a document policy that is not opaque, names self, or opens the network', () => {
    const build = (d: { path?: string; directives: Record<string, string[]> }) =>
      buildCspManifest({ extra: { directives: {}, why: [], documents: [{ ...preview, ...d }] } })
    const { sandbox: _s, ...noSandbox } = preview.directives
    expect(() => build({ directives: noSandbox })).toThrow(/must carry a sandbox/)
    for (const flag of [
      'allow-same-origin',
      'allow-top-navigation',
      'allow-top-navigation-by-user-activation',
      'allow-popups-to-escape-sandbox',
    ])
      expect(() => build({ directives: { ...preview.directives, sandbox: [flag] } })).toThrow(
        /not allowed/,
      )
    expect(() => build({ directives: { ...preview.directives, 'img-src': ["'self'"] } })).toThrow(
      /cannot name 'self'/,
    )
    expect(() =>
      build({ directives: { ...preview.directives, 'connect-src': ['https:'] } }),
    ).toThrow(/connect-src must be 'none'/)
    expect(() =>
      build({ directives: { ...preview.directives, 'form-action': ['https:'] } }),
    ).toThrow(/form-action must be 'none'/)
    expect(() =>
      build({ directives: { ...preview.directives, 'frame-ancestors': ['*'] } }),
    ).toThrow(/frame-ancestors/)
    expect(() => build({ path: '/index.html', directives: preview.directives })).toThrow(
      /one file other than index.html/,
    )
    expect(() => build({ path: '/a/**', directives: preview.directives })).toThrow(/one file/)
    expect(() =>
      build({ directives: { ...preview.directives, 'script-src': ['https:;x'] } }),
    ).toThrow(/invalid CSP source/)
  })
})
