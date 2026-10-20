import type { ShortcutAction } from './types'

/**
 * A module table: the generated rows with the hand-maintained ones applied. A
 * manual row whose id matches a generated one replaces it in place; the rest
 * are appended. Keeps hand edits outside the generator's block, so the table
 * can be regenerated from `shortcuts.csv` without losing them.
 */
export function mergeRows(
  generated: readonly ShortcutAction[],
  manual: readonly ShortcutAction[],
): readonly ShortcutAction[] {
  const overrides = new Map(manual.map((row) => [row.id, row]))
  const merged = generated.map((row) => overrides.get(row.id) ?? row)
  const generatedIds = new Set(generated.map((row) => row.id))
  return [...merged, ...manual.filter((row) => !generatedIds.has(row.id))]
}
