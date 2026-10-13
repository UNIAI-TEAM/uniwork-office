/**
 * G8-08 (UNI-1390): the additive `comments` part of the frame protocol (contract-collab §9, §10,
 * OQ-C12). PROTOCOL_VERSION stays 1; every new key is optional.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocsFrameClient, type DocsFrameClientOptions } from '../client'
import { createDocsFrameHost, type ApiHandlers, type DocsFrameHostOptions } from '../host'
import { Endpoint, type RejectInfo } from '../endpoint'
import {
  CAPABILITY_KEYS,
  COMMENTS_LEVELS,
  COMMENTS_MAX_ANCHORS,
  COMMENTS_REVEAL_WAIT_MS,
  DocsProtocolError,
  FRAME_REQUEST_TYPES,
  HOST_EVENT_TYPES,
  HOST_REQUEST_TYPES,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  canActOnComment,
  checkInitComments,
  commentsAccess,
  commentsErrorFromHttp,
  isCommentsRequestType,
  isInitPayload,
  parseEnvelope,
  type CommentsListResult,
  type DocumentComment,
  type InitPayload,
} from '../types'
import { FakeWindow, ORIGIN, flush, wirePair } from './fake-windows'

const NOW = 1_000_000

const live: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const x of live.splice(0)) x.dispose()
  vi.useRealTimers()
})

function baseInit(over: Partial<InitPayload> = {}): Omit<InitPayload, 'protocolVersion'> {
  return {
    token: 'tok-1',
    tokenExpiresAt: NOW + 10 * 60_000,
    documentId: 'doc-1',
    workspaceId: 'ws-1',
    apiBase: `${ORIGIN}/api`,
    apiMode: 'host-proxy',
    locale: 'vi',
    theme: 'light',
    capabilities: { save: true, comments: true },
    user: { displayName: 'An', id: '01J8X4USR0AAAAAAAAAAAAAAAA' },
    commentsLevel: 'edit',
    ...over,
  }
}

/** The shared body fixture (contract §3): a mention token + every Markdown-subset part. */
const BODY_FIXTURE =
  'Xem lại [@Nguyễn \\[An\\]](mention://member/01J8X4USR0AAAAAAAAAAAAAAAA) giúp nhé:\n' +
  '**đậm**, *nghiêng*, `code [@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)`,\n' +
  '[liên kết](https://example.com/a?b=1&c=2)  \nxuống dòng — <b>không HTML</b> ✓'

const COMMENT: DocumentComment = {
  id: '01J8X4CMTN0000000000000001',
  document_id: 'doc-1',
  author_id: '01J8X4USR0AAAAAAAAAAAAAAAA',
  author_kind: 'human',
  parent_id: null,
  body: BODY_FIXTURE,
  kind: 'comment',
  type: 'comment',
  revision: 1,
  anchor: { format: 'xlsx', v: 1, sheet: 'S1', range: 'B7' },
  anchor_version_id: '01J8X4VER00000000000000001',
  anchor_state: 'exact',
  resolved_at: null,
  deleted_at: null,
  created_at: '2026-10-13T09:00:00Z',
  updated_at: '2026-10-13T09:00:00Z',
  display_name: 'An',
}

const LIST: CommentsListResult = {
  comments: [COMMENT],
  mentions: [{ user_id: '01J8X4USR0AAAAAAAAAAAAAAAA', display_name: 'Nguyễn An', state: 'ok' }],
  list_token: 'lt1:aa',
  unchanged: false,
}

interface Pair {
  host: ReturnType<typeof createDocsFrameHost>
  client: ReturnType<typeof createDocsFrameClient>
  hostWin: FakeWindow
  frameWin: FakeWindow
  hostRejects: RejectInfo[]
}

function setup(
  hostOver: Partial<DocsFrameHostOptions> = {},
  clientOver: Partial<DocsFrameClientOptions> = {},
): Pair {
  const { host: hostWin, frame: frameWin } = wirePair()
  const hostRejects: RejectInfo[] = []
  const host = createDocsFrameHost({
    self: hostWin,
    frame: () => frameWin,
    allowedOrigins: [ORIGIN],
    getInit: async () => baseInit(),
    refreshToken: async () => ({ token: 't2', tokenExpiresAt: NOW + 60_000 }),
    onReject: (r) => hostRejects.push(r),
    timeoutMs: 1_000,
    ...hostOver,
  })
  const client = createDocsFrameClient({
    self: frameWin,
    parent: hostWin,
    allowedOrigins: [ORIGIN],
    capabilities: { save: true, comments: true },
    now: () => NOW,
    timeoutMs: 1_000,
    ...clientOver,
  })
  live.push(host, client)
  return { host, client, hostWin, frameWin, hostRejects }
}

