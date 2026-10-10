import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocsFrameClient, type DocsFrameClient, type DocsFrameClientOptions } from '../client'
import { createDocsFrameHost, type DocsFrameHost, type DocsFrameHostOptions } from '../host'
import { Endpoint, validateOrigins, type RejectInfo } from '../endpoint'
import {
  DocsProtocolError,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  errorFromHttpStatus,
  type InitPayload,
} from '../types'
import { FakeWindow, ORIGIN, flush, wirePair } from './fake-windows'

const NOW = 1_000_000

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
    capabilities: { save: true, saveAs: true, print: true, ai: false },
    ...over,
  }
}

interface Setup {
  host: DocsFrameHost
  client: DocsFrameClient
  hostWin: FakeWindow
  frameWin: FakeWindow
  hostRejects: RejectInfo[]
  frameRejects: RejectInfo[]
  hostOpts: DocsFrameHostOptions
}

const live: Array<{ dispose(): void }> = []

function setup(
  hostOver: Partial<DocsFrameHostOptions> = {},
  clientOver: Partial<DocsFrameClientOptions> = {},
): Setup {
  const { host: hostWin, frame: frameWin } = wirePair()
  const hostRejects: RejectInfo[] = []
  const frameRejects: RejectInfo[] = []
  const hostOpts: DocsFrameHostOptions = {
    self: hostWin,
    frame: () => frameWin,
    allowedOrigins: [ORIGIN],
    getInit: vi.fn(async () => baseInit()),
    refreshToken: vi.fn(async () => ({ token: 'tok-2', tokenExpiresAt: NOW + 20 * 60_000 })),
    onReject: (r) => hostRejects.push(r),
    timeoutMs: 1_000,
    ...hostOver,
  }
  const host = createDocsFrameHost(hostOpts)
  const client = createDocsFrameClient({
    self: frameWin,
    parent: hostWin,
    allowedOrigins: [ORIGIN],
    capabilities: { save: true, saveAs: true, print: false, exportPdf: true },
    frameVersion: 'test-build',
    now: () => NOW,
    timeoutMs: 1_000,
    onReject: (r) => frameRejects.push(r),
    ...clientOver,
  })
  live.push(host, client)
  return { host, client, hostWin, frameWin, hostRejects, frameRejects, hostOpts }
}

afterEach(() => {
  for (const x of live.splice(0)) x.dispose()
  vi.useRealTimers()
})

