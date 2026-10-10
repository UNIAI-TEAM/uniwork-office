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
