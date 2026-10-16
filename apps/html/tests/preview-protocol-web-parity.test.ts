import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
}))
vi.mock('@genoffice/electron-utils', () => ({
  DOCX_MEDIA_SCHEME_PRIVILEGE: { scheme: 'docx-media', privileges: {} },
  RENDERER_SCHEME_PRIVILEGE: { scheme: 'renderer', privileges: {} },
}))

import { buildCspManifest, type CspDirectives } from '../../../web/docs/build/csp'
import { WEB_MODULES } from '../../../web/docs/build/modules'
import { PREVIEW_CONTENT_SECURITY_POLICY } from '../src/main/preview-protocol'

// G6-09 RBG-HTML-2: the desktop policy is the web preview document's policy (preview.html in the
// html module's CSP manifest) plus the one source the desktop needs. Parsed from both sides, so an
// edit to either one alone fails here.

/** the source the desktop adds: relative assets of a page arrive through html-asset:// */
const DESKTOP_SOURCE = 'html-asset:'
/** directives the desktop leaves out on purpose (see the doc comment of the constant) */
const DESKTOP_ABSENT = ['sandbox', 'frame-ancestors']
/** directives whose source list gains DESKTOP_SOURCE: exactly where the page loads assets from */
const DESKTOP_EXTENDED = ['script-src', 'style-src', 'img-src', 'font-src', 'media-src', 'base-uri']

function parse(policy: string): CspDirectives {
  return Object.fromEntries(
    policy.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/)
      return [name, sources]
    }),
  )
}

function webPreviewDocument() {
  const manifest = buildCspManifest({ extra: WEB_MODULES.html.csp })
  const document = manifest.documents?.find((d) => d.path === '/preview.html')
  expect(document, 'the html module ships a /preview.html document policy').toBeTruthy()
  return document!.directives
}

describe('desktop preview policy vs the web preview document (G6-09 RBG-HTML-2)', () => {
  it('is the web policy directive for directive, modulo html-asset: and the two justified absences', () => {
    const web = webPreviewDocument()
    const desktop = parse(PREVIEW_CONTENT_SECURITY_POLICY)

    // the two absences hold on the web side (they exist there) and not on the desktop side
    for (const name of DESKTOP_ABSENT) {
      expect(web[name], `web ${name}`).toBeTruthy()
      expect(desktop[name], `desktop ${name}`).toBeUndefined()
    }

    const expected: CspDirectives = {}
    for (const [name, sources] of Object.entries(web)) {
      if (DESKTOP_ABSENT.includes(name)) continue
      expected[name] = DESKTOP_EXTENDED.includes(name) ? [...sources, DESKTOP_SOURCE] : sources
    }
    expect(desktop).toEqual(expected)
  })

  it('never opens a network, frame, worker or form path the web document keeps shut', () => {
    const web = webPreviewDocument()
    const desktop = parse(PREVIEW_CONTENT_SECURITY_POLICY)
    for (const name of ['connect-src', 'frame-src', 'worker-src', 'object-src', 'form-action']) {
      expect(web[name], `web ${name}`).toEqual(["'none'"])
      expect(desktop[name], `desktop ${name}`).toEqual(["'none'"])
    }
    expect(desktop['default-src']).toEqual(["'none'"])
  })
})
