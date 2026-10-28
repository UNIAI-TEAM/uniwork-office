import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AVATAR_MAX_BYTES,
  createAvatarCache,
  sniffAvatarMime,
} from '../src/main/uniwork-docs/avatar'
import {
  parseDocumentList,
  parseDocumentSummary,
  parseSharedWithMe,
} from '../src/main/uniwork-docs/parse'

/**
 * UNI-2047 A1: the optional list-row fields the doclist screens read (server
 * shapes SV-1..SV-6 plus the trash pair). Every one is lenient: a missing,
 * null or mistyped value is dropped (the key stays absent), never guessed, and
 * the row itself is always kept.
 */

const row = {
  id: 'doc_1',
  workspace_id: 'ws_1',
  title: 'Plan.docx',
  kind: 'file',
  updated_at: '2026-10-20T03:00:00Z',
}

/** parse one row through the plain list reader */
const parseOne = (extra: Record<string, unknown>) => {
  const page = parseDocumentList({ documents: [{ ...row, ...extra }] }, 'ws_1')
  expect(page.documents).toHaveLength(1)
  return page.documents[0]!
}

describe('doclist row fields stay absent on today’s rows', () => {
  it('a row without any new field carries none of them', () => {
    const doc = parseOne({})
    for (const key of [
      'archivedAt',
      'archivedById',
      'purgeAfter',
      'isOwner',
      'updatedByUser',
      'lastActivity',
      'shared',
      'shareSummary',
      'favoritedAt',
    ]) {
      expect(doc, key).not.toHaveProperty(key)
    }
  })
})

describe('trash: archived_at / archived_by / purge_after', () => {
  it('reads the three fields of a trashed row', () => {
    const doc = parseOne({
      archived_at: '2026-10-18T01:00:00Z',
      archived_by: 'user_9',
      purge_after: '2026-11-17T01:00:00Z',
    })
    expect(doc.archived).toBe(true)
    expect(doc.archivedAt).toBe('2026-10-18T01:00:00Z')
    expect(doc.archivedById).toBe('user_9')
    expect(doc.purgeAfter).toBe('2026-11-17T01:00:00Z')
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['wrong type', 42],
    ['not a timestamp', 'next week'],
  ])('purge_after %s is dropped', (_name, value) => {
    expect(parseOne({ purge_after: value })).not.toHaveProperty('purgeAfter')
  })

  it.each([
    ['null', null],
    ['empty', ''],
    ['wrong type', { id: 'u' }],
    ['too long', 'x'.repeat(129)],
  ])('archived_by %s is dropped', (_name, value) => {
    expect(parseOne({ archived_by: value })).not.toHaveProperty('archivedById')
  })

  it.each([
    ['null', null],
    ['wrong type', true],
    ['not a timestamp', 'yesterday'],
  ])('archived_at %s keeps the flag logic and drops the value', (_name, value) => {
    const doc = parseOne({ archived_at: value })
    expect(doc).not.toHaveProperty('archivedAt')
  })
})

describe('is_owner', () => {
  it('keeps both booleans', () => {
    expect(parseOne({ is_owner: true }).isOwner).toBe(true)
    expect(parseOne({ is_owner: false }).isOwner).toBe(false)
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['string', 'true'],
    ['number', 1],
  ])('%s is dropped', (_name, value) => {
    expect(parseOne({ is_owner: value })).not.toHaveProperty('isOwner')
  })
})

