import { chordsFor } from './match'
import type { ShortcutAction, ShortcutPlatform, ShortcutSurface, UnmappedShortcut } from './types'

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

/**
 * The generator's unmapped entries minus those a manual row has since filled:
 * an entry for a surface and platform is dropped once the merged table has a
 * chord there (a `webAlt` counts on web). `row` entries and entries for ids the
 * table does not hold stay. Manual entries are not passed through here.
 */
export function pruneUnmapped(
  generated: readonly UnmappedShortcut[],
  table: readonly ShortcutAction[],
): readonly UnmappedShortcut[] {
  const byId = new Map(table.map((row) => [row.id, row]))
  return generated.filter((entry) => {
    const action = byId.get(entry.id)
    if (!action || entry.part === 'row') return true
    const [surface, platform] = entry.part.split('.') as [ShortcutSurface, ShortcutPlatform]
    return chordsFor(action, platform, surface).length === 0
  })
}
