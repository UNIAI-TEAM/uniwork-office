/**
 * UNI-2033 (T4): `comments.viewVersion` + capability `commentsViewVersion` + the comment wire field
 * `anchor_version_no`. PROTOCOL_VERSION stays 1; every new key is optional and additive.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocsFrameClient, type DocsFrameClientOptions } from '../client'
import { createDocsFrameHost, type DocsFrameHostOptions } from '../host'
import {
  CAPABILITY_KEYS,
  FRAME_REQUEST_TYPES,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  isCommentsRequestType,
  parseEnvelope,
  type DocumentComment,
  type InitPayload,
} from '../types'
import { ORIGIN, flush, wirePair } from './fake-windows'

const NOW = 1_000_000
const COMMENT_ID = '01J8X4CMTN0000000000000001'

const live: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const x of live.splice(0)) x.dispose()
})

const env = (kind: string, type: string, payload: unknown) =>
  parseEnvelope({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION, id: 'x1', kind, type, payload })

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
    capabilities: { save: true, comments: true, commentsViewVersion: true },
    user: { displayName: 'An', id: '01J8X4USR0AAAAAAAAAAAAAAAA' },
    commentsLevel: 'edit',
    ...over,
  }
}

function setup(
  hostOver: Partial<DocsFrameHostOptions> = {},
  clientOver: Partial<DocsFrameClientOptions> = {},
) {
  const { host: hostWin, frame: frameWin } = wirePair()
  const host = createDocsFrameHost({
    self: hostWin,
    frame: () => frameWin,
    allowedOrigins: [ORIGIN],
    getInit: async () => baseInit(),
    refreshToken: async () => ({ token: 't2', tokenExpiresAt: NOW + 60_000 }),
    timeoutMs: 1_000,
    ...hostOver,
  })
  const client = createDocsFrameClient({
    self: frameWin,
    parent: hostWin,
    allowedOrigins: [ORIGIN],
    capabilities: { save: true, comments: true, commentsViewVersion: true },
    now: () => NOW,
    timeoutMs: 1_000,
    ...clientOver,
  })
  live.push(host, client)
  return { host, client, frameWin }
}

describe('UNI-2033 protocol shape', () => {
  it('keeps PROTOCOL_VERSION 1 and adds the request and the capability', () => {
    expect(PROTOCOL_VERSION).toBe(1)
    expect(CAPABILITY_KEYS).toContain('commentsViewVersion')
    expect(FRAME_REQUEST_TYPES).toContain('comments.viewVersion')
    expect(isCommentsRequestType('comments.viewVersion')).toBe(true)
  })

  it('request payload: non-empty comment_id and a positive safe integer version_no', () => {
    const ok = (p: unknown) => expect(env('request', 'comments.viewVersion', p).ok).toBe(true)
    const bad = (p: unknown) => expect(env('request', 'comments.viewVersion', p).ok).toBe(false)
    ok({ comment_id: COMMENT_ID, version_no: 1 })
    ok({ comment_id: COMMENT_ID, version_no: 42 })
    bad({ comment_id: COMMENT_ID, version_no: 0 })
    bad({ comment_id: COMMENT_ID, version_no: -1 })
    bad({ comment_id: COMMENT_ID, version_no: 1.5 })
    bad({ comment_id: COMMENT_ID, version_no: '2' })
    bad({ comment_id: COMMENT_ID, version_no: Number.MAX_SAFE_INTEGER + 1 })
    bad({ comment_id: COMMENT_ID, version_no: Number.NaN })
    bad({ comment_id: COMMENT_ID })
    bad({ comment_id: '', version_no: 2 })
    bad({ version_no: 2 })
  })

  it('response payload: {opened: boolean}', () => {
    const ok = (p: unknown) => expect(env('response', 'comments.viewVersion', p).ok).toBe(true)
    const bad = (p: unknown) => expect(env('response', 'comments.viewVersion', p).ok).toBe(false)
    ok({ opened: true })
    ok({ opened: false })
    bad({})
    bad({ opened: 'yes' })
    bad({ opened: 1 })
  })

  it('comment wire field anchor_version_no: absent, null or a positive integer', () => {
    const comment: DocumentComment = {
      id: COMMENT_ID,
      document_id: 'doc-1',
      body: 'hello',
      anchor_version_id: '01J8X4VER00000000000000001',
      anchor_state: 'lost',
    }
    const list = (c: unknown) => ({
      comments: [c],
      mentions: [],
      list_token: 'lt1:aa',
      unchanged: false,
    })
    const valid = (c: unknown) => expect(env('response', 'comments.list', list(c)).ok).toBe(true)
    const invalid = (c: unknown) => expect(env('response', 'comments.list', list(c)).ok).toBe(false)
    valid(comment)
    valid({ ...comment, anchor_version_no: null })
    valid({ ...comment, anchor_version_no: 2 })
    invalid({ ...comment, anchor_version_no: 'two' })
    invalid({ ...comment, anchor_version_no: 0 })
    invalid({ ...comment, anchor_version_no: 1.5 })
    invalid({ ...comment, anchor_version_no: -3 })
  })
})

describe('UNI-2033 commentsViewVersion gating', () => {
  it('with the grant: the request reaches the host handler and its answer comes back', async () => {
    const seen: unknown[] = []
    const { host, client } = setup({
      api: {
        'comments.viewVersion': async (p) => {
          seen.push(p)
          return { opened: true }
        },
      },
    })
    await host.whenReady()
    const s = await client.whenInitialized()
    expect(s.capabilities.commentsViewVersion).toBe(true)
    await expect(
      client.viewCommentVersion({ comment_id: COMMENT_ID, version_no: 3 }),
    ).resolves.toEqual({ opened: true })
    expect(seen).toEqual([{ comment_id: COMMENT_ID, version_no: 3 }])
  })

  it('the host refuses to grant: unsupported and nothing is sent', async () => {
    const { host, client, frameWin } = setup({
      getInit: async () => baseInit({ capabilities: { save: true, comments: true } }),
      api: { 'comments.viewVersion': async () => ({ opened: true }) },
    })
    await host.whenReady()
    const s = await client.whenInitialized()
    expect(s.capabilities.commentsViewVersion).toBe(false)
    await flush()
    const before = frameWin.sent.length
    await expect(
      client.viewCommentVersion({ comment_id: COMMENT_ID, version_no: 3 }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await expect(
      client.request('comments.viewVersion', { comment_id: COMMENT_ID, version_no: 3 }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await flush()
    expect(frameWin.sent.length).toBe(before)
  })

  it('the frame does not claim it: unsupported and nothing is sent', async () => {
    const { host, client, frameWin } = setup(
      { api: { 'comments.viewVersion': async () => ({ opened: true }) } },
      { capabilities: { save: true, comments: true } },
    )
    await host.whenReady()
    await client.whenInitialized()
    await flush()
    const before = frameWin.sent.length
    await expect(
      client.viewCommentVersion({ comment_id: COMMENT_ID, version_no: 3 }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await flush()
    expect(frameWin.sent.length).toBe(before)
  })

  it('a grant without the comments capability still sends nothing', async () => {
    const { host, client, frameWin } = setup({
      getInit: async () =>
        baseInit({
          capabilities: { save: true, commentsViewVersion: true },
          commentsLevel: undefined,
        }),
    })
    await host.whenReady()
    await client.whenInitialized()
    await flush()
    const before = frameWin.sent.length
    await expect(
      client.viewCommentVersion({ comment_id: COMMENT_ID, version_no: 3 }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await flush()
    expect(frameWin.sent.length).toBe(before)
  })

  it('a host advertising it without a handler answers unsupported', async () => {
    const { host, client } = setup()
    await host.whenReady()
    await expect(
      client.viewCommentVersion({ comment_id: COMMENT_ID, version_no: 3 }),
    ).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('a malformed payload is refused by the host side validator, not forwarded', async () => {
    let called = 0
    const { host, client } = setup({
      api: {
        'comments.viewVersion': async () => {
          called += 1
          return { opened: true }
        },
      },
    })
    await host.whenReady()
    await client.whenInitialized()
    await expect(
      client.viewCommentVersion({ comment_id: COMMENT_ID, version_no: 0 }),
    ).rejects.toBeDefined()
    expect(called).toBe(0)
  })
})

describe('UNI-2033 README', () => {
  const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')
  it('documents the request and the capability row', () => {
    expect(readme).toMatch(/comments\.viewVersion/)
    expect(readme).toMatch(/\| `comments\.viewVersion`/)
    expect(readme).toMatch(/`commentsViewVersion`/)
    expect(readme).toMatch(/anchor_version_no/)
    expect(readme).toMatch(/version view/i)
  })
})
