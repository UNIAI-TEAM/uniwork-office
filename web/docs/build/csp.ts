/**
 * Content-Security-Policy the Docs frame needs, delivered to the host as data (csp.json /
 * headers.json next to manifest.json). The frame must be served with this as an HTTP header on
 * index.html: a <meta> CSP cannot carry frame-ancestors and is lost if the document is ever
 * embedded differently, so index.html carries none.
 *
 * Why each source (all verified against the built bundle + web/e2e under this exact header):
 *  - script-src 'self'      one module bundle, no inline script, no eval (the single `new Function`
 *                            in the bundle is jszip's setImmediate polyfill for string callbacks, never hit)
 *  - style-src 'unsafe-inline'  ProseMirror/React set inline style attributes and the renderer injects
 *                            <style> text for document styles; nonces are not possible for those
 *  - img-src data: blob:    document images and clipboard/pasted images are data: / blob: URLs
 *  - font-src 'self'        every bundled face is a hashed file under fonts/ (build never inlines fonts
 *                            as data: URIs); embedded docx fonts go through the FontFace(ArrayBuffer) API
 *  - connect-src 'self'     the bridge only talks to the same origin (UniWork API). NO data:/blob:
 *                            (the clipboard path decodes data: URLs by hand, see bridge/browser.ts);
 *                            another API origin is added via WEB_DOCS_CSP_CONNECT_SRC
 *  - worker-src 'self'      no worker is created today; blob: workers are deliberately not allowed
 *  - frame-src 'none'       the frame embeds nothing
 *  - frame-ancestors 'self' only the same-origin UniWork page may embed the frame
 */

export interface CspOptions {
  /** extra connect-src origins (e.g. a separate API origin). Default: none, same-origin only. */
  connectSrc?: string[]
  /** extra frame-ancestors origins (e.g. when the frame moves to its own subdomain). Default: 'self' only. */
  frameAncestors?: string[]
}

export type CspDirectives = Record<string, string[]>

/** Env form: `WEB_DOCS_CSP_CONNECT_SRC="https://api.example.com https://x.example.com"` (space or comma separated) */
export function cspOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): CspOptions {
  const list = (v?: string) => (v ?? '').split(/[\s,]+/).filter(Boolean)
  return {
    connectSrc: list(env.WEB_DOCS_CSP_CONNECT_SRC),
    frameAncestors: list(env.WEB_DOCS_CSP_FRAME_ANCESTORS),
  }
}

function assertSource(src: string): string {
  // a source expression is one token: reject separators that would smuggle in a second directive
  if (!src || /[;,\s'"]/.test(src)) throw new Error(`invalid CSP source "${src}"`)
  return src
}

export function buildCspDirectives(opts: CspOptions = {}): CspDirectives {
  const connect = (opts.connectSrc ?? []).map(assertSource)
  const ancestors = (opts.frameAncestors ?? []).map(assertSource)
  return {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...connect],
    'worker-src': ["'self'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'", ...ancestors],
  }
}

export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')
}

export interface CspManifest {
  schemaVersion: 1
  header: 'Content-Security-Policy'
  /** the exact header value */
  value: string
  directives: CspDirectives
  /** build-relative paths the header must be sent with (documents; assets do not need it) */
  appliesTo: string[]
  notes: string[]
}

export function buildCspManifest(opts: CspOptions = {}): CspManifest {
  const directives = buildCspDirectives(opts)
  return {
    schemaVersion: 1,
    header: 'Content-Security-Policy',
    value: serializeCsp(directives),
    directives,
    appliesTo: ['/index.html'],
    notes: [
      'Send as an HTTP response header on index.html. index.html deliberately has no <meta> CSP.',
      "frame-ancestors 'self': the frame is embedded by a same-origin UniWork page. Moving the frame to its own origin only needs WEB_DOCS_CSP_FRAME_ANCESTORS=<host origin> at build time.",
      "connect-src has no data:/blob:. If the host's API lives on another origin, add it with WEB_DOCS_CSP_CONNECT_SRC.",
    ],
  }
}

export interface HeaderRule {
  /** build-relative path: exact, `/dir/**` prefix, or `/**` */
  source: string
  headers: Record<string, string>
}

export interface HeadersManifest {
  schemaVersion: 1
  /** the build lives in an immutable, version-named directory: hashed assets can be cached forever */
  rules: HeaderRule[]
}

/** First matching rule wins per header name (specific rules first). Paths are relative to the version directory. */
export function buildHeadersManifest(csp: CspManifest): HeadersManifest {
  return {
    schemaVersion: 1,
    rules: [
      {
        source: '/index.html',
        headers: { [csp.header]: csp.value, 'Cache-Control': 'no-cache' },
      },
      { source: '/assets/**', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
      { source: '/fonts/**', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
      {
        source: '/**',
        headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
      },
    ],
  }
}
