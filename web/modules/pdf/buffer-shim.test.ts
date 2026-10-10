// @vitest-environment node
// The frame's Buffer shim answers like Node's Buffer for everything the save core calls.
import { describe, expect, it } from 'vitest'
import { BufferShim, ShimBuffer, installBufferShim } from './buffer-shim'

const bytes = Uint8Array.from([0x00, 0x01, 0xff, 0x80, 0x4f, 0x54, 0x54, 0x4f, 0x12, 0x34, 0xfe])

describe('BufferShim vs Node Buffer', () => {
  it('integer readers and writers', () => {
    const n = Buffer.from(bytes)
    const s = BufferShim.from(bytes)
    for (let o = 0; o + 4 <= bytes.length; o++) {
      expect(s.readUInt16BE(o)).toBe(n.readUInt16BE(o))
      expect(s.readInt16BE(o)).toBe(n.readInt16BE(o))
      expect(s.readUInt32BE(o)).toBe(n.readUInt32BE(o))
      expect(s.readInt32BE(o)).toBe(n.readInt32BE(o))
      for (const len of [1, 2, 3, 4]) expect(s.readUIntBE(o, len)).toBe(n.readUIntBE(o, len))
    }
    n.writeUInt16BE(0xbeef, 1)
    s.writeUInt16BE(0xbeef, 1)
    n.writeUInt32BE(0xdeadbeef, 4)
    s.writeUInt32BE(0xdeadbeef, 4)
    expect([...s]).toEqual([...n])
  })

  it('string codecs', () => {
    for (const text of ['Contents\0', 'Grüße 漢字 😀', '']) {
      for (const enc of ['utf8', 'utf16le', 'latin1', 'ascii', 'base64', 'hex'] as const) {
        const input =
          enc === 'base64'
            ? Buffer.from(text).toString('base64')
            : enc === 'hex'
              ? Buffer.from(text).toString('hex')
              : text
        expect([...BufferShim.from(input, enc)], `${enc} ${text}`).toEqual([
          ...Buffer.from(input, enc),
        ])
      }
      const n = Buffer.from(text, 'utf16le')
      const s = BufferShim.from(text, 'utf16le')
      expect(s.toString('utf16le')).toBe(n.toString('utf16le'))
      expect(BufferShim.from(text).toString()).toBe(Buffer.from(text).toString())
      expect(BufferShim.from(text).toString('base64')).toBe(Buffer.from(text).toString('base64'))
      expect(BufferShim.from(text).toString('latin1')).toBe(Buffer.from(text).toString('latin1'))
    }
  })

  it('views and copies like Node', () => {
    const ab = bytes.slice().buffer
    const view = BufferShim.from(ab, 2, 3)
    view[0] = 7
    expect(new Uint8Array(ab)[2]).toBe(7) // from(arrayBuffer, offset, length) is a view
    const src = Uint8Array.from([1, 2, 3])
    const copy = BufferShim.from(src)
    copy[0] = 9
    expect(src[0]).toBe(1) // from(typedArray) copies
    const s = BufferShim.from(bytes)
    const slice = s.slice(1, 3)
    expect(slice).toBeInstanceOf(ShimBuffer)
    slice[0] = 0x55
    expect(s[1]).toBe(0x55) // slice is a view, as Node's Buffer#slice
    expect(s.subarray(4, 8).toString('latin1')).toBe('OTTO')
    expect(BufferShim.alloc(3)).toEqual(new ShimBuffer(3))
    expect(BufferShim.from([1, 2]).equals(Uint8Array.from([1, 2]))).toBe(true)
    expect([...BufferShim.concat([Uint8Array.from([1]), Uint8Array.from([2, 3])])]).toEqual([
      1, 2, 3,
    ])
  })

  it('refuses an unknown encoding instead of guessing', () => {
    expect(() => BufferShim.from('x', 'utf32' as never)).toThrow(/unsupported encoding/)
  })

  it('installs only where no Buffer exists', () => {
    const target: Record<string, unknown> = {}
    installBufferShim(target)
    expect(target.Buffer).toBe(BufferShim)
    const node: Record<string, unknown> = { Buffer }
    installBufferShim(node)
    expect(node.Buffer).toBe(Buffer)
  })
})