const env = (kind: string, type: string, payload: unknown) =>
  parseEnvelope({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: 'x1', kind, type, payload })

// ---------------------------------------------------------------- shape

describe('G8-08 protocol shape', () => {
  it('keeps PROTOCOL_VERSION 1 and adds the comments types and capability', () => {
    expect(PROTOCOL_VERSION).toBe(1)
    expect(CAPABILITY_KEYS).toContain('comments')
    expect(FRAME_REQUEST_TYPES).toEqual(
      expect.arrayContaining([
        'comments.list',
        'comments.create',
        'comments.update',
        'comments.delete',
        'comments.resolve',
        'comments.reopen',
        'comments.revisions',
        'comments.anchors',
        'mentions.search',
      ]),
    )
    expect(HOST_EVENT_TYPES).toContain('comments.changed')
    expect(HOST_REQUEST_TYPES).toContain('comments.reveal')
    expect(COMMENTS_LEVELS).toEqual(['view', 'edit', 'manage'])
    expect(isCommentsRequestType('comments.list')).toBe(true)
    expect(isCommentsRequestType('mentions.search')).toBe(true)
    expect(isCommentsRequestType('api.open')).toBe(false)
  })

  it('init: user.id and commentsLevel are optional and typed', () => {
    const init = { ...baseInit(), protocolVersion: PROTOCOL_VERSION }
    expect(isInitPayload(init)).toBe(true)
    for (const level of ['view', 'edit', 'manage'] as const) {
      expect(isInitPayload({ ...init, commentsLevel: level })).toBe(true)
    }
    const { commentsLevel: _l, user: _u, ...bare } = init
    expect(isInitPayload(bare)).toBe(true)
    expect(isInitPayload({ ...init, user: { displayName: 'An' } })).toBe(true)
    expect(isInitPayload({ ...init, commentsLevel: 'admin' })).toBe(false)
    expect(isInitPayload({ ...init, commentsLevel: null })).toBe(false)
    expect(isInitPayload({ ...init, user: { displayName: 'An', id: 7 } })).toBe(false)
    expect(isInitPayload({ ...init, user: { displayName: 'An', id: '' } })).toBe(false)
  })

  it('frame -> host request payloads', () => {
    const ok = (type: string, p: unknown) => expect(env('request', type, p).ok).toBe(true)
    const bad = (type: string, p: unknown) => expect(env('request', type, p).ok).toBe(false)

    ok('comments.list', {})
    ok('comments.list', { kind: 'comment', since_token: 'lt1:aa' })
    bad('comments.list', { kind: 'note' })
    bad('comments.list', { since_token: '' })

    const anchor = {
      format: 'docx',
      v: 1,
      path: [3, 0],
      start: 1,
      end: 4,
      quote: 'x',
      prefix: '',
      suffix: '',
    }
    ok('comments.create', { kind: 'discussion', body: BODY_FIXTURE })
    ok('comments.create', { kind: 'comment', body: 'a', anchor, base_version_id: 'v1' })
    ok('comments.create', { kind: 'comment', parent_id: COMMENT.id, body: 'reply' })
    bad('comments.create', { body: 'no kind' })
    bad('comments.create', { kind: 'comment', body: '' })
    bad('comments.create', { kind: 'comment', body: 'a', anchor }) // anchor needs base_version_id
    bad('comments.create', { kind: 'comment', body: 'a', anchor: { v: 1 }, base_version_id: 'v1' })
    bad('comments.create', { kind: 'comment', body: 'a', parent_id: '' })

    ok('comments.update', { comment_id: COMMENT.id, body: 'new' })
    bad('comments.update', { comment_id: COMMENT.id, body: '' })
    bad('comments.update', { body: 'new' })
    for (const t of [
      'comments.delete',
      'comments.resolve',
      'comments.reopen',
      'comments.revisions',
    ]) {
      ok(t, { comment_id: COMMENT.id })
      bad(t, { comment_id: '' })
      bad(t, {})
    }

    const item = { comment_id: COMMENT.id, anchor: COMMENT.anchor, state: 'exact' }
    ok('comments.anchors', { version_id: 'v2', anchors: [item, { ...item, state: 'lost' }] })
    ok('comments.anchors', {
      version_id: 'v2',
      anchors: Array.from({ length: COMMENTS_MAX_ANCHORS }, () => item),
    })
    bad('comments.anchors', {
      version_id: 'v2',
      anchors: Array.from({ length: COMMENTS_MAX_ANCHORS + 1 }, () => item),
    })
    bad('comments.anchors', { version_id: 'v2', anchors: [] })
    bad('comments.anchors', { version_id: 'v2', anchors: [{ ...item, state: 'stale' }] }) // server-only
    bad('comments.anchors', { anchors: [item] })

    ok('mentions.search', { q: '' })
    ok('mentions.search', { q: 'nguyen', limit: 20 })
    bad('mentions.search', {})
    bad('mentions.search', { q: 'x', limit: 0 })
  })

  it('responses', () => {
    const ok = (type: string, p: unknown) => expect(env('response', type, p).ok).toBe(true)
    const bad = (type: string, p: unknown) => expect(env('response', type, p).ok).toBe(false)

    ok('comments.list', LIST)
    ok('comments.list', { comments: [], mentions: [], list_token: 'lt1:aa', unchanged: true })
    bad('comments.list', { comments: [], mentions: [], list_token: 'lt1:aa' })
    bad('comments.list', {
      comments: [{ body: 'no id' }],
      mentions: [],
      list_token: 'lt1:aa',
      unchanged: false,
    })
    bad('comments.list', { ...LIST, mentions: [{ user_id: 'u', state: 'gone' }] })
    // a tombstone: empty body, deleted_at set
    ok('comments.list', {
      ...LIST,
      comments: [
        {
          ...COMMENT,
          body: '',
          deleted_at: '2026-10-13T10:00:00Z',
          anchor: null,
          anchor_state: null,
        },
      ],
    })
    // fields a newer server adds pass through
    ok('comments.list', { ...LIST, comments: [{ ...COMMENT, reactions: [{ emoji: '+1' }] }] })

    for (const t of ['comments.create', 'comments.update', 'comments.resolve', 'comments.reopen']) {
      ok(t, { comment: COMMENT })
      bad(t, {})
    }
    ok('comments.delete', { outcome: 'tombstoned' })
    ok('comments.delete', { outcome: 'removed' })
    bad('comments.delete', { status: 'ok' })
    ok('comments.revisions', {
      revisions: [
        {
          id: 'r1',
          revision: 1,
          body: 'old',
          created_by_id: 'u',
          created_by_kind: 'human',
          created_at: 't',
        },
      ],
    })
    bad('comments.revisions', { revisions: [{ id: 'r1' }] })
    ok('comments.anchors', {
      updated: [COMMENT.id],
      skipped: [{ comment_id: 'c2', reason: 'older_version' }],
      list_token: 'lt1:bb',
    })
    bad('comments.anchors', {
      updated: [],
      skipped: [{ comment_id: 'c2', reason: 'nope' }],
      list_token: 'x',
    })
    ok('mentions.search', {
      candidates: [{ user_id: 'u1', display_name: 'An', email: 'a@x.test' }],
    })
    bad('mentions.search', { candidates: [{ display_name: 'An' }] })
    ok('comments.reveal', { revealed: false })
    bad('comments.reveal', {})
  })

  it('host -> frame: comments.changed event (id only) and comments.reveal request', () => {
    expect(env('event', 'comments.changed', { document_id: 'doc-1' }).ok).toBe(true)
    expect(env('event', 'comments.changed', {}).ok).toBe(false)
    expect(env('request', 'comments.reveal', { comment_id: COMMENT.id }).ok).toBe(true)
    expect(env('request', 'comments.reveal', { comment_id: '' }).ok).toBe(false)
  })
})

