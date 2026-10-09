/**
 * Text codec of the text-document modules (Markdown, HTML; GO-B4 G-4).
 *
 * The renderers own the file envelope: apps/markdown/src/renderer/markdown/docText.ts and
 * apps/html/src/renderer/document/envelope.ts keep a leading BOM, the EOL style and the
 * trailing-newline state of the text they are given and write them back on save. So the codec
 * only has to move bytes <-> string without touching any of that:
 *   - decode keeps the BOM as U+FEFF (TextDecoder strips it by default) and the line endings,
 *   - encode is plain UTF-8 (U+FEFF becomes EF BB BF again).
 * An open -> save without edits therefore returns the exact input bytes.
 *
 * Bytes that are not valid UTF-8 cannot round-trip through a string. They are decoded with
 * replacement characters (the document still opens) and the result says so, so the bridge can
 * keep such a file read-only instead of silently rewriting it.
 */

export interface DecodedText {
  text: string
  /** false when the bytes were not valid UTF-8 (saving would not reproduce them) */
  exact: boolean
}

export function decodeText(bytes: ArrayBuffer | Uint8Array): DecodedText {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(view),
      exact: true,
    }
  } catch {
    return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(view), exact: false }
  }
}

/** UTF-8 bytes of `text` in a fresh buffer (transferable: nobody else holds a view on it) */
export function encodeText(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text)
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}