describe('handshake', () => {
  it('ready -> init -> ack; token stays private; capabilities are intersected', async () => {
    const { host, client, hostOpts } = setup()
    const ack = await host.whenReady()
    const session = await client.whenInitialized()

    expect(ack).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      frameVersion: 'test-build',
      capabilities: {
        save: true,
        saveAs: true,
        recents: false,
        filePick: false,
        print: false, // granted by host, not supported by frame
        exportPdf: false, // supported by frame, not granted by host
        exportHtml: false,
        attachments: false,
        images: false,
        ai: false,
        webSearch: false,
        imageSearch: false,
        imageGeneration: false,
        desktopOpen: false,
      },
    })
    expect(session).toMatchObject({
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      apiMode: 'host-proxy',
    })
    expect(JSON.stringify(session)).not.toContain('tok-1')
    expect(JSON.stringify(client.session)).not.toContain('tok-1')
    expect(await client.getToken()).toBe('tok-1')
    expect(hostOpts.getInit).toHaveBeenCalledWith({
      protocolVersion: PROTOCOL_VERSION,
      frameVersion: 'test-build',
      capabilities: { save: true, saveAs: true, print: false, exportPdf: true },
      instanceId: expect.stringMatching(/^[0-9a-z]+$/),
    })
    expect(host.isReady).toBe(true)
  })

  it('every message on the wire carries ns + v', async () => {
    const { host, client, hostWin, frameWin } = setup()
    await host.whenReady()
    client.setDirty(true)
    await flush()
    const all = [...hostWin.sent, ...frameWin.sent] as Array<{ ns: string; v: number }>
    expect(all.length).toBeGreaterThanOrEqual(3)
    for (const m of all) expect(m).toMatchObject({ ns: PROTOCOL_NS, v: PROTOCOL_VERSION })
  })

  it('re-handshakes with a fresh init when the frame reloads', async () => {
    const { host, hostOpts, hostWin, frameWin } = setup()
    await host.whenReady()
    // a reloaded frame = a new client on the same window
    createDocsFrameClient({
      self: frameWin,
      parent: hostWin,
      allowedOrigins: [ORIGIN],
      capabilities: { save: true },
    }).whenInitialized()
    await flush(60)
    expect(hostOpts.getInit).toHaveBeenCalledTimes(2)
  })

  it('a frame reload in the middle of a handshake restarts it for the new frame', async () => {
    let releaseFirst!: () => void
    let calls = 0
    const getInit = vi.fn(async () => {
      calls += 1
      // the first getInit is slow; the frame reloads meanwhile
      if (calls === 1) await new Promise<void>((r) => (releaseFirst = r))
      return baseInit({ documentId: `doc-${calls}` })
    })
    const onHandshakeError = vi.fn()
    const { host, client, hostWin, frameWin } = setup(
      { getInit, onHandshakeError },
      { readyRetryMs: 10_000 },
    )
    await flush()
    expect(getInit).toHaveBeenCalledTimes(1)
    // the reloaded frame: a new client (new instanceId) on the same window
    client.dispose()
    const reloaded = createDocsFrameClient({
      self: frameWin,
      parent: hostWin,
      allowedOrigins: [ORIGIN],
      capabilities: { save: true },
      readyRetryMs: 10_000,
    })
    live.push(reloaded)
    await expect(reloaded.whenInitialized()).resolves.toMatchObject({ documentId: 'doc-2' })
    expect(getInit).toHaveBeenCalledTimes(2)
    // the stale handshake finishing late changes nothing
    releaseFirst()
    await flush(60)
    expect(host.isReady).toBe(true)
    expect(onHandshakeError).not.toHaveBeenCalled()
    expect(getInit).toHaveBeenCalledTimes(2)
  })

  it('ready retries of the same frame do not restart a handshake in flight', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const getInit = vi.fn(async () => {
      await new Promise<void>((r) => (release = r))
      return baseInit()
    })
    const { host } = setup({ getInit }, { readyRetryMs: 100 })
    await vi.advanceTimersByTimeAsync(1_000) // ~10 ready retries while getInit waits
    expect(getInit).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    await expect(host.whenReady()).resolves.toMatchObject({ protocolVersion: PROTOCOL_VERSION })
    expect(getInit).toHaveBeenCalledTimes(1)
  })

  it('whenInitialized rejects with timeout when no host ever answers ready', async () => {
    vi.useFakeTimers()
    const { host: hostWin, frame: frameWin } = wirePair()
    const client = createDocsFrameClient({
      self: frameWin,
      parent: hostWin,
      allowedOrigins: [ORIGIN],
      capabilities: {},
      readyRetryMs: 100,
      readyMaxAttempts: 5,
    })
    live.push(client)
    let outcome = 'pending'
    void client.whenInitialized().then(
      () => (outcome = 'ok'),
      (e: DocsProtocolError) => (outcome = e.code),
    )
    await vi.advanceTimersByTimeAsync(400)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(100)
    expect(outcome).toBe('timeout')
    const readies = frameWin.sent.filter((m) => (m as { type: string }).type === 'ready').length
    expect(readies).toBe(5)
  })

  it('whenInitialized rejects at once when the frame is not embedded (parent is itself)', async () => {
    const win = new FakeWindow(ORIGIN)
    win.peer = win
    const client = createDocsFrameClient({
      self: win,
      parent: win,
      allowedOrigins: [ORIGIN],
      capabilities: {},
    })
    live.push(client)
    await expect(client.whenInitialized()).rejects.toMatchObject({ code: 'not_ready' })
    expect(win.sent).toHaveLength(0)
  })

  it('getInit failure surfaces as a handshake error', async () => {
    const onHandshakeError = vi.fn()
    const { host } = setup({
      getInit: async () => Promise.reject(errorFromHttpStatus(403)),
      onHandshakeError,
    })
    await expect(host.whenReady({ timeoutMs: 200 })).rejects.toMatchObject({ code: 'forbidden' })
    expect(onHandshakeError).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }))
  })

  it('the frame keeps re-sending ready until a late host listens', async () => {
    vi.useFakeTimers()
    const { host: hostWin, frame: frameWin } = wirePair()
    const client = createDocsFrameClient({
      self: frameWin,
      parent: hostWin,
      allowedOrigins: [ORIGIN],
      capabilities: {},
      readyRetryMs: 100,
    })
    live.push(client)
    await vi.advanceTimersByTimeAsync(250) // ready x3 into the void
    const host = createDocsFrameHost({
      self: hostWin,
      frame: () => frameWin,
      allowedOrigins: [ORIGIN],
      getInit: async () => baseInit(),
      refreshToken: async () => ({ token: 'x', tokenExpiresAt: 0 }),
    })
    live.push(host)
    await vi.advanceTimersByTimeAsync(100)
    await expect(client.whenInitialized()).resolves.toMatchObject({ documentId: 'doc-1' })
    const readies = frameWin.sent.filter((m) => (m as { type: string }).type === 'ready').length
    await vi.advanceTimersByTimeAsync(1_000)
    expect(frameWin.sent.filter((m) => (m as { type: string }).type === 'ready').length).toBe(
      readies,
    )
  })
})

