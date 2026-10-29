/**
 * The AI mount check and the error-body reader of the UniWork AI routes, shared by the web frame
 * (every frame AI fetch, every typed failure) and the desktop shell.
 *
 * UNI-2289: UniWork AI is the only AI, so the BYOK proxy rewriter that once lived here (vendor
 * URLs -> `<ai mount>/byok/<provider>`) is gone; only these two readers are left.
 */

/**
 * `url` is inside `base` (the AI mount or a path below it): same origin and, after the URL parser
 * has collapsed `.` / `..` / `%2e` segments, a path under the mount's. Encoded slashes and
 * backslashes are refused outright (a server may decode them into a different path). A raw string
 * prefix test is not enough: `${base}/../../x` starts with `${base}/` and still leaves the mount.
 */
export function isInsideAiMount(url: string, base: string): boolean {
  let u: URL
  let b: URL
  try {
    u = new URL(url)
    b = new URL(base)
  } catch {
    return false
  }
  if (u.origin !== b.origin || u.username || u.password) return false
  if (/%2f|%5c|\\/i.test(u.pathname)) return false
  return u.pathname === b.pathname || u.pathname.startsWith(`${b.pathname}/`)
}

/**
 * `code` / `message` of a server error body (`{ error: { code, message } }` or flat `{ code, message }`).
 */
export function proxyErrorBodyFields(body: unknown): { code?: string; message?: string } {
  const read = (v: unknown): { code?: string; message?: string } => {
    if (!v || typeof v !== 'object') return {}
    const { code, message } = v as { code?: unknown; message?: unknown }
    return {
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof message === 'string' ? { message } : {}),
    }
  }
  const wrapped = read((body as { error?: unknown } | null | undefined)?.error)
  return wrapped.code !== undefined ? wrapped : read(body)
}