// ---------------------------------------------------------------- error mapping (§9)

describe('commentsErrorFromHttp (contract §9, fixed table)', () => {
  const body = (code: string) => ({ error: { code, message: 'x' } })

  it('409 comment_deleted -> conflict + details.code, not retryable (no reload path)', () => {
    const e = commentsErrorFromHttp(409, body('comment_deleted'))
    expect(e).toBeInstanceOf(DocsProtocolError)
    expect(e.toShape()).toMatchObject({
      code: 'conflict',
      status: 409,
      retryable: false,
      details: { code: 'comment_deleted' },
    })
  })

  it.each([
    [409, 'idempotency_payload_mismatch', 'conflict'],
    [400, 'anchor_version_invalid', 'malformed'],
    [400, 'invalid_request', 'malformed'],
    [413, 'payload_too_large', 'too_large'],
  ] as const)('%i %s -> %s with details.code', (status, code, expected) => {
    const e = commentsErrorFromHttp(status, body(code))
    expect(e.toShape()).toMatchObject({
      code: expected,
      status,
      retryable: false,
      details: { code },
    })
  })

  it.each([
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [404, 'not_found', false],
    [429, 'rate_limited', true],
    [500, 'internal', true],
    [503, 'internal', true],
  ] as const)('%i -> %s (retryable %s), no details', (status, code, retryable) => {
    const e = commentsErrorFromHttp(status, body('whatever'))
    expect(e.toShape()).toEqual({ code, status, retryable, message: expect.any(String) })
  })

  it('no HTTP response (status 0: fetch failed / offline) -> network, retryable', () => {
    expect(commentsErrorFromHttp(0).toShape()).toEqual({
      code: 'network',
      retryable: true,
      message: expect.any(String),
    })
  })

  it('reads a flat {code} body too, and tolerates garbage bodies', () => {
    expect(commentsErrorFromHttp(409, { code: 'comment_deleted' }).details).toEqual({
      code: 'comment_deleted',
    })
    expect(commentsErrorFromHttp(409, 'oops').toShape()).toMatchObject({
      code: 'conflict',
      retryable: false,
    })
    expect(commentsErrorFromHttp(409, 'oops').details).toBeUndefined()
    expect(commentsErrorFromHttp(400, null).code).toBe('malformed')
  })

  it('round-trips through a frame request: details.code arrives first-class', async () => {
    const { host, client } = setup({
      api: {
        'comments.update': async () => {
          throw commentsErrorFromHttp(409, body('comment_deleted'))
        },
      },
    })
    await host.whenReady()
    await client.whenInitialized()
    const err = await client
      .request('comments.update', { comment_id: COMMENT.id, body: 'draft' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DocsProtocolError)
    expect(err).toMatchObject({
      code: 'conflict',
      retryable: false,
      details: { code: 'comment_deleted' },
    })
  })
})

// ---------------------------------------------------------------- commentsLevel (OQ-C12)

describe('commentsLevel and the frame affordances', () => {
  const me = '01J8X4USR0AAAAAAAAAAAAAAAA'
  const mine = { author_id: me, deleted_at: null }
  const theirs = { author_id: '01J8X4USR0BBBBBBBBBBBBBBBB', deleted_at: null }
  const session = (over: Record<string, unknown> = {}) => ({
    capabilities: { comments: true },
    user: { displayName: 'An', id: me },
    ...over,
  })

  it('view: nothing that writes', () => {
    const a = commentsAccess(session({ commentsLevel: 'view' }))
    expect(a).toMatchObject({ enabled: true, level: 'view', canCreate: false })
    for (const action of ['edit', 'delete', 'resolve', 'reopen'] as const) {
      expect(canActOnComment(a, mine, action)).toBe(false)
    }
  })

  it('edit: compose, own edit/delete, resolve/reopen any', () => {
    const a = commentsAccess(session({ commentsLevel: 'edit' }))
    expect(a).toMatchObject({ enabled: true, level: 'edit', canCreate: true })
    expect(canActOnComment(a, mine, 'edit')).toBe(true)
    expect(canActOnComment(a, mine, 'delete')).toBe(true)
    expect(canActOnComment(a, theirs, 'edit')).toBe(false)
    expect(canActOnComment(a, theirs, 'delete')).toBe(false)
    expect(canActOnComment(a, theirs, 'resolve')).toBe(true)
    expect(canActOnComment(a, theirs, 'reopen')).toBe(true)
  })

  it('manage: edit/delete of others too', () => {
    const a = commentsAccess(session({ commentsLevel: 'manage' }))
    expect(canActOnComment(a, theirs, 'edit')).toBe(true)
    expect(canActOnComment(a, theirs, 'delete')).toBe(true)
  })

  it('missing level (host error): composer + own actions, never on others', () => {
    const a = commentsAccess(session())
    expect(a).toMatchObject({ enabled: true, level: null, canCreate: true })
    expect(canActOnComment(a, mine, 'edit')).toBe(true)
    expect(canActOnComment(a, mine, 'resolve')).toBe(true)
    for (const action of ['edit', 'delete', 'resolve', 'reopen'] as const) {
      expect(canActOnComment(a, theirs, action)).toBe(false)
    }
  })

  it('a 403 from the server turns the panel read-only', () => {
    const a = commentsAccess(session({ commentsLevel: 'manage' }), { forbidden: true })
    expect(a).toMatchObject({ enabled: true, level: 'view', canCreate: false })
    expect(canActOnComment(a, mine, 'edit')).toBe(false)
  })

  it('"mine" needs user.id; a tombstone takes no action; no capability = hidden', () => {
    const noId = commentsAccess(session({ commentsLevel: 'edit', user: { displayName: 'An' } }))
    expect(canActOnComment(noId, mine, 'edit')).toBe(false)
    const m = commentsAccess(session({ commentsLevel: 'manage' }))
    expect(canActOnComment(m, { ...mine, deleted_at: '2026-10-13T10:00:00Z' }, 'edit')).toBe(false)
    const off = commentsAccess({ capabilities: { comments: false }, commentsLevel: 'manage' })
    expect(off).toMatchObject({ enabled: false, canCreate: false })
    expect(canActOnComment(off, mine, 'edit')).toBe(false)
  })

  it('init with comments and no commentsLevel is a host error', () => {
    const withLevel = { ...baseInit(), protocolVersion: PROTOCOL_VERSION }
    expect(checkInitComments(withLevel)).toBeNull()
    const { commentsLevel: _l, ...noLevel } = withLevel
    const e = checkInitComments(noLevel)
    expect(e).toBeInstanceOf(DocsProtocolError)
    expect(e?.toShape()).toMatchObject({
      code: 'malformed',
      details: { code: 'comments_level_missing' },
    })
    // no comments capability: no level needed
    expect(checkInitComments({ ...noLevel, capabilities: { save: true } })).toBeNull()
  })

  it('the frame still accepts such an init and applies the missing-field rules', async () => {
    const { commentsLevel: _l, ...noLevel } = baseInit()
    const { host, client } = setup({ getInit: async () => noLevel })
    await host.whenReady()
    const s = await client.whenInitialized()
    expect(s.capabilities.comments).toBe(true)
    expect(s.commentsLevel).toBeUndefined()
    expect(commentsAccess(s)).toMatchObject({ enabled: true, level: null, canCreate: true })
  })

  it('the session carries user.id and commentsLevel; a re-init replaces them', async () => {
    let init = baseInit({ commentsLevel: 'manage' })
    const { host, client, frameWin, hostWin } = setup({ getInit: async () => init })
    await host.whenReady()
    const s = await client.whenInitialized()
    expect(s.user).toEqual({ displayName: 'An', id: '01J8X4USR0AAAAAAAAAAAAAAAA' })
    expect(s.commentsLevel).toBe('manage')
    // the host re-handshakes (new ready instance): fields absent the second time are cleared
    const { commentsLevel: _l, user: _u, ...bare } = baseInit()
    init = bare
    hostWin.deliver(
      {
        ns: PROTOCOL_NS,
        v: PROTOCOL_VERSION,
        id: 'f-x',
        kind: 'event',
        type: 'ready',
        payload: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { save: true, comments: true },
          instanceId: 'other',
        },
      },
      ORIGIN,
      frameWin,
    )
    await flush(60)
    expect(s.commentsLevel).toBeUndefined()
    expect(s.user).toBeUndefined()
  })
})

