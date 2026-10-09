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