describe('updated_by_user', () => {
  it('reads name and an absolute https avatar url', () => {
    expect(
      parseOne({
        updated_by_user: { name: 'Lan Tran', avatar_url: 'https://cdn.example/a.png?sig=1' },
      }).updatedByUser,
    ).toEqual({ name: 'Lan Tran', avatarUrl: 'https://cdn.example/a.png?sig=1' })
  })

  it('drops an http avatar url and keeps the name (R1-1 https only)', () => {
    expect(
      parseOne({ updated_by_user: { name: 'Lan', avatar_url: 'http://cdn.example/a.png' } })
        .updatedByUser,
    ).toEqual({ name: 'Lan' })
  })

  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['null', null],
    ['relative path', '/avatars/a.png'],
    ['other scheme', 'javascript:alert(1)'],
    ['data url', 'data:image/png;base64,AAAA'],
    ['file url', 'file:///etc/passwd'],
    ['not a url', 'not a url'],
    ['wrong type', 7],
    ['too long', `https://cdn.example/${'a'.repeat(2100)}`],
    ['url with credentials', 'https://user:pass@cdn.example/a.png'],
  ])('avatar_url %s is dropped, the name stays', (_name, value) => {
    expect(parseOne({ updated_by_user: { name: 'Lan', avatar_url: value } }).updatedByUser).toEqual(
      {
        name: 'Lan',
      },
    )
  })

  it.each([
    ['null (outside the org or not a human)', null],
    ['missing', undefined],
    ['string', 'Lan'],
    ['array', []],
    ['no name', { avatar_url: 'https://cdn.example/a.png' }],
    ['empty name', { name: '', avatar_url: 'https://cdn.example/a.png' }],
    ['numeric name', { name: 5 }],
  ])('%s is dropped', (_name, value) => {
    expect(parseOne({ updated_by_user: value })).not.toHaveProperty('updatedByUser')
  })
})

describe('last_activity', () => {
  it.each(['opened', 'edited', 'commented'] as const)('reads kind %s', (kind) => {
    expect(parseOne({ last_activity: { kind, at: '2026-10-20T04:00:00Z' } }).lastActivity).toEqual({
      kind,
      at: '2026-10-20T04:00:00Z',
    })
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['string', 'opened'],
    ['unknown kind', { kind: 'deleted', at: '2026-10-20T04:00:00Z' }],
    ['no kind', { at: '2026-10-20T04:00:00Z' }],
    ['no at', { kind: 'opened' }],
    ['bad at', { kind: 'opened', at: 'noon' }],
    ['numeric at', { kind: 'opened', at: 1760000000 }],
  ])('%s is dropped', (_name, value) => {
    expect(parseOne({ last_activity: value })).not.toHaveProperty('lastActivity')
  })
})

describe('shared (shared-with-me)', () => {
  it('reads by, by_kind, by_name and at', () => {
    const page = parseSharedWithMe(
      {
        documents: [
          {
            ...row,
            shared: {
              by: 'user_3',
              by_kind: 'user',
              by_name: 'Minh',
              at: '2026-10-19T08:00:00Z',
            },
          },
        ],
      },
      'ws_1',
    )
    expect(page.documents[0]!.shared).toEqual({
      byId: 'user_3',
      byKind: 'user',
      byName: 'Minh',
      at: '2026-10-19T08:00:00Z',
    })
  })

  it('a null by_name (outside the org) keeps the rest', () => {
    const doc = parseOne({
      shared: { by: 'user_3', by_kind: 'user', by_name: null, at: '2026-10-19T08:00:00Z' },
    })
    expect(doc.shared).toEqual({ byId: 'user_3', byKind: 'user', at: '2026-10-19T08:00:00Z' })
  })

  it('drops only the odd member of an otherwise valid block', () => {
    const doc = parseOne({
      shared: { by: 12, by_kind: ['x'], by_name: '', at: '2026-10-19T08:00:00Z' },
    })
    expect(doc.shared).toEqual({ at: '2026-10-19T08:00:00Z' })
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['string', 'Minh'],
    ['array', []],
    ['no at', { by: 'user_3', by_name: 'Minh' }],
    ['bad at', { by: 'user_3', at: 'later' }],
  ])('%s is dropped', (_name, value) => {
    expect(parseOne({ shared: value })).not.toHaveProperty('shared')
  })
})

