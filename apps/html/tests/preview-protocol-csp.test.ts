import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (request: { url: string }) => Promise<Response> | Response

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  protocol: {
    handle: (scheme: string, handler: Handler) => handlers.set(scheme, handler),
    registerSchemesAsPrivileged: vi.fn(),
  },
}))
vi.mock('@genoffice/electron-utils', () => ({
  DOCX_MEDIA_SCHEME_PRIVILEGE: { scheme: 'docx-media', privileges: {} },
  RENDERER_SCHEME_PRIVILEGE: { scheme: 'renderer', privileges: {} },
}))

import { registerPreviewProtocol } from '../src/main/preview-protocol'

function directives(response: Response): Record<string, string[]> {
  const header = response.headers.get('Content-Security-Policy')
  expect(header).toBeTruthy()
  return Object.fromEntries(
    (header as string).split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/)
      return [name, sources]
    }),
  )
}

describe('html-preview response policy (G6-09 N4)', () => {
  beforeEach(() => {
    handlers.clear()
    registerPreviewProtocol((id) =>
      id === 7
        ? {
            text: '<html><body><script>fetch("https://x.test")</script></body></html>',
            baseHref: null,
          }
        : null,
    )
  })

  it('sends the policy with the preview document: no network, no nested frames', async () => {
    const handler = handlers.get('html-preview') as Handler
    const response = await handler({ url: 'html-preview://view-7/' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    const csp = directives(response)
    expect(csp['connect-src']).toEqual(["'none'"])
    expect(csp['frame-src']).toEqual(["'none'"])
    expect(csp['form-action']).toEqual(["'none'"])
    expect(csp['default-src']).toEqual(["'none'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['worker-src']).toEqual(["'none'"])
  })

  it('keeps scripts, styles, pictures and relative assets of a normal page working', async () => {
    const handler = handlers.get('html-preview') as Handler
    const csp = directives(await handler({ url: 'html-preview://view-7/' }))
    expect(csp['script-src']).toEqual(
      expect.arrayContaining(["'unsafe-inline'", "'unsafe-eval'", 'https:', 'html-asset:']),
    )
    expect(csp['style-src']).toEqual(
      expect.arrayContaining(["'unsafe-inline'", 'https:', 'html-asset:']),
    )
    expect(csp['img-src']).toEqual(
      expect.arrayContaining(['data:', 'blob:', 'https:', 'html-asset:']),
    )
    expect(csp['font-src']).toEqual(expect.arrayContaining(['data:', 'https:', 'html-asset:']))
    expect(csp['base-uri']).toEqual(expect.arrayContaining(['https:', 'html-asset:']))
    for (const sources of Object.values(csp)) expect(sources).not.toContain("'self'")
  })

  it('sends the same policy on every other response of the scheme', async () => {
    const handler = handlers.get('html-preview') as Handler
    const document = directives(await handler({ url: 'html-preview://view-7/' }))
    const missing = await handler({ url: 'html-preview://view-8/' })
    expect(missing.status).toBe(404)
    expect(directives(missing)).toEqual(document)
    const sub = await handler({ url: 'html-preview://view-7/style.css' })
    expect(directives(sub)).toEqual(document)
    const bad = await handler({ url: 'not a url' })
    expect(bad.status).toBe(400)
    expect(directives(bad)).toEqual(document)
  })
})