// ---------------------------------------------------------------- new frame <-> new host

describe('G8-08 new frame <-> new host', () => {
  it('every frame request reaches its host handler with the payload unchanged', async () => {
    const seen: Array<[string, unknown]> = []
    const rec =
      <R>(type: string, result: R) =>
      async (p: unknown) => {
        seen.push([type, p])
        return result
      }
    const api: ApiHandlers = {
      'comments.list': rec('comments.list', LIST),
      'comments.create': rec('comments.create', { comment: COMMENT }),
      'comments.update': rec('comments.update', { comment: COMMENT }),
      'comments.delete': rec('comments.delete', { outcome: 'tombstoned' as const }),
      'comments.resolve': rec('comments.resolve', { comment: COMMENT }),
      'comments.reopen': rec('comments.reopen', { comment: COMMENT }),
      'comments.revisions': rec('comments.revisions', { revisions: [] }),
      'comments.anchors': rec('comments.anchors', {
        updated: [],
        skipped: [],
        list_token: 'lt1:bb',
      }),
      'mentions.search': rec('mentions.search', { candidates: [] }),
    }
    const { host, client } = setup({ api })
    await host.whenReady()
    await client.whenInitialized()

    const create = { kind: 'comment' as const, parent_id: COMMENT.id, body: BODY_FIXTURE }
    expect(
      await client.request('comments.list', { kind: 'comment', since_token: 'lt1:00' }),
    ).toEqual(LIST)
    const created = await client.request('comments.create', create)
    // the body fixture round-trips byte for byte both ways
    expect(created.comment.body).toBe(BODY_FIXTURE)
    await client.request('comments.update', { comment_id: COMMENT.id, body: BODY_FIXTURE })
    expect(await client.request('comments.delete', { comment_id: COMMENT.id })).toEqual({
      outcome: 'tombstoned',
    })
    await client.request('comments.resolve', { comment_id: COMMENT.id })
    await client.request('comments.reopen', { comment_id: COMMENT.id })
    await client.request('comments.revisions', { comment_id: COMMENT.id })
    await client.request('comments.anchors', {
      version_id: 'v2',
      anchors: [{ comment_id: COMMENT.id, anchor: COMMENT.anchor!, state: 'lost' }],
    })
    await client.request('mentions.search', { q: 'ng' })

    expect(seen.map(([t]) => t)).toEqual(Object.keys(api))
    expect(seen[1]![1]).toEqual(create)
    expect((seen[2]![1] as { body: string }).body).toBe(BODY_FIXTURE)
  })

  it('since_token equal to the current token -> unchanged (the frame keeps its list)', async () => {
    const current = 'lt1:aa'
    const list = vi.fn(async (p: { since_token?: string }) =>
      p.since_token === current
        ? { comments: [], mentions: [], list_token: current, unchanged: true }
        : { ...LIST, list_token: current },
    )
    const { host, client } = setup({ api: { 'comments.list': list } })
    await host.whenReady()
    const first = await client.request('comments.list', {})
    expect(first.unchanged).toBe(false)
    const again = await client.request('comments.list', { since_token: first.list_token })
    expect(again).toEqual({ comments: [], mentions: [], list_token: current, unchanged: true })
  })

  it('comments.changed reaches the frame listener for this document only', async () => {
    const { host, client } = setup()
    await host.whenReady()
    await client.whenInitialized()
    const heard: string[] = []
    client.onCommentsChanged((p) => heard.push(p.document_id))
    host.notifyCommentsChanged('doc-2')
    host.notifyCommentsChanged('doc-1')
    await flush()
    expect(heard).toEqual(['doc-1'])
  })

  it('a host advertising comments without handlers answers unsupported', async () => {
    const { host, client } = setup()
    await host.whenReady()
    await expect(client.request('comments.list', {})).rejects.toMatchObject({ code: 'unsupported' })
  })
})

