/**
 * Document revisions are int64 on the wire. They travel as decimal strings
 * and compare as bigint, so a revision past 2^53 never loses precision.
 */
export const REVISION = /^\d{1,19}$/

export function compareRevision(a: string, b: string): -1 | 0 | 1 {
  const x = BigInt(a)
  const y = BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}
