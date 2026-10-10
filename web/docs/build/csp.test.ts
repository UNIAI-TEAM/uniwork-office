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
