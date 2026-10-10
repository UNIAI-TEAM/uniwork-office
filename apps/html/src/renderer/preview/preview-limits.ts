/**
 * What the web preview cannot do (UNI-1232 B): its policy is `connect-src 'none'` and `frame-src
 * 'none'`, so a page that asks the network for data (`fetch`, XHR) or embeds another page shows
 * without that content. The desktop preview runs both, so the note exists on the web only
 * (capability `htmlPreviewNetwork` off).
 *
 * A text scan of the source: comments and strings can match, which costs one extra note on a
 * page that only talks about `fetch(`; it never hides a real use.
 */
const NETWORK_USE = /\bfetch\s*\(|\bXMLHttpRequest\b|<iframe\b|<frame(?:set)?\b/i

export function usesBlockedPreviewFeatures(html: string): boolean {
  return NETWORK_USE.test(html)
}
