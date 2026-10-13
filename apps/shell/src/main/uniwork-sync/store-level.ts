/**
 * OQ-P4 option (b): a binding of schema 2 carries `min_store_level` (the store
 * generation it needs) and `min_app_version` (display only). This build is
 * store level 2, so level <= 2 opens and anything newer locks with the S11
 * `store_newer` state. A binding of schema >= 3 belongs to a newer app
 * (unchanged G5-04g rule); schema 1 is this app's own legacy form and opens -
 * the one-way schema 1 -> 2 migration (W3b) owns rewriting it.
 */
export const APP_STORE_LEVEL = 2

export type StoreGate = 'open' | 'store_newer'

/**
 * How this build reads a raw binding.json value. Fields are unknown because
 * the value comes from disk. `min_app_version` is never a gate: two bindings
 * that differ only in their prerelease tail (0.11.0-beta.9 vs 0.11.0-dev.3)
 * decide the same way, and that field is read only for display.
 */
export function readStoreGate(binding: unknown): StoreGate {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return 'store_newer'
  const { schema, min_store_level: level } = binding as {
    schema?: unknown
    min_store_level?: unknown
  }
  if (typeof schema !== 'number' || !Number.isSafeInteger(schema) || schema < 1) {
    return 'store_newer'
  }
  if (schema >= 3) return 'store_newer'
  if (schema === 1) return 'open'
  if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1) {
    return 'store_newer'
  }
  if (level > APP_STORE_LEVEL) return 'store_newer'
  return 'open'
}
