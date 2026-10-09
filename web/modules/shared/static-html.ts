/**
 * Static copy of an HTML document for the web preview / print (lane decision P1, GO-B4 H-1).
 *
 * The preview iframe is `srcdoc` + `sandbox=""` (no scripts, no same-origin, no forms, no popups)
 * and inherits the frame's CSP (img-src 'self' data: blob:, font-src 'self', frame-src 'none',
 * default-src 'none'). The sandbox alone already stops scripts, but the document would still try
 * to run them, fetch remote images/fonts/stylesheets, refresh or navigate, and every one of those
 * attempts is a console error or a CSP violation report in the host. So the copy keeps only what
 * a static rendering can use:
 *   - removed: <script>, <noscript>, <iframe>/<frame>/<frameset>, <object>/<embed>/<applet>,
 *     <portal>, <base>, every <meta http-equiv> (refresh, CSP, cookies), <link> except a
 *     stylesheet mapped to a document asset, every `on*` handler attribute, `srcset`, `ping`,
 *     `formaction`/`action`;
 *   - URLs (src, href of svg <image>/<use>, poster, background, CSS url()): kept when data:image
 *     (img-src allows it) or a document asset mapped by the host (same-origin), otherwise dropped,
 *     so nothing leaves the frame and no relative path 404s against the frame's own URL;
 *   - links: `href` becomes "#" (a click in the sandbox must not navigate the preview to a remote
 *     page or a javascript: URL); an http(s) target is kept in `data-gx-href` + the hover title.
 * The saved text is never touched: this only builds the copy shown in the iframe.
 */

export type AssetResolver = (src: string) => string | null

const DROP_ELEMENTS = [
  'script',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'base',
  'meta[http-equiv]',
]

const URL_ATTRS = ['src', 'poster', 'background', 'data', 'lowsrc', 'dynsrc']
const DROP_ATTRS = ['srcset', 'imagesrcset', 'ping', 'formaction', 'action', 'manifest', 'codebase']

function isDataImage(url: string): boolean {
  return /^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)[;,]/i.test(url.trim())
}

/** the URL a static copy may load for `url`, or null to drop it */
function allowedUrl(url: string, resolve: AssetResolver): string | null {
  const value = url.trim()
  if (!value) return null
  if (isDataImage(value)) return value
  // a scheme or a protocol-relative URL that is not a mapped asset leaves the frame
  return resolve(value)
}

/** CSS text with every url(...) that is not allowed blanked and @import rules removed */
export function staticCss(css: string, resolve: AssetResolver): string {
  return css
    .replace(/@import\s+[^;]+;?/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q: string, url: string) => {
      const ok = allowedUrl(url, resolve)
      return ok ? `url("${ok.replace(/"/g, '%22')}")` : 'none'
    })
}

export function toStaticHtml(html: string, resolve: AssetResolver = () => null): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.querySelectorAll(DROP_ELEMENTS.join(','))) el.remove()
  for (const link of doc.querySelectorAll('link')) {
    const href = link.getAttribute('href') ?? ''
    const ok = /\bstylesheet\b/i.test(link.getAttribute('rel') ?? '') ? resolve(href) : null
    if (ok) {
      link.setAttribute('href', ok)
      link.removeAttribute('integrity')
    } else link.remove()
  }
  for (const style of doc.querySelectorAll('style')) {
    style.textContent = staticCss(style.textContent ?? '', resolve)
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || DROP_ATTRS.includes(name)) {
        el.removeAttribute(attr.name)
      } else if (name === 'style') {
        el.setAttribute('style', staticCss(attr.value, resolve))
      } else if (URL_ATTRS.includes(name)) {
        const ok = allowedUrl(attr.value, resolve)
        if (ok) el.setAttribute(attr.name, ok)
        else el.removeAttribute(attr.name)
      } else if (name === 'href' || name === 'xlink:href') {
        const tag = el.tagName.toLowerCase()
        // <link> was settled above (mapped stylesheet or removed)
        if (tag === 'link') continue
        if (tag === 'a' || tag === 'area') {
          if (!attr.value.startsWith('#')) {
            // the target stays readable on hover; script URLs are not kept at all
            if (/^\s*https?:/i.test(attr.value)) {
              el.setAttribute('data-gx-href', attr.value)
              if (!el.hasAttribute('title')) el.setAttribute('title', attr.value)
            }
            el.setAttribute(attr.name, '#')
          }
          el.removeAttribute('target')
        } else if (!attr.value.startsWith('#')) {
          // svg <image>/<use>/<feImage> and friends: a resource load
          const ok = allowedUrl(attr.value, resolve)
          if (ok) el.setAttribute(attr.name, ok)
          else el.removeAttribute(attr.name)
        }
      }
    }
  }
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : '<!doctype html>'
  return `${doctype}\n${doc.documentElement.outerHTML}`
}
