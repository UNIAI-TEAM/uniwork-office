/**
 * The key a path is remembered under: separators are normalized and, on
 * Windows, letter case is ignored, so the same file spelled two ways finds one
 * entry. Shared by the main process (the S11 lock map) and the renderer (the
 * lock panel), so both key a path identically and a dismissal reaches the entry
 * the push created. Electron-free and dependency-free.
 */
export function pathKey(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed
}
