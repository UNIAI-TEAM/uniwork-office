// @vitest-environment node
/**
 * The browser shims the engine closure runs on in the frame, pinned against Node itself:
 * SHA-256, randomUUID, zlib deflate, the Buffer subset the engine uses, and the build plugin
 * that wires them in. Also the frame's own byte writers (PNG for TIFF, image-per-page PDF,
 * zip of slide images).
 */
import { createHash, randomBytes } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { Buffer as BrowserBuffer } from './shims/buffer'

/** the shim stands in for node's Buffer: type it as one */
const ShimBuffer = BrowserBuffer as unknown as typeof Buffer
import { createHash as shimHash, randomUUID } from './shims/crypto'
import { deflateSync } from './shims/zlib'
import { createWriteStream } from './shims/node-fs'
import { injectBuffer, NODE_SHIMS } from './vite-web'
import { encodePng } from './tiff'
import { imageFileNames, pageWidthIn, pdfFromJpegs, zipImages } from './exports'

const samples = [0, 1, 55, 56, 63, 64, 65, 1000, 70_000].map((n) => new Uint8Array(randomBytes(n)))

describe('crypto shim', () => {
  it('sha256 hex digests equal node:crypto', () => {
    for (const s of samples)
      expect(shimHash('sha256').update(s).digest('hex')).toBe(
        createHash('sha256').update(s).digest('hex'),
      )
    expect(
      shimHash('sha256')
        .update('héllo')
        .update(new Uint8Array([1, 2]))
        .digest('hex'),
    ).toBe(
      createHash('sha256')
        .update('héllo')
        .update(new Uint8Array([1, 2]))
        .digest('hex'),
    )
  })

  it('refuses other algorithms and makes RFC 4122 v4 uuids', () => {
    expect(() => shimHash('md5')).toThrow()
    const u = randomUUID()
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(randomUUID()).not.toBe(u)
  })
})

describe('zlib shim', () => {
  it('deflateSync output inflates back with node:zlib', () => {
    const text = new TextEncoder().encode('abcabcabcabc '.repeat(500))
    for (const s of [...samples, text])
      expect(new Uint8Array(inflateSync(deflateSync(s)))).toEqual(s)
  })
})

describe('Buffer shim (the subset the engine uses)', () => {
  const strings = ['', 'plain', 'Tiếng Việt 中文 🎉', '<a:t>x&amp;y</a:t>']
  it('from / toString match node for utf8, base64, hex, latin1', () => {
    for (const s of strings) {
      expect(ShimBuffer.from(s).toString('utf8')).toBe(Buffer.from(s).toString('utf8'))
      expect(ShimBuffer.from(s, 'utf8').toString('base64')).toBe(Buffer.from(s).toString('base64'))
      expect(ShimBuffer.from(s).toString('hex')).toBe(Buffer.from(s).toString('hex'))
      expect([...ShimBuffer.from(s, 'latin1')]).toEqual([...Buffer.from(s, 'latin1')])
      expect(ShimBuffer.from(s, '' as BufferEncoding).toString()).toBe(s)
    }
    for (const b of samples) {
      const b64 = Buffer.from(b).toString('base64')
      expect(ShimBuffer.from(b).toString('base64')).toBe(b64)
      expect([...ShimBuffer.from(b64, 'base64')]).toEqual([...b])
    }
  })

  it('alloc / concat / equals / writeUInt32BE / copies like node', () => {
    const head = ShimBuffer.alloc(8)
    const node = Buffer.alloc(8)
    expect(head.write('IHDR', 4, 'ascii')).toBe(node.write('IHDR', 4, 'ascii'))
    expect([...head]).toEqual([...node])
    const a = ShimBuffer.alloc(4)
    a.writeUInt32BE(0xdeadbeef, 0)
    expect([...a]).toEqual([...Buffer.from([0xde, 0xad, 0xbe, 0xef])])
    const c = ShimBuffer.concat([a, ShimBuffer.from('xy', 'ascii')])
    expect(c.toString('hex')).toBe('deadbeef7879')
    expect(c.equals(ShimBuffer.from(c))).toBe(true)
    expect(c.equals(ShimBuffer.from('nope'))).toBe(false)
    const src = new Uint8Array([1, 2, 3])
    const copy = ShimBuffer.from(src)
    src[0] = 9
    expect(copy[0]).toBe(1)
    expect(ShimBuffer.isBuffer(copy)).toBe(true)
    expect(ShimBuffer.byteLength('é')).toBe(2)
  })
})

describe('node-fs shim', () => {
  it('fails loudly: the desktop-only streaming save is never reachable', () => {
    expect(() => createWriteStream()).toThrow(/not available in the web frame/)
  })
})

describe('build plugin', () => {
  const engineFile = '/repo/packages/pptx-engine/src/zip.ts'
  it('injects the Buffer import into engine files that use the free identifier only', () => {
    const out = injectBuffer(engineFile, 'const x = Buffer.from(y)\nconst xml = Buffer.alloc(1)')
    expect(out).toMatch(/^import \{ Buffer \} from ".*shims[\\/]buffer\.ts";\n/)
    expect(injectBuffer('/repo/apps/slides/src/renderer/App.tsx', 'Buffer.from(x)')).toBeNull()
    expect(injectBuffer(engineFile, 'const x = 1')).toBeNull()
    expect(injectBuffer(engineFile, "import { Buffer } from 'buffer'\nBuffer.from(x)")).toBeNull()
  })

  it('maps every node module the engine imports', () => {
    expect(Object.keys(NODE_SHIMS).sort()).toEqual(
      ['node:crypto', 'node:fs', 'node:stream/promises', 'node:zlib'].sort(),
    )
  })
})

describe('frame byte writers', () => {
  it('encodePng writes a valid PNG whose IDAT holds the filtered rows', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128])
    const png = encodePng(rgba, 2, 1)
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const dv = new DataView(png.buffer)
    const idatLen = dv.getUint32(33)
    expect(new TextDecoder().decode(png.slice(37, 41))).toBe('IDAT')
    const raw = new Uint8Array(inflateSync(png.slice(41, 41 + idatLen)))
    expect([...raw]).toEqual([0, ...rgba])
  })

  it('pdfFromJpegs: one page per image, the xref points at every object', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const pdf = pdfFromJpegs(
      [
        { jpeg, width: 2, height: 1 },
        { jpeg, width: 2, height: 1 },
      ],
      pageWidthIn(1280, 720),
      7.5,
    )
    const text = new TextDecoder('latin1').decode(pdf)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/MediaBox [0 0 959.976 540]')
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    )
    expect(offsets).toHaveLength(8)
    offsets.forEach((off, i) => expect(text.startsWith(`${i + 1} 0 obj\n`, off)).toBe(true))
  })

  it('page width follows the slide ratio like the desktop export', () => {
    expect(pageWidthIn(1280, 720)).toBe(13.333)
    expect(pageWidthIn(1024, 768)).toBe(10)
    expect(pageWidthIn(0, 0)).toBe(13.333)
  })

  it('zipImages names the pages <base>-NN.png', async () => {
    const png = Buffer.from(encodePng(new Uint8Array(4), 1, 1)).toString('base64')
    const zip = await JSZip.loadAsync(await zipImages('Deck', [png, png]))
    expect(Object.keys(zip.files)).toEqual(['Deck-01.png', 'Deck-02.png'])
    expect(imageFileNames('D', 100)[99]).toBe('D-100.png')
  })
})