describe('origin and source checks', () => {
  it('rejects wildcard / malformed allowed origins at construction', () => {
    const { host: hostWin, frame: frameWin } = wirePair()
    const mk = (allowedOrigins: string[]) => () =>
      createDocsFrameHost({
        self: hostWin,
        frame: () => frameWin,
        allowedOrigins,
        getInit: async () => baseInit(),
        refreshToken: async () => ({ token: 'x', tokenExpiresAt: 0 }),
      })
    expect(mk(['*'])).toThrow(/invalid allowed origin/)
    expect(mk(['null'])).toThrow(/invalid allowed origin/)
    expect(mk([`${ORIGIN}/path`])).toThrow(/invalid allowed origin/)
    expect(mk([])).toThrow(/must not be empty/)
  })

  it('validateOrigins returns the first origin, the postMessage targetOrigin', () => {
    expect(validateOrigins([ORIGIN, 'https://other.test'])).toBe(ORIGIN)
  })

  it('targets the first allowed origin captured at construction', () => {
    const { host: hostWin } = wirePair()
    const origins = [ORIGIN]
    const posted: string[] = []
    const ep = new Endpoint({
      self: hostWin,
      peer: () => ({ postMessage: (_m, targetOrigin) => posted.push(targetOrigin) }),
      allowedOrigins: origins,
      idPrefix: 'h',
    })
    origins.length = 0 // a later edit to the caller's array must not change the target
    ep.emit('dirty', { dirty: true })
    expect(posted).toEqual([ORIGIN])
    ep.dispose()
  })

  it('drops messages from another origin even when the source is the peer', async () => {
    const { host, hostWin, frameWin, hostRejects } = setup()
    await host.whenReady()
    const onDirty = vi.fn()
    host.on('dirty', onDirty)
    const msg = {
      ns: PROTOCOL_NS,
      v: PROTOCOL_VERSION,
      id: 'x1',
      kind: 'event',
      type: 'dirty',
      payload: { dirty: true },
    }
    hostWin.deliver(msg, 'https://evil.test', frameWin)
    hostWin.deliver(msg, 'https://app.uniwork.test:8443', frameWin) // port differs = other origin
    await flush()
    expect(onDirty).not.toHaveBeenCalled()
    expect(hostRejects.map((r) => [r.reason, r.origin])).toEqual([
      ['origin', 'https://evil.test'],
      ['origin', 'https://app.uniwork.test:8443'],
    ])
  })

  it('drops messages from another window of the allowed origin', async () => {
    const { host, hostWin, hostRejects } = setup()
    await host.whenReady()
    const onTitle = vi.fn()
    host.on('title', onTitle)
    const sibling = new FakeWindow(ORIGIN)
    const msg = {
      ns: PROTOCOL_NS,
      v: PROTOCOL_VERSION,
      id: 'x1',
      kind: 'event',
      type: 'title',
      payload: { title: 'pwn' },
    }
    hostWin.deliver(msg, ORIGIN, sibling)
    hostWin.deliver(msg, ORIGIN, hostWin) // the page posting to itself
    await flush()
    expect(onTitle).not.toHaveBeenCalled()
    expect(hostRejects.map((r) => r.reason)).toEqual(['source', 'source'])
  })

  it('the frame ignores an init from a foreign origin (token never accepted)', async () => {
    const { frame: frameWin, host: hostWin } = wirePair()
    const rejects: RejectInfo[] = []
    const client = createDocsFrameClient({
      self: frameWin,
      parent: hostWin,
      allowedOrigins: [ORIGIN],
      capabilities: {},
      onReject: (r) => rejects.push(r),
    })
    live.push(client)
    frameWin.deliver(
      {
        ns: PROTOCOL_NS,
        v: PROTOCOL_VERSION,
        id: 'e1',
        kind: 'request',
        type: 'init',
        payload: { ...baseInit({ token: 'stolen' }), protocolVersion: PROTOCOL_VERSION },
      },
      'https://evil.test',
      hostWin,
    )
    await flush()
    expect(client.session).toBeNull()
    expect(rejects).toEqual([expect.objectContaining({ reason: 'origin' })])
  })

  it('silently ignores untagged foreign traffic', async () => {
    const { host, hostWin, frameWin, hostRejects } = setup()
    await host.whenReady()
    hostWin.deliver({ type: 'webpackHotUpdate' }, 'https://ext.test', {})
    hostWin.deliver('hello', ORIGIN, frameWin)
    await flush()
    expect(hostRejects).toEqual([])
  })
})

