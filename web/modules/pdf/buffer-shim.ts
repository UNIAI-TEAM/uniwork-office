/**
 * The slice of Node's Buffer the PDF save core uses (apps/pdf/src/main text-edit.ts, font-subset.ts,
 * font-cmap.ts, annot-delete.ts and @genoffice/font-metrics byte readers), for the web frame.
 *
 * Installed as `globalThis.Buffer` by ./core-env-web.ts before the core is imported. Same semantics as
 * Node for what is implemented: `slice`/`subarray` are views (Node's Buffer#slice does not copy),
 * `Buffer.from(typedArray)` copies, `Buffer.from(arrayBuffer, offset, length)` is a view.
 * Encodings: utf8 (default), utf16le / ucs2, latin1 / binary, ascii, base64, hex.
 * Anything else throws, so a new use in the core fails loudly in the frame tests instead of
 * producing wrong bytes.
 */

type Encoding =
  'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'latin1' | 'binary' | 'ascii' | 'base64' | 'hex'

function norm(enc: string | undefined): Encoding {
  const e = (enc ?? 'utf8').toLowerCase()
  switch (e) {
    case 'utf8':
    case 'utf-8':
    case 'utf16le':
    case 'ucs2':
    case 'latin1':
    case 'binary':
    case 'ascii':
    case 'base64':
    case 'hex':
      return e
    case 'utf-16le':
    case 'ucs-2':
      return 'utf16le'
    default:
      throw new Error(`Buffer shim: unsupported encoding "${enc}"`)
  }
}

function encode(text: string, enc: Encoding): Uint8Array {
  switch (enc) {
    case 'utf8':
    case 'utf-8':
      return new TextEncoder().encode(text)
    case 'utf16le':
    case 'ucs2': {
      const out = new Uint8Array(text.length * 2)
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        out[i * 2] = c & 0xff
        out[i * 2 + 1] = c >> 8
      }
      return out
    }
    case 'latin1':
    case 'binary':
    case 'ascii': {
      const out = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
      return out
    }
    case 'base64': {
      const bin = atob(
        text
          .replace(/[^A-Za-z0-9+/=_-]/g, '')
          .replace(/-/g, '+')
          .replace(/_/g, '/'),
      )
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
    case 'hex': {
      const out = new Uint8Array(Math.floor(text.length / 2))
      for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16)
      return out
    }
  }
}

function decode(bytes: Uint8Array, enc: Encoding): string {
  switch (enc) {
    case 'utf8':
    case 'utf-8':
      return new TextDecoder().decode(bytes)
    case 'utf16le':
    case 'ucs2': {
      let s = ''
      for (let i = 0; i + 1 < bytes.length; i += 2)
        s += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8))
      return s
    }
    case 'latin1':
    case 'binary': {
      let s = ''
      for (const b of bytes) s += String.fromCharCode(b)
      return s
    }
    case 'ascii': {
      let s = ''
      for (const b of bytes) s += String.fromCharCode(b & 0x7f)
      return s
    }
    case 'base64': {
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      return btoa(bin)
    }
    case 'hex':
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
}

/** The Buffer instances: a Uint8Array with Node's readers/writers and view-returning slice */
export class ShimBuffer extends Uint8Array {
  /** Node semantics: a view on the same memory */
  override slice(start?: number, end?: number): ShimBuffer {
    return this.subarray(start, end)
  }

  override subarray(start?: number, end?: number): ShimBuffer {
    const view = Uint8Array.prototype.subarray.call(this, start, end)
    return new ShimBuffer(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)
  }

  override toString(enc?: string, start = 0, end = this.length): string {
    return decode(this.subarray(start, end), norm(enc))
  }

  equals(other: Uint8Array): boolean {
    if (other.length !== this.length) return false
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false
    return true
  }

  private view(): DataView {
    return new DataView(this.buffer as ArrayBuffer, this.byteOffset, this.byteLength)
  }

  readUInt8(o: number): number {
    return this.view().getUint8(o)
  }
  readUInt16BE(o: number): number {
    return this.view().getUint16(o)
  }
  readUInt32BE(o: number): number {
    return this.view().getUint32(o)
  }
  readInt16BE(o: number): number {
    return this.view().getInt16(o)
  }
  readInt32BE(o: number): number {
    return this.view().getInt32(o)
  }
  readUInt16LE(o: number): number {
    return this.view().getUint16(o, true)
  }
  readUInt32LE(o: number): number {
    return this.view().getUint32(o, true)
  }
  readUIntBE(o: number, byteLength: number): number {
    let v = 0
    for (let i = 0; i < byteLength; i++) v = v * 256 + this.view().getUint8(o + i)
    return v
  }
  writeUInt16BE(value: number, o: number): number {
    this.view().setUint16(o, value)
    return o + 2
  }
  writeUInt32BE(value: number, o: number): number {
    this.view().setUint32(o, value)
    return o + 4
  }
}

function view(bytes: Uint8Array): ShimBuffer {
  return new ShimBuffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)
}

/** The Buffer constructor's static side (the core only calls these, never `new Buffer`) */
export const BufferShim = {
  prototype: ShimBuffer.prototype,
  from(
    value: string | ArrayBuffer | ArrayLike<number> | Iterable<number>,
    encOrOffset?: string | number,
    length?: number,
  ): ShimBuffer {
    if (typeof value === 'string')
      return view(encode(value, norm(encOrOffset as string | undefined)))
    if (value instanceof ArrayBuffer) {
      const offset = (encOrOffset as number | undefined) ?? 0
      return new ShimBuffer(value, offset, length ?? value.byteLength - offset)
    }
    // typed arrays / arrays / iterables: a copy, as in Node
    return view(Uint8Array.from(value as ArrayLike<number>))
  },
  alloc(size: number, fill = 0): ShimBuffer {
    const b = new ShimBuffer(size)
    if (fill) b.fill(fill)
    return b
  },
  isBuffer(value: unknown): value is ShimBuffer {
    return value instanceof ShimBuffer
  },
  concat(list: readonly Uint8Array[], total?: number): ShimBuffer {
    const size = total ?? list.reduce((n, b) => n + b.length, 0)
    const out = new ShimBuffer(size)
    let at = 0
    for (const b of list) {
      if (at >= size) break
      out.set(b.subarray(0, size - at), at)
      at += b.length
    }
    return out
  },
}

/** Install the shim as the global Buffer when the platform has none (the browser) */
export function installBufferShim(target: Record<string, unknown> = globalThis as never): void {
  if (typeof target.Buffer === 'undefined') target.Buffer = BufferShim
}
