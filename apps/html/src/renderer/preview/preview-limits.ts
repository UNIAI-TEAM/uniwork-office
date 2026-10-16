/**
 * What the preview cannot do (UNI-1232 B, G6-09 N4): the web preview.html and the desktop
 * html-preview:// document both carry `connect-src 'none'` and `frame-src 'none'`, so a page that
 * asks the network for data (`fetch`, XHR) or embeds another page shows without that content. The
 * note says so on both hosts (the wording differs: the web one offers to open the app).
 *
 * A text scan of the source: comments and strings can match, which costs one extra note on a
 * page that only talks about `fetch(`; it never hides a real use.
 */
const NETWORK_USE = /\bfetch\s*\(|\bXMLHttpRequest\b|<iframe\b|<frame(?:set)?\b/i

export function usesBlockedPreviewFeatures(html: string): boolean {
  return NETWORK_USE.test(html)
}