describe('version mismatch', () => {
  it('host reports a typed error when the frame speaks another version', async () => {
    const onHandshakeError = vi.fn()
    const { host: hostWin, frame: frameWin } = wirePair()
    const host = createDocsFrameHost({
      self: hostWin,
      frame: () => frameWin,
      allowedOrigins: [ORIGIN],
      getInit: vi.fn(async () => baseInit()),
      refreshToken: async () => ({ token: 'x', tokenExpiresAt: 0 }),
      onHandshakeError,
    })
    live.push(host)
    const waiting = host.whenReady({ timeoutMs: 500 })
    hostWin.deliver(
      {
        ns: PROTOCOL_NS,
        v: 2,
        id: 'f1',
        kind: 'event',
        type: 'ready',
        payload: { protocolVersion: 2, capabilities: {} },
      },
      ORIGIN,
      frameWin,
    )
    await expect(waiting).rejects.toBeInstanceOf(DocsProtocolError)
    await expect(waiting).rejects.toMatchObject({
      code: 'version_mismatch',
      details: { remoteVersion: 2, localVersion: PROTOCOL_VERSION },
    })
    expect(onHandshakeError).toHaveBeenCalledTimes(1)
  })

  it('answers a request from another version with a version_mismatch error', async () => {
    const { host, hostWin, frameWin } = setup()
    await host.whenReady()
    frameWin.sent.length = 0
    hostWin.deliver(
      { ns: PROTOCOL_NS, v: 99, id: 'f9', kind: 'request', type: 'api.recents', payload: {} },
      ORIGIN,
      frameWin,
    )
    await flush()
    expect(hostWin.sent.at(-1)).toMatchObject({
      v: PROTOCOL_VERSION,
      id: 'f9',
      kind: 'response',
      type: 'api.recents',
      error: { code: 'version_mismatch' },
    })
  })

  it('frame rejects an init whose protocolVersion differs', async () => {
    const { frame: frameWin, host: hostWin } = wirePair()
    const client = createDocsFrameClient({
      self: frameWin,
      parent: hostWin,
      allowedOrigins: [ORIGIN],
      capabilities: {},
    })
    live.push(client)
    // a host built against another contract that still frames v1 envelopes
    frameWin.deliver(
      {
        ns: PROTOCOL_NS,
        v: PROTOCOL_VERSION,
        id: 'h1',
        kind: 'request',
        type: 'init',
        payload: { ...baseInit(), protocolVersion: 7 },
      },
      ORIGIN,
      hostWin,
    )
    await expect(client.whenInitialized()).rejects.toMatchObject({ code: 'version_mismatch' })
    await flush()
    expect(client.session).toBeNull()
    expect(frameWin.sent.at(-1)).toMatchObject({
      id: 'h1',
      kind: 'response',
      error: { code: 'version_mismatch' },
    })
  })
})

