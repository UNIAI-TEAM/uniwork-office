import { randomBytes } from 'node:crypto'

/**
 * UNI-2510 (UNI-2502 server contract): the `editor_session_id` of a version commit is a ULID the
 * client mints once per opening of an editor. The server parses it strictly (26 Crockford base32
 * characters, first one at most `7` so the 48-bit time part does not overflow) and answers a
 * malformed one with 400 `invalid_editor_session_id`, so only a well-formed id ever leaves the app.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/

export function isEditorSessionId(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value)
}

/** a fresh ULID: 10 characters of millisecond time, 16 characters of randomness */
export function newEditorSessionId(
  now: number = Date.now(),
  random: (size: number) => Uint8Array = randomBytes,
): string {
  let time = Math.max(0, Math.floor(now))
  let head = ''
  for (let i = 0; i < 10; i += 1) {
    head = CROCKFORD[time % 32] + head
    time = Math.floor(time / 32)
  }
  const bytes = random(16)
  let tail = ''
  for (let i = 0; i < 16; i += 1) tail += CROCKFORD[(bytes[i] ?? 0) % 32]
  return head + tail
}
