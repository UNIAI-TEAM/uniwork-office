/**
 * Byte helpers for the session core. Node's Buffer is not available in the web frame,
 * so base64 and UTF-8 go through these instead; they produce the same output as the
 * Buffer calls they replace (Buffer.from(b64, 'base64') leniency included).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DECODE = new Int16Array(128).fill(-1)
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i
// Buffer also accepts the URL-safe alphabet
DECODE['-'.charCodeAt(0)] = 62
DECODE['_'.charCodeAt(0)] = 63

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  const n = bytes.length
  let i = 0
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out +=
      ALPHABET[v >> 18]! + ALPHABET[(v >> 12) & 63]! + ALPHABET[(v >> 6) & 63]! + ALPHABET[v & 63]!
  }
  if (i < n) {
    const v = (bytes[i]! << 16) | (i + 1 < n ? bytes[i + 1]! << 8 : 0)
    out += ALPHABET[v >> 18]! + ALPHABET[(v >> 12) & 63]!
    out += i + 1 < n ? ALPHABET[(v >> 6) & 63]! + '=' : '=='
  }
  return out
}

/** Decode base64 like Buffer.from(s, 'base64'): skips characters outside the alphabet, stops at '='. */
export function base64ToBytes(b64: string): Uint8Array {
  const out = new Uint8Array(Math.floor((b64.length * 3) / 4))
  let len = 0
  let acc = 0
  let bits = 0
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i)
    if (c === 61) break // '='
    const v = c < 128 ? DECODE[c]! : -1
    if (v < 0) continue
    acc = ((acc << 6) | v) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[len++] = (acc >> bits) & 0xff
    }
  }
  return out.slice(0, len)
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const encoder = new TextEncoder()

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text)
}