describe('request/response correlation', () => {
  it('matches out-of-order responses to their callers', async () => {
    let releaseFirst!: () => void
    const { host, client } = setup({
      api: {
        'api.recents': async ({ limit }) => {
          if (limit === 1) await new Promise<void>((r) => (releaseFirst = r))
          return { files: [{ fileId: `f${limit}`, name: `n${limit}.docx` }] }
        },
      },
    })
    await host.whenReady()
    const a = client.request('api.recents', { limit: 1 })
    const b = client.request('api.recents', { limit: 2 })
    await expect(b).resolves.toEqual({ files: [{ fileId: 'f2', name: 'n2.docx' }] })
    releaseFirst()
    await expect(a).resolves.toEqual({ files: [{ fileId: 'f1', name: 'n1.docx' }] })
  })

  it('round-trips host->frame requests and binary payloads', async () => {
    const { host, client } = setup()
    const onOpen = vi.fn(async () => ({ opened: true as const, title: 'Report' }))
    client.handleOpen(onOpen)
    client.handleSave(async () => ({
      ok: true,
      file: { fileId: 'f1', name: 'Report.docx', etag: 'e2' },
      versionId: 'v2',
    }))
    client.handleCloseCheck(() => ({ dirty: true, autoSave: false }))
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4]).buffer
    // calls made before the handshake wait for it
    const opened = host.open({
      file: { fileId: 'f1', name: 'Report.docx' },
      source: { kind: 'bytes', data: bytes },
    })
    await expect(opened).resolves.toEqual({ opened: true, title: 'Report' })
    const got = (onOpen.mock.calls[0] as unknown[])[0] as { source: { data: ArrayBuffer } }
    expect([...new Uint8Array(got.source.data)]).toEqual([0x50, 0x4b, 3, 4])
    await expect(host.save({ reason: 'navigate' })).resolves.toMatchObject({
      ok: true,
      versionId: 'v2',
    })
    await expect(host.closeCheck()).resolves.toEqual({ dirty: true, autoSave: false })
  })

  it('ignores a response nobody is waiting for', async () => {
    const { host, hostWin, frameWin, hostRejects } = setup()
    await host.whenReady()
    hostWin.deliver(
      {
        ns: PROTOCOL_NS,
        v: PROTOCOL_VERSION,
        id: 'h404',
        kind: 'response',
        type: 'open',
        payload: { opened: true },
      },
      ORIGIN,
      frameWin,
    )
    await flush()
    expect(hostRejects).toEqual([expect.objectContaining({ reason: 'unexpected_response' })])
  })

  it('maps handler errors to typed errors (HTTP 412 -> conflict)', async () => {
    const { host, client } = setup({
      api: {
        'api.save': async () => {
          throw errorFromHttpStatus(412, 'etag mismatch')
        },
        'api.export': async () => {
          throw new Error('renderer exploded')
        },
      },
    })
    await host.whenReady()
    const save = client.request('api.save', { fileId: 'f1', data: new ArrayBuffer(1), etag: 'e1' })
    await expect(save).rejects.toBeInstanceOf(DocsProtocolError)
    await expect(save).rejects.toMatchObject({
      code: 'conflict',
      status: 412,
      message: 'etag mismatch',
    })
    await expect(
      client.request('api.export', { format: 'pdf', fileId: 'f1' }),
    ).rejects.toMatchObject({
      code: 'internal',
      message: 'renderer exploded',
    })
  })

  it('answers missing handlers with unsupported / unknown_type', async () => {
    const { host, client, hostWin, frameWin } = setup()
    await host.whenReady()
    await expect(
      client.request('image.fetch', { url: 'https://x.test/a.png' }),
    ).rejects.toMatchObject({
      code: 'unsupported',
    })
    hostWin.deliver(
      {
        ns: PROTOCOL_NS,
        v: PROTOCOL_VERSION,
        id: 'f77',
        kind: 'request',
        type: 'future.call',
        payload: {},
      },
      ORIGIN,
      frameWin,
    )
    await flush()
    expect(hostWin.sent.at(-1)).toMatchObject({ id: 'f77', error: { code: 'unknown_type' } })
  })
})