// ---------------------------------------------------------------- reveal ordering (§10)

describe('comments.reveal ordering and wait limit', () => {
  function revealSetup(listImpl: () => Promise<CommentsListResult>) {
    const p = setup({ api: { 'comments.list': listImpl } })
    const reveal = vi.fn(async ({ comment_id }: { comment_id: string }) => ({
      revealed: comment_id === COMMENT.id,
    }))
    p.client.handleCommentsReveal(reveal)
    return { ...p, reveal }
  }

  it('after the first list succeeded: answered at once', async () => {
    const { host, client, reveal } = revealSetup(async () => LIST)
    await host.whenReady()
    await client.request('comments.list', {})
    await expect(host.revealComment(COMMENT.id)).resolves.toEqual({ revealed: true })
    await expect(host.revealComment('missing')).resolves.toEqual({ revealed: false })
    expect(reveal).toHaveBeenCalledTimes(2)
  })

  it('before the first list: held, then answered right after the list succeeds', async () => {
    let release!: (r: CommentsListResult) => void
    const { host, client, reveal } = revealSetup(
      () => new Promise<CommentsListResult>((r) => (release = r)),
    )
    await host.whenReady()
    await client.whenInitialized()
    const listing = client.request('comments.list', {}, { timeoutMs: 0 })
    const revealing = host.revealComment(COMMENT.id)
    await flush(60)
    expect(reveal).not.toHaveBeenCalled()
    release(LIST)
    await listing
    await expect(revealing).resolves.toEqual({ revealed: true })
  })

  it('the first list fails while the reveal waits -> not_ready, retryable', async () => {
    let fail!: (e: unknown) => void
    const { host, client, reveal } = revealSetup(
      () => new Promise<CommentsListResult>((_r, j) => (fail = j)),
    )
    await host.whenReady()
    await client.whenInitialized()
    const listing = client.request('comments.list', {}, { timeoutMs: 0 }).catch(() => {})
    const frameAnswer = vi.fn()
    // retry: false shows the frame's own answer, without the host's single retry
    const revealing = host.revealComment(COMMENT.id, { retry: false }).catch((e: unknown) => {
      frameAnswer(e)
    })
    await flush(60)
    fail(commentsErrorFromHttp(503))
    await listing
    await revealing
    expect(frameAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'not_ready', retryable: true }),
    )
    expect(reveal).not.toHaveBeenCalled()
  })

  it('no list within the frame wait limit -> not_ready before the host times out', async () => {
    vi.useFakeTimers()
    const { host, client, reveal } = revealSetup(() => new Promise<CommentsListResult>(() => {}))
    await vi.advanceTimersByTimeAsync(0)
    await host.whenReady()
    await client.whenInitialized()
    void client.request('comments.list', {}, { timeoutMs: 0 }).catch(() => {})
    let outcome: unknown = 'pending'
    void host.revealComment(COMMENT.id, { retry: false }).then(
      (r) => (outcome = r),
      (e: unknown) => (outcome = e),
    )
    await vi.advanceTimersByTimeAsync(COMMENTS_REVEAL_WAIT_MS - 1)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome).toMatchObject({ code: 'not_ready', retryable: true })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('the host reveal timeout is never below 15 s even when the host default is lower', async () => {
    vi.useFakeTimers()
    const { host, client } = revealSetup(() => new Promise<CommentsListResult>(() => {}))
    await vi.advanceTimersByTimeAsync(0)
    await host.whenReady() // host timeoutMs is 1 s in this setup
    await client.whenInitialized()
    let outcome: unknown = 'pending'
    void host.revealComment(COMMENT.id, { retry: false }).then(
      (r) => (outcome = r),
      (e: unknown) => (outcome = e),
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(outcome).toBe('pending') // a 1 s transport timeout would have fired
    await vi.advanceTimersByTimeAsync(COMMENTS_REVEAL_WAIT_MS)
    expect(outcome).toMatchObject({ code: 'not_ready' }) // the frame's typed answer, not `timeout`
  })

  it('the host retries once on not_ready: after 2 s or on comments.changed, whichever first', async () => {
    let calls = 0
    let release!: (r: CommentsListResult) => void
    const { host, client } = revealSetup(() => {
      calls += 1
      return calls === 1
        ? Promise.reject(commentsErrorFromHttp(503))
        : new Promise<CommentsListResult>((r) => (release = r))
    })
    await host.whenReady()
    await client.whenInitialized()
    await client.request('comments.list', {}).catch(() => {}) // the first list failed
    const revealing = host.revealComment(COMMENT.id)
    await flush(60)
    // the frame said not_ready at once (last list failed, none in flight); the host waits
    const second = client.request('comments.list', {})
    release(LIST)
    await second
    host.notifyCommentsChanged('doc-1') // wakes the host's retry before the 2 s
    await expect(revealing).resolves.toEqual({ revealed: true })
  })

  it('a second failure gives up (rejects; the caller shows nothing)', async () => {
    const { host, client } = revealSetup(() => Promise.reject(commentsErrorFromHttp(503)))
    await host.whenReady()
    await client.whenInitialized()
    await client.request('comments.list', {}).catch(() => {})
    vi.useFakeTimers()
    const revealing = host.revealComment(COMMENT.id).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await revealing).toMatchObject({ code: 'not_ready' })
  })
})

