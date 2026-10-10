/**
 * TIFF -> PNG for display in the Slides web frame (the desktop's main/tiff-decode.ts uses pngjs,
 * which needs Node streams). Chromium cannot decode TIFF, so a picture stored as ppt/media/*.tif
 * would render blank; UTIF (pure JS) decodes it and a small PNG encoder (zlib deflate from
 * ./shims/zlib) re-encodes it. The package keeps the original bytes, so saving is unaffected.
 */
import UTIF from 'utif2'
import type { DecodedImage } from '../../../apps/slides/src/session/platform'
import { deflateSync } from './shims/zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(parts: readonly Uint8Array[]): number {
  let c = 0xffffffff
  for (const p of parts)
    for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  const name = new TextEncoder().encode(type)
  out.set(name, 4)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32([name, data]))
  return out
}

/** RGBA8 pixels -> PNG (color type 6, filter 0 on every row) */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const stride = width * 4
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++)
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** the largest page of a (multi-page) TIFF as PNG; null when UTIF cannot decode it */
export function tiffToPng(bytes: Uint8Array): DecodedImage | null {
  try {
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const ifds = UTIF.decode(buf)
    if (!ifds.length) return null
    let page = ifds[0]!
    for (const ifd of ifds) {
      UTIF.decodeImage(buf, ifd)
      if ((ifd.width || 0) * (ifd.height || 0) > (page.width || 0) * (page.height || 0)) page = ifd
    }
    const { width, height } = page
    if (!width || !height) return null
    return { png: encodePng(new Uint8Array(UTIF.toRGBA8(page)), width, height), width, height }
  } catch {
    return null
  }
}