describe('app.open (A7 contract)', () => {
  it('round-trips through the host api handler; the capability defaults to false', async () => {
    const handler = vi.fn(async () => ({ outcome: 'installer' as const }))
    const { host, client } = setup(
      {
        getInit: vi.fn(async () => baseInit({ capabilities: { save: true, desktopOpen: true } })),
        api: { 'app.open': handler },
      },
      { capabilities: { save: true, desktopOpen: true } },
    )
    await host.whenReady()
    await client.whenInitialized()
    expect(client.session?.capabilities.desktopOpen).toBe(true)
    await expect(client.request('app.open', { feature: 'pdf.ocr' })).resolves.toEqual({
      outcome: 'installer',
    })
    expect(handler).toHaveBeenCalledWith({ feature: 'pdf.ocr' }, expect.anything())
  })

  it('an old host without a handler answers unsupported; no grant means capability false', async () => {
    const { host, client } = setup({}, { capabilities: { save: true, desktopOpen: true } })
    await host.whenReady()
    await client.whenInitialized()
    expect(client.session?.capabilities.desktopOpen).toBe(false)
    await expect(client.request('app.open', {})).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('the host rejects a bad payload before the handler runs', async () => {
    const handler = vi.fn(async () => ({ outcome: 'launched' as const }))
    const { host, client } = setup({ api: { 'app.open': handler } })
    await host.whenReady()
    await expect(
      client.request('app.open', { feature: 3 } as unknown as { feature: string }),
    ).rejects.toMatchObject({ code: 'malformed' })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('api.assets.resolve (A1b contract)', () => {
  it('round-trips through the host api handler', async () => {
    const handler = vi.fn(async () => ({ assets: { 'assets/a.png': '/f/a.png?sig=2' } }))
    const { host, client } = setup({ api: { 'api.assets.resolve': handler } })
    await host.whenReady()
    await client.whenInitialized()
    await expect(
      client.request('api.assets.resolve', { fileId: 'f1', paths: ['assets/a.png'] }),
    ).resolves.toEqual({ assets: { 'assets/a.png': '/f/a.png?sig=2' } })
    expect(handler).toHaveBeenCalledWith(
      { fileId: 'f1', paths: ['assets/a.png'] },
      expect.anything(),
    )
  })

  it('an old host without a handler answers unsupported', async () => {
    const { host, client } = setup({})
    await host.whenReady()
    await client.whenInitialized()
    await expect(
      client.request('api.assets.resolve', { paths: ['assets/a.png'] }),
    ).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('the host rejects 0 or 51 paths before the handler runs', async () => {
    const handler = vi.fn(async () => ({ assets: {} }))
    const { host, client } = setup({ api: { 'api.assets.resolve': handler } })
    await host.whenReady()
    await expect(client.request('api.assets.resolve', { paths: [] })).rejects.toMatchObject({
      code: 'malformed',
    })
    await expect(
      client.request('api.assets.resolve', {
        paths: Array.from({ length: 51 }, (_, i) => `p${i}.png`),
      }),
    ).rejects.toMatchObject({ code: 'malformed' })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('timeouts and cancellation', () => {
  it('rejects with timeout and clears the pending entry', async () => {
    vi.useFakeTimers()
    const { host, client } = setup({ api: { 'api.recents': () => new Promise(() => {}) } })
    await vi.advanceTimersByTimeAsync(0)
    await host.whenReady()
    const p = client.request('api.recents', {}, { timeoutMs: 250 })
    const settled = expect(p).rejects.toMatchObject({ code: 'timeout', retryable: true })
    await vi.advanceTimersByTimeAsync(250)
    await settled
  })

  it('timeoutMs 0 means no timeout (a request may wait on a user dialog)', async () => {
    vi.useFakeTimers()
    let answer!: (v: { files: [] }) => void
    const { host, client } = setup({
      api: { 'api.recents': () => new Promise((r) => (answer = r)) },
    })
    await vi.advanceTimersByTimeAsync(0)
    await host.whenReady()
    let outcome = 'pending'
    const p = client.request('api.recents', {}, { timeoutMs: 0 }).then(
      () => (outcome = 'resolved'),
      (e: DocsProtocolError) => (outcome = e.code),
    )
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(outcome).toBe('pending')
    answer({ files: [] })
    await vi.advanceTimersByTimeAsync(0)
    await p
    expect(outcome).toBe('resolved')
  })

  it('host.whenReady with timeoutMs 0 waits for the frame', async () => {
    vi.useFakeTimers()
    const { host } = setup({ getInit: vi.fn(() => new Promise<never>(() => {})) })
    let outcome = 'pending'
    void host.whenReady({ timeoutMs: 0 }).then(
      () => (outcome = 'ready'),
      (e: DocsProtocolError) => (outcome = e.code),
    )
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(outcome).toBe('pending')
  })

  it('a timeout also cancels the peer handler (the host can abort its upload)', async () => {
    vi.useFakeTimers()
    let handlerSignal: AbortSignal | undefined
    const { host, client, frameWin } = setup({
      api: {
        'api.save': (_p, ctx) => {
          handlerSignal = ctx.signal
          return new Promise(() => {})
        },
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    await host.whenReady()
    const p = client.request(
      'api.save',
      { fileId: 'f1', data: new ArrayBuffer(1) },
      { timeoutMs: 250 },
    )
    const settled = expect(p).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(0)
    expect(handlerSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(250)
    await settled
    expect(frameWin.sent.at(-1)).toMatchObject({ kind: 'event', type: 'cancel' })
    await vi.advanceTimersByTimeAsync(0)
    expect(handlerSignal?.aborted).toBe(true)
  })

  it('AbortSignal cancels the request and aborts the peer handler', async () => {
    let handlerSignal: AbortSignal | undefined
    const { host, client } = setup({
      api: {
        'api.export': (_p, ctx) => {
          handlerSignal = ctx.signal
          return new Promise(() => {})
        },
      },
    })
    await host.whenReady()
    const ac = new AbortController()
    const p = client.request('api.export', { format: 'pdf', fileId: 'f1' }, { signal: ac.signal })
    await flush()
    expect(handlerSignal?.aborted).toBe(false)
    ac.abort()
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
    await flush()
    expect(handlerSignal?.aborted).toBe(true)
  })

  it('an already-aborted signal never sends', async () => {
    const { host, client, frameWin } = setup()
    await host.whenReady()
    const before = frameWin.sent.length
    await expect(
      client.request('api.recents', {}, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(frameWin.sent.length).toBe(before)
  })

  it('dispose rejects in-flight requests and stops listening', async () => {
    const { host, client, hostWin } = setup({ api: { 'api.recents': () => new Promise(() => {}) } })
    await host.whenReady()
    const p = client.request('api.recents', {})
    await flush()
    client.dispose()
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
    host.dispose()
    expect(hostWin.listenerCount).toBe(0)
  })

  it('host.whenReady times out when no frame shows up', async () => {
    vi.useFakeTimers()
    const { host: hostWin, frame: frameWin } = wirePair()
    const host = createDocsFrameHost({
      self: hostWin,
      frame: () => frameWin,
      allowedOrigins: [ORIGIN],
      getInit: async () => baseInit(),
      refreshToken: async () => ({ token: 'x', tokenExpiresAt: 0 }),
    })
    live.push(host)
    const p = host.save({ reason: 'user' }, { timeoutMs: 300 })
    const settled = expect(p).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(300)
    await settled
  })
})

describe('malformed messages', () => {
  it('answers a malformed request with a malformed error', async () => {
    const { host, hostWin, frameWin, hostRejects } = setup()
    await host.whenReady()
    hostWin.deliver(
      {
        ns: PROTOCOL_NS,
        v: PROTOCOL_VERSION,
        id: 'f5',
        kind: 'request',
        type: 'api.save',
        payload: { fileId: 'f1', data: 'not-bytes' },
      },
      ORIGIN,
      frameWin,
    )
    await flush()
    expect(hostWin.sent.at(-1)).toMatchObject({
      id: 'f5',
      kind: 'response',
      error: { code: 'malformed' },
    })
    expect(hostRejects).toEqual([expect.objectContaining({ reason: 'malformed' })])
  })

  it('rejects the caller when the peer answers with a malformed payload', async () => {
    const { host, client } = setup({
      api: { 'api.recents': async () => ({ files: 'nope' }) as never },
    })
    await host.whenReady()
    await expect(client.request('api.recents', {})).rejects.toMatchObject({ code: 'malformed' })
  })

  it('drops tagged garbage without crashing and keeps working', async () => {
    const { host, client, hostWin, frameWin } = setup()
    await host.whenReady()
    for (const junk of [
      { ns: PROTOCOL_NS },
      { ns: PROTOCOL_NS, v: 'one', id: 1, kind: 'x' },
      {
        ns: PROTOCOL_NS,
        v: PROTOCOL_VERSION,
        id: 'a',
        kind: 'event',
        type: 'resize',
        payload: { height: -5 },
      },
    ]) {
      hostWin.deliver(junk, ORIGIN, frameWin)
    }
    const onTitle = vi.fn()
    host.on('title', onTitle)
    client.setTitle('ok')
    await flush()
    expect(onTitle).toHaveBeenCalledWith({ title: 'ok' })
  })
})

describe('events', () => {
  it('frame -> host: dirty (deduplicated), title, resize, saved, error', async () => {
    const { host, client } = setup()
    await host.whenReady()
    const seen: unknown[] = []
    for (const t of ['dirty', 'title', 'resize', 'saved', 'error'] as const) {
      host.on(t, (p) => seen.push([t, p]))
    }
    client.setDirty(true)
    client.setDirty(true)
    client.setDirty(false)
    client.setTitle('Report')
    client.reportHeight(812.4)
    client.reportSaved({
      file: { fileId: 'f1', name: 'R.docx' },
      versionId: 'v3',
      initiatedByFrame: true,
    })
    client.reportError(errorFromHttpStatus(500), true)
    await flush()
    expect(seen).toEqual([
      ['dirty', { dirty: true }],
      ['dirty', { dirty: false }],
      ['title', { title: 'Report' }],
      ['resize', { height: 813 }],
      [
        'saved',
        { file: { fileId: 'f1', name: 'R.docx' }, versionId: 'v3', initiatedByFrame: true },
      ],
      [
        'error',
        {
          error: { code: 'internal', message: 'HTTP 500', status: 500, retryable: true },
          fatal: true,
        },
      ],
    ])
  })

  it('frame -> host: an unchanged dirty flag is sent again only when forced', async () => {
    const { host, client } = setup()
    await host.whenReady()
    const seen: unknown[] = []
    host.on('dirty', (p) => seen.push(p))
    client.setDirty(true)
    client.setDirty(true)
    client.setDirty(true, { force: true })
    client.setDirty(true)
    await flush()
    expect(seen).toEqual([{ dirty: true }, { dirty: true }])
  })

  it('frame -> host: modal open/close (deduplicated, starts closed)', async () => {
    const { host, client } = setup()
    await host.whenReady()
    const seen: unknown[] = []
    host.on('modal', (p) => seen.push(p))
    client.setModal(false)
    client.setModal(true)
    client.setModal(true)
    client.setModal(false)
    await flush()
    expect(seen).toEqual([{ open: true }, { open: false }])
  })

  it('host -> frame: theme, language, file.renamed', async () => {
    const { host, client } = setup()
    await host.whenReady()
    const onTheme = vi.fn()
    const onLang = vi.fn()
    const onRenamed = vi.fn()
    client.onTheme(onTheme)
    client.onLanguage(onLang)
    client.onFileRenamed(onRenamed)
    host.setTheme('dark')
    host.setLanguage('en')
    host.notifyRenamed({ fileId: 'f1', name: 'New.docx' })
    await flush()
    expect(onTheme).toHaveBeenCalledWith('dark')
    expect(onLang).toHaveBeenCalledWith('en')
    expect(onRenamed).toHaveBeenCalledWith({ fileId: 'f1', name: 'New.docx' })
    expect(client.session).toMatchObject({ theme: 'dark', locale: 'en' })
  })
})

describe('token refresh (cookie-free auth)', () => {
  it('refreshes once for concurrent callers when the token is about to expire', async () => {
    const refreshToken = vi.fn(async () => ({ token: 'tok-2', tokenExpiresAt: NOW + 30 * 60_000 }))
    const { host, client } = setup({
      refreshToken,
      getInit: async () => baseInit({ tokenExpiresAt: NOW + 30_000 }), // inside the 60 s lead
    })
    await host.whenReady()
    const tokens = await Promise.all([client.getToken(), client.getToken(), client.getToken()])
    expect(tokens).toEqual(['tok-2', 'tok-2', 'tok-2'])
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(refreshToken).toHaveBeenCalledWith('expiring')
    expect(await client.getToken()).toBe('tok-2') // now fresh: no second refresh
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('a failed refresh rejects as unauthorized', async () => {
    const { host, client } = setup({
      refreshToken: async () => Promise.reject(new Error('session ended')),
      getInit: async () => baseInit({ tokenExpiresAt: NOW }),
    })
    await host.whenReady()
    await expect(client.getToken()).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('accepts a proactive token.update from the host, ignores an older one', async () => {
    const { host, client } = setup()
    await host.whenReady()
    host.pushToken({ token: 'tok-pushed', tokenExpiresAt: NOW + 50 * 60_000 })
    await flush()
    expect(await client.getToken()).toBe('tok-pushed')
    host.pushToken({ token: 'tok-old', tokenExpiresAt: NOW + 5 * 60_000 })
    await flush()
    expect(await client.getToken()).toBe('tok-pushed')
  })

  it('fetchApi sends the bearer token without cookies and retries once after 401', async () => {
    const calls: Array<{ url: string; auth: string | null; credentials?: RequestCredentials }> = []
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization')
      calls.push({ url: String(url), auth, credentials: init?.credentials })
      return new Response(null, { status: auth === 'Bearer tok-1' ? 401 : 200 })
    })
    const { host, client } = setup(
      { getInit: async () => baseInit({ apiMode: 'direct' }) },
      { fetch: fetchMock as unknown as typeof fetch },
    )
    await host.whenReady()
    const res = await client.fetchApi('/files/f1/content', {
      headers: { Accept: 'application/octet-stream' },
    })
    expect(res.status).toBe(200)
    expect(calls).toEqual([
      { url: `${ORIGIN}/api/files/f1/content`, auth: 'Bearer tok-1', credentials: 'omit' },
      { url: `${ORIGIN}/api/files/f1/content`, auth: 'Bearer tok-2', credentials: 'omit' },
    ])
  })

  it('fetchApi never sends the token outside apiBase', async () => {
    const fetchMock = vi.fn()
    const { host, client } = setup({}, { fetch: fetchMock as unknown as typeof fetch })
    await host.whenReady()
    await expect(client.fetchApi('https://evil.test/api/x')).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(client.fetchApi(`${ORIGIN}/apix/steal`)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('api requests before init wait for the handshake instead of failing', async () => {
    const { client } = setup({
      api: { 'api.recents': async () => ({ files: [] }) },
    })
    // no await on host.whenReady(): the client queues behind init
    await expect(client.request('api.recents', {})).resolves.toEqual({ files: [] })
  })
})
