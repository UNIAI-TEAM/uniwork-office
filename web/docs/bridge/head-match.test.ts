// RF-7: the head version is adopted after an unknown save outcome only when its bytes are ours.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileMeta, FileSource } from '../protocol/types'
import { ownHeadAfterUnknown } from './head-match'

const SENT = new Uint8Array([1, 2, 3])
const meta = (over: Partial<FileMeta> = {}): FileMeta => ({
  fileId: 'f1',
  name: 'a.bin',
  etag: '"v2"',
  sizeBytes: 3,
  ...over,
})
const port = (file: FileMeta, source: FileSource) => ({
  request: vi.fn(async () => ({ file, source })) as never,
})

afterEach(() => vi.unstubAllGlobals())

describe('ownHeadAfterUnknown', () => {
  it('adopts a moved head holding exactly the sent bytes', async () => {
    const head = await ownHeadAfterUnknown(
      port(meta(), { kind: 'bytes', data: SENT.slice().buffer }),
      'f1',
      '"v1"',
      SENT,
    )
    expect(head?.etag).toBe('"v2"')
  })

  it('does not adopt a same-size head with other content', async () => {
    const other = new Uint8Array([1, 2, 4]).buffer
    expect(
      await ownHeadAfterUnknown(port(meta(), { kind: 'bytes', data: other }), 'f1', '"v1"', SENT),
    ).toBeNull()
  })

  it('does not adopt an unmoved head, a different size, another file or a missing base etag', async () => {
    const same = { kind: 'bytes', data: SENT.slice().buffer } as const
    expect(
      await ownHeadAfterUnknown(port(meta({ etag: '"v1"' }), same), 'f1', '"v1"', SENT),
    ).toBeNull()
    expect(
      await ownHeadAfterUnknown(port(meta({ sizeBytes: 9 }), same), 'f1', '"v1"', SENT),
    ).toBeNull()
    expect(
      await ownHeadAfterUnknown(port(meta({ fileId: 'f2' }), same), 'f1', '"v1"', SENT),
    ).toBeNull()
    expect(await ownHeadAfterUnknown(port(meta(), same), 'f1', undefined, SENT)).toBeNull()
  })

  it('compares a url source by fetching it without credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(SENT.slice()))
    vi.stubGlobal('fetch', fetchMock)
    const head = await ownHeadAfterUnknown(
      port(meta(), { kind: 'url', url: 'https://s3.test/x', headers: { a: 'b' } }),
      'f1',
      '"v1"',
      SENT.buffer.slice(0) as ArrayBuffer,
    )
    expect(head).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3.test/x',
      expect.objectContaining({ credentials: 'omit' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([9, 9, 9]))),
    )
    expect(
      await ownHeadAfterUnknown(
        port(meta(), { kind: 'url', url: 'https://s3.test/x' }),
        'f1',
        '"v1"',
        SENT,
      ),
    ).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 500 })),
    )
    expect(
      await ownHeadAfterUnknown(
        port(meta(), { kind: 'url', url: 'https://s3.test/x' }),
        'f1',
        '"v1"',
        SENT,
      ),
    ).toBeNull()
  })

  it('a head that cannot be read is not ours', async () => {
    const failing = { request: vi.fn(async () => Promise.reject(new Error('boom'))) as never }
    expect(await ownHeadAfterUnknown(failing, 'f1', '"v1"', SENT)).toBeNull()
  })
})