// ---------------------------------------------------------------- old/new peers

/** a host from before G8-08: no comments capability, no handlers */
function legacyHost(hostWin: FakeWindow, frameWin: FakeWindow) {
  const rejects: RejectInfo[] = []
  const ep = new Endpoint({
    self: hostWin,
    peer: () => frameWin,
    allowedOrigins: [ORIGIN],
    idPrefix: 'h',
    timeoutMs: 1_000,
    onReject: (r) => rejects.push(r),
  })
  let sent = false
  ep.on('ready', () => {
    if (sent) return
    sent = true
    const { commentsLevel: _l, ...init } = baseInit({
      capabilities: { save: true },
      user: { displayName: 'An' },
    })
    void ep.request('init', { ...init, protocolVersion: PROTOCOL_VERSION }).catch(() => {})
  })
  live.push(ep)
  return { ep, rejects }
}

/** a frame from before G8-08: answers init, no comments claim, no reveal handler */
function legacyFrame(frameWin: FakeWindow, hostWin: FakeWindow) {
  const rejects: RejectInfo[] = []
  const ep = new Endpoint({
    self: frameWin,
    peer: () => hostWin,
    allowedOrigins: [ORIGIN],
    idPrefix: 'f',
    timeoutMs: 1_000,
    onReject: (r) => rejects.push(r),
  })
  ep.handle('init', () => ({ protocolVersion: PROTOCOL_VERSION, capabilities: { save: true } }))
  ep.handle('doc.closeCheck', () => ({ dirty: false, autoSave: false }))
  ep.emit('ready', { protocolVersion: PROTOCOL_VERSION, capabilities: { save: true } })
  live.push(ep)
  return { ep, rejects }
}

