import {
  SHARE_PRINCIPAL_TYPES,
  type ShareRejectedCode,
  type ShareRejectedItem,
  type SharePrincipalType,
} from '../../shared/share-api'

/**
 * UNI-2047 SD-A: `fields.rejected` of a `document_access_rejected` answer, the
 * per-item refusals of an access update. Its own module because `errors.ts`
 * keeps the list on the error (and `share-parse.ts` already imports `errors.ts`).
 * Whatever is not a list is an empty list; an entry that cannot be read is dropped.
 */
export function parseRejectedItems(raw: unknown): ShareRejectedItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry): ShareRejectedItem[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
    const index = row.index
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return []
    const principalType = row.principal_type
    if (
      typeof principalType !== 'string' ||
      !(SHARE_PRINCIPAL_TYPES as readonly string[]).includes(principalType)
    ) {
      return []
    }
    if (typeof row.principal_id !== 'string' || row.principal_id.length === 0) return []
    if (typeof row.code !== 'string') return []
    return [
      {
        index,
        principalType: principalType as SharePrincipalType,
        principalId: row.principal_id,
        // narrowed for readers like the web's type; an unknown code still arrives, so branch with a default
        code: row.code as ShareRejectedCode,
      },
    ]
  })
}
