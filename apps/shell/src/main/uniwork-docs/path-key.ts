/**
 * The key a path is remembered under: separators are normalized and, on
 * Windows, letter case is ignored, so the same file spelled two ways finds one
 * entry. Electron-free and dependency-free (the renderer keeps its own copy in
 * uniwork-docs-model.ts, which must not import from main).
 */
export function pathKey(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed
}