describe('G8-08 new frame -> old host', () => {
  it('no comments capability: server mode hidden, no request posted, no error event', async () => {
    const { host: hostWin, frame: frameWin } = wirePair()
    const old = legacyHost(hostWin, frameWin)
    const client = createDocsFrameClient({
      self: frameWin,
      parent: hostWin,
      allowedOrigins: [ORIGIN],
      capabilities: { save: true, comments: true },
      now: () => NOW,
      timeoutMs: 1_000,
    })
    live.push(client)
    const s = await client.whenInitialized()
    expect(s.capabilities.comments).toBe(false)
    expect(commentsAccess(s)).toMatchObject({ enabled: false, canCreate: false })
    const before = frameWin.sent.length
    await expect(client.request('comments.list', {})).rejects.toMatchObject({ code: 'unsupported' })
    await flush()
    expect(frameWin.sent.length).toBe(before) // nothing went to the host
    expect(old.rejects).toEqual([])
  })
})

describe('G8-08 old frame <- new host', () => {
  it('nothing changes: no reveal sent, comments.changed not sent, closeCheck works', async () => {
    const { host: hostWin, frame: frameWin } = wirePair()
    const hostRejects: RejectInfo[] = []
    const host = createDocsFrameHost({
      self: hostWin,
      frame: () => frameWin,
      allowedOrigins: [ORIGIN],
      getInit: async () => baseInit({ capabilities: { save: true, comments: true } }),
      refreshToken: async () => ({ token: 't', tokenExpiresAt: NOW + 60_000 }),
      onReject: (r) => hostRejects.push(r),
      timeoutMs: 1_000,
    })
    live.push(host)
    const old = legacyFrame(frameWin, hostWin)
    const ack = await host.whenReady()
    expect(ack.capabilities.comments).toBeUndefined()
    const before = hostWin.sent.length // what the host posts
    host.notifyCommentsChanged('doc-1')
    await expect(host.revealComment(COMMENT.id)).rejects.toMatchObject({ code: 'unsupported' })
    await flush()
    expect(hostWin.sent.length).toBe(before)
    expect(old.rejects).toEqual([])
    expect(hostRejects).toEqual([])
    await expect(host.closeCheck()).resolves.toEqual({ dirty: false, autoSave: false })
  })
})
