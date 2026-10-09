/**
 * Browser `Buffer` for the pptx engine/ops/render closure (Slides web frame, GO-B5).
 *
 * The engine parses and patches XML through Buffer.from / alloc / concat and
 * `buf.toString('utf8' | 'base64')`; the web build (../vite-web.ts) injects this module for
 * the free `Buffer` identifier in those packages only, so nothing else in the bundle sees a
 * Node-looking global. Precedent: dev-uniwork packages/office-upstream/shims/pptx-renderer/
 * buffer.ts (G3); base64 decoding is Buffer-lenient (skips foreign characters, accepts the
 * URL-safe alphabet) through the session core's helper. It extends Uint8Array, so values
 * interoperate with jszip and TextEncoder without copying.
 */
import { base64ToBytes, bytesToBase64 } from '../../../../apps/slides/src/session/bytes'

const UTF8_ENCODER = new TextEncoder()
const UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true })

function bytesFromHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length >> 1)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesFromBinary(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < out.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}

function isUtf8(encoding: string | undefined): boolean {
  return !encoding || encoding === 'utf8' || encoding === 'utf-8'
}

export class BrowserBuffer extends Uint8Array {
  override toString(encoding?: string): string {
    if (encoding === 'hex') {
      let out = ''
      for (const byte of this) out += byte.toString(16).padStart(2, '0')
      return out
    }
    if (encoding === 'base64') return bytesToBase64(this)
    if (encoding === 'ascii' || encoding === 'binary' || encoding === 'latin1') {
      let out = ''
      for (let i = 0; i < this.length; i += 0x8000)
        out += String.fromCharCode(...this.subarray(i, i + 0x8000))
      return out
    }
    return UTF8_DECODER.decode(this)
  }

  equals(other: Uint8Array): boolean {
    if (other.length !== this.length) return false
    for (let i = 0; i < this.length; i += 1) if (this[i] !== other[i]) return false
    return true
  }

  writeUInt32BE(value: number, offset = 0): number {
    this[offset] = (value >>> 24) & 0xff
    this[offset + 1] = (value >>> 16) & 0xff
    this[offset + 2] = (value >>> 8) & 0xff
    this[offset + 3] = value & 0xff
    return offset + 4
  }
}

function from(
  value: string | ArrayLike<number> | ArrayBuffer | Uint8Array,
  encoding?: string,
): BrowserBuffer {
  if (typeof value === 'string') {
    if (encoding === 'base64' || encoding === 'base64url')
      return new BrowserBuffer(base64ToBytes(value))
    if (encoding === 'hex') return new BrowserBuffer(bytesFromHex(value))
    if (encoding === 'ascii' || encoding === 'binary' || encoding === 'latin1')
      return new BrowserBuffer(bytesFromBinary(value))
    if (!isUtf8(encoding) && encoding !== '') throw new Error(`Buffer shim: encoding ${encoding}`)
    return new BrowserBuffer(UTF8_ENCODER.encode(value))
  }
  // Buffer.from(arrayBuffer | view) copies, like Node for views and arrays
  if (value instanceof ArrayBuffer) return new BrowserBuffer(new Uint8Array(value).slice())
  if (ArrayBuffer.isView(value))
    return new BrowserBuffer(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
    )
  return new BrowserBuffer(Array.from(value))
}

function alloc(size: number, fill = 0): BrowserBuffer {
  const buffer = new BrowserBuffer(size)
  if (fill !== 0) buffer.fill(fill)
  return buffer
}

function concat(chunks: readonly Uint8Array[], totalLength?: number): BrowserBuffer {
  const length = totalLength ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const buffer = new BrowserBuffer(length)
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= length) break
    buffer.set(chunk.subarray(0, length - offset), offset)
    offset += chunk.byteLength
  }
  return buffer
}

function isBuffer(value: unknown): boolean {
  return value instanceof BrowserBuffer
}

function byteLength(value: string | Uint8Array): number {
  return typeof value === 'string' ? UTF8_ENCODER.encode(value).length : value.byteLength
}

export const Buffer = Object.assign(BrowserBuffer, { from, alloc, concat, isBuffer, byteLength })