describe('share_summary (shared by me)', () => {
  it('reads the three counts and latest_at', () => {
    expect(
      parseOne({
        share_summary: {
          people: 3,
          workspaces: 1,
          links: 0,
          latest_at: '2026-10-19T09:00:00Z',
        },
      }).shareSummary,
    ).toEqual({ people: 3, workspaces: 1, links: 0, latestAt: '2026-10-19T09:00:00Z' })
  })

  it('a null latest_at keeps the counts', () => {
    expect(
      parseOne({ share_summary: { people: 0, workspaces: 0, links: 0, latest_at: null } })
        .shareSummary,
    ).toEqual({ people: 0, workspaces: 0, links: 0 })
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['string', '3 people'],
    ['array', []],
    ['a count missing', { people: 1, workspaces: 1 }],
    ['negative count', { people: -1, workspaces: 0, links: 0 }],
    ['fractional count', { people: 1.5, workspaces: 0, links: 0 }],
    ['string count', { people: '1', workspaces: 0, links: 0 }],
  ])('%s is dropped', (_name, value) => {
    expect(parseOne({ share_summary: value })).not.toHaveProperty('shareSummary')
  })

  it('a bad latest_at is dropped, the counts stay', () => {
    expect(
      parseOne({ share_summary: { people: 1, workspaces: 0, links: 0, latest_at: 'soon' } })
        .shareSummary,
    ).toEqual({ people: 1, workspaces: 0, links: 0 })
  })
})

describe('favorited_at', () => {
  it('reads a timestamp', () => {
    expect(parseOne({ favorited_at: '2026-10-01T00:00:00Z' }).favoritedAt).toBe(
      '2026-10-01T00:00:00Z',
    )
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['wrong type', true],
    ['not a timestamp', 'Monday'],
  ])('%s is dropped', (_name, value) => {
    expect(parseOne({ favorited_at: value })).not.toHaveProperty('favoritedAt')
  })
})

describe('the fields never cost the row', () => {
  it('a row with every new field mistyped still parses its core', () => {
    const doc = parseOne({
      archived_by: 1,
      purge_after: {},
      is_owner: 'yes',
      updated_by_user: 'Lan',
      last_activity: 3,
      shared: [],
      share_summary: 'none',
      favorited_at: false,
    })
    expect(doc.id).toBe('doc_1')
    expect(doc.title).toBe('Plan.docx')
    expect(doc.kind).toBe('file')
  })

  it('the same fields parse on the shared-with-me route', () => {
    const page = parseSharedWithMe(
      {
        documents: [
          {
            ...row,
            is_owner: false,
            updated_by_user: { name: 'Lan' },
            last_activity: { kind: 'edited', at: '2026-10-20T04:00:00Z' },
          },
        ],
      },
      'ws_1',
    )
    expect(page.documents[0]).toMatchObject({
      isOwner: false,
      updatedByUser: { name: 'Lan' },
      lastActivity: { kind: 'edited', at: '2026-10-20T04:00:00Z' },
    })
  })

  it('a single-document answer (parseDocumentSummary) is untouched', () => {
    const doc = parseDocumentSummary({
      document: { ...row, is_owner: true, purge_after: '2026-11-17T01:00:00Z' },
    })
    expect(doc).not.toHaveProperty('isOwner')
    expect(doc).not.toHaveProperty('purgeAfter')
  })
})

describe('UNI-2212 a live legacy file is a row that opens', () => {
  it.each([
    ['Budget.xls', 'application/vnd.ms-excel', 'xlsx'],
    ['Memo.doc', 'application/msword', 'docx'],
    ['Deck.ppt', 'application/vnd.ms-powerpoint', 'pptx'],
  ])('%s reads as the OOXML format it opens as', (title, mime, format) => {
    expect(
      parseOne({ title, file: { mime_type: mime, filename: title.toLowerCase() } }).format,
    ).toBe(format)
    // the title alone (a row that omits `file`) decides too
    expect(parseOne({ title }).format).toBe(format)
  })

  it('an OOXML file keeps its own format whatever the title says, and other types stay unsupported', () => {
    const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    expect(
      parseOne({ title: 'Old.xls', file: { mime_type: xlsxMime, filename: 'old.xlsx' } }).format,
    ).toBe('xlsx')
    expect(parseOne({ title: 'Archive.zip' }).format).toBeNull()
  })
})

describe('UNI-2275 R1-1 shell CSP and main-process avatar fetcher', () => {
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ])
  const JPEG_BYTES = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ])
  const GIF_BYTES = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
  ])
  const WEBP_BYTES = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ])

  it('keeps shell index.html CSP img-src restricted to self, data:, and blob: (no https:, http:, or *)', () => {
    const html = readFileSync(resolve(__dirname, '../src/renderer/index.html'), 'utf8')
    const cspMatch = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)
    expect(cspMatch).not.toBeNull()
    const imgSrcMatch = /(?:^|;\s*)img-src\s+([^;]+)/.exec(cspMatch![1]!)
    expect(imgSrcMatch).not.toBeNull()
    const imgSrc = imgSrcMatch![1]!.trim()
    expect(imgSrc).toBe("'self' data: blob:")
    expect(imgSrc).not.toMatch(/https:|http:|\*/)
  })

  it('sniffs PNG, JPEG, GIF, and WebP magic bytes and refuses SVG, HTML, and truncated bytes', () => {
    expect(sniffAvatarMime(PNG_BYTES)).toBe('image/png')
    expect(sniffAvatarMime(JPEG_BYTES)).toBe('image/jpeg')
    expect(sniffAvatarMime(GIF_BYTES)).toBe('image/gif')
    expect(sniffAvatarMime(WEBP_BYTES)).toBe('image/webp')
    expect(
      sniffAvatarMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull()
    expect(
      sniffAvatarMime(new TextEncoder().encode('<!doctype html><html><body>x</body></html>')),
    ).toBeNull()
    expect(sniffAvatarMime(PNG_BYTES.slice(0, 6))).toBeNull()
  })

  it('fetches https avatars with credentials omitted and no referer, returning a data: URL', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.credentials).toBe('omit')
      expect(init.referrerPolicy).toBe('no-referrer')
      expect(init.referrer).toBe('')
      expect(init.redirect).toBe('manual')
      return new Response(PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } })
    })
    const cache = createAvatarCache({ fetch })
    const dataUrl = await cache.resolveUrl('https://s3.example.com/avatars/u1.png?X-Amz-Signature=1')
    expect(dataUrl).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses non-https URLs without making any network request', async () => {
    const fetch = vi.fn()
    const cache = createAvatarCache({ fetch })
    expect(await cache.resolveUrl('http://s3.example.com/avatars/u1.png')).toBeNull()
    expect(await cache.resolveUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(await cache.resolveUrl('https://user:pass@s3.example.com/u1.png')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('follows up to 2 https redirects and refuses a 3rd hop or an http redirect', async () => {
    let calls = 0
    const cacheOk = createAvatarCache({
      fetch: async (url) => {
        calls += 1
        if (url === 'https://a.example/1') {
          return new Response(null, { status: 302, headers: { Location: 'https://b.example/2' } })
        }
        if (url === 'https://b.example/2') {
          return new Response(null, { status: 302, headers: { Location: '/final.jpg' } })
        }
        return new Response(JPEG_BYTES, { status: 200 })
      },
    })
    expect(await cacheOk.resolveUrl('https://a.example/1')).toBe(
      `data:image/jpeg;base64,${Buffer.from(JPEG_BYTES).toString('base64')}`,
    )
    expect(calls).toBe(3)

    // 3rd redirect hop refused
    const cacheTooMany = createAvatarCache({
      fetch: async (url) =>
        new Response(null, { status: 302, headers: { Location: `${url}/next` } }),
    })
    expect(await cacheTooMany.resolveUrl('https://a.example/start')).toBeNull()

    // redirect to http: refused
    const cacheHttpHop = createAvatarCache({
      fetch: async () =>
        new Response(null, { status: 302, headers: { Location: 'http://b.example/avatar.png' } }),
    })
    expect(await cacheHttpHop.resolveUrl('https://a.example/start')).toBeNull()
  })

  it('enforces the 2 MiB size cap from both Content-Length and streamed body', async () => {
    const cacheHeader = createAvatarCache({
      fetch: async () =>
        new Response(PNG_BYTES, {
          status: 200,
          headers: { 'Content-Length': String(AVATAR_MAX_BYTES + 1) },
        }),
    })
    expect(await cacheHeader.resolveUrl('https://s3.example.com/huge-header.png')).toBeNull()

    const oversized = new Uint8Array(AVATAR_MAX_BYTES + 10)
    oversized.set(PNG_BYTES, 0)
    const cacheStream = createAvatarCache({
      fetch: async () => new Response(oversized, { status: 200 }),
    })
    expect(await cacheStream.resolveUrl('https://s3.example.com/huge-stream.png')).toBeNull()
  })

  it('refuses SVG and HTML bodies even when served with image/png Content-Type', async () => {
    const svgBody = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const cache = createAvatarCache({
      fetch: async () =>
        new Response(svgBody, { status: 200, headers: { 'Content-Type': 'image/png' } }),
    })
    expect(await cache.resolveUrl('https://s3.example.com/evil.png')).toBeNull()
  })

  it('caches by origin+pathname (ignoring rotating query params), deduplicates per editor, and expires after TTL', async () => {
    let now = 1_000
    const fetch = vi.fn(async () => new Response(WEBP_BYTES, { status: 200 }))
    const cache = createAvatarCache({ fetch, now: () => now, ttlMs: 10_000 })

    // Concurrent resolveRows with rotating query strings for the same editor only fetches once
    const docs = parseDocumentList(
      {
        documents: [
          {
            ...row,
            id: 'd1',
            updated_by_user: {
              name: 'Minh',
              avatar_url: 'https://s3.example.com/avatars/minh.webp?sig=first',
            },
          },
          {
            ...row,
            id: 'd2',
            updated_by_user: {
              name: 'Minh',
              avatar_url: 'https://s3.example.com/avatars/minh.webp?sig=second',
            },
          },
        ],
      },
      'ws_1',
    ).documents

    const resolved = await cache.resolveRows(docs)
    expect(fetch).toHaveBeenCalledTimes(1)
    const expectedDataUrl = `data:image/webp;base64,${Buffer.from(WEBP_BYTES).toString('base64')}`
    expect(resolved[0]!.updatedByUser).toEqual({ name: 'Minh', avatarUrl: expectedDataUrl })
    expect(resolved[1]!.updatedByUser).toEqual({ name: 'Minh', avatarUrl: expectedDataUrl })

    // Subsequent list fetch with a new presigned signature hits cache
    now += 5_000
    expect(await cache.resolveUrl('https://s3.example.com/avatars/minh.webp?sig=third')).toBe(
      expectedDataUrl,
    )
    expect(fetch).toHaveBeenCalledTimes(1)

    // Past TTL refetches
    now += 6_000
    expect(await cache.resolveUrl('https://s3.example.com/avatars/minh.webp?sig=fourth')).toBe(
      expectedDataUrl,
    )
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns null and drops avatarUrl on timeout or network failure without failing the list', async () => {
    const cache = createAvatarCache({
      timeoutMs: 20,
      fetch: (_url, init) => {
        const { promise, reject } = Promise.withResolvers<Response>()
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        return promise
      },
    })
    const docs = parseDocumentList(
      {
        documents: [
          {
            ...row,
            updated_by_user: { name: 'Minh', avatar_url: 'https://s3.example.com/slow.png' },
          },
        ],
      },
      'ws_1',
    ).documents
    const resolved = await cache.resolveRows(docs)
    expect(resolved[0]!.updatedByUser).toEqual({ name: 'Minh' })
  })
})
