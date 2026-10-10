// GO-B4/B5/B6: the optional `module` on `ready` / `init` (one protocol for every genoffice module).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocsFrameClient, type DocsFrameClientOptions } from '../client'
import { createDocsFrameHost, type DocsFrameHostOptions } from '../host'
import {
  DocsProtocolError,
  OFFICE_MODULES,
  PROTOCOL_NS,
  PROTOCOL_VERSION,
  checkFrameModule,
  isInitPayload,
  isInitRecovery,
  isOfficeModule,
  isReadyPayload,
  moduleOf,
  parseEnvelope,
  type InitPayload,
} from '../types'
import { ORIGIN, flush, wirePair } from './fake-windows'

const NOW = 1_000_000

const baseInit = (over: Partial<InitPayload> = {}): Omit<InitPayload, 'protocolVersion'> => ({
  token: 'tok-1',
  tokenExpiresAt: NOW + 10 * 60_000,
  documentId: 'doc-1',
  workspaceId: 'ws-1',
  apiBase: `${ORIGIN}/api`,
  apiMode: 'host-proxy',
  locale: 'vi',
  theme: 'light',
  capabilities: { save: true },
  ...over,
})

const live: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const x of live.splice(0)) x.dispose()
})

function setup(
  hostOver: Partial<DocsFrameHostOptions> = {},
  clientOver: Partial<DocsFrameClientOptions> = {},
) {
  const { host: hostWin, frame: frameWin } = wirePair()
  const onHandshakeError = vi.fn()
  const getInit = vi.fn(async () => baseInit())
  const host = createDocsFrameHost({
    self: hostWin,
    frame: () => frameWin,
    allowedOrigins: [ORIGIN],
    getInit,
    refreshToken: async () => ({ token: 'tok-2', tokenExpiresAt: NOW + 20 * 60_000 }),
    onHandshakeError,
    timeoutMs: 1_000,
    ...hostOver,
  })
  const client = createDocsFrameClient({
    self: frameWin,
    parent: hostWin,
    allowedOrigins: [ORIGIN],
    capabilities: { save: true },
    now: () => NOW,
    timeoutMs: 1_000,
    readyRetryMs: 50,
    readyMaxAttempts: 3,
    ...clientOver,
  })
  live.push(host, client)
  return { host, client, hostWin, frameWin, onHandshakeError, getInit }
}

const sentOfType = (sent: unknown[], type: string) =>
  sent.filter((m) => (m as { type?: string }).type === type) as Array<{
    payload: Record<string, unknown>
  }>

describe('OfficeModule', () => {
  it('lists the six modules; absent means docs', () => {
    expect(OFFICE_MODULES).toEqual(['docs', 'pdf', 'markdown', 'html', 'slides', 'sheets'])
    expect(isOfficeModule('sheets')).toBe(true)
    expect(isOfficeModule('xlsx')).toBe(false)
    expect(isOfficeModule(undefined)).toBe(false)
    expect(moduleOf({})).toBe('docs')
    expect(moduleOf(undefined)).toBe('docs')
    expect(moduleOf({ module: 'pdf' })).toBe('pdf')
  })

  it('validators: module is optional and must be a known module', () => {
    const ready = { protocolVersion: 1, capabilities: {} }
    expect(isReadyPayload(ready)).toBe(true)
    expect(isReadyPayload({ ...ready, module: 'slides' })).toBe(true)
    expect(isReadyPayload({ ...ready, module: 'word' })).toBe(false)
    expect(isReadyPayload({ ...ready, module: 1 })).toBe(false)
    const init = { ...baseInit(), protocolVersion: 1 }
    expect(isInitPayload(init)).toBe(true)
    expect(isInitPayload({ ...init, module: 'markdown' })).toBe(true)
    expect(isInitPayload({ ...init, module: 'Docs' })).toBe(false)
  })

  it('parseEnvelope rejects an unknown module on the wire as malformed', () => {
    const env = (payload: unknown) =>
      parseEnvelope({
        ns: PROTOCOL_NS,
        v: PROTOCOL_VERSION,
        id: 'f1',
        kind: 'event',
        type: 'ready',
        payload,
      })
    expect(env({ protocolVersion: 1, capabilities: {}, module: 'html' }).ok).toBe(true)
    expect(env({ protocolVersion: 1, capabilities: {}, module: 'exe' })).toMatchObject({
      ok: false,
      reason: 'malformed',
    })
  })

  it('checkFrameModule: null on a match, a typed malformed error otherwise', () => {
    expect(checkFrameModule({}, 'docs')).toBeNull()
    expect(checkFrameModule({ module: 'docs' }, 'docs')).toBeNull()
    expect(checkFrameModule({ module: 'pdf' }, 'pdf')).toBeNull()
    const e = checkFrameModule({}, 'sheets')
    expect(e).toBeInstanceOf(DocsProtocolError)
    expect(e?.code).toBe('malformed')
    expect(e?.details).toEqual({ frameModule: 'docs', expectedModule: 'sheets' })
  })
})

describe('handshake with modules', () => {
  it('a docs frame without the option sends no module (pre-module wire format)', async () => {
    const { host, frameWin, client } = setup()
    await host.whenReady()
    expect(sentOfType(frameWin.sent, 'ready')[0]?.payload).not.toHaveProperty('module')
    expect((await client.whenInitialized()).module).toBe('docs')
  })

  it('matching modules: ready and init carry it, the session reports it', async () => {
    const { host, client, hostWin, frameWin, getInit } = setup({ module: 'pdf' }, { module: 'pdf' })
    await host.whenReady()
    expect(sentOfType(frameWin.sent, 'ready')[0]?.payload.module).toBe('pdf')
    expect(getInit).toHaveBeenCalledWith(expect.objectContaining({ module: 'pdf' }))
    expect(sentOfType(hostWin.sent, 'init')[0]?.payload.module).toBe('pdf')
    expect((await client.whenInitialized()).module).toBe('pdf')
  })

  it('host refuses a frame of another module before minting a token', async () => {
    const { host, onHandshakeError, getInit, hostWin } = setup(
      { module: 'sheets' },
      { module: 'slides' },
    )
    await flush()
    expect(getInit).not.toHaveBeenCalled()
    expect(sentOfType(hostWin.sent, 'init')).toHaveLength(0)
    expect(onHandshakeError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'malformed',
        details: { frameModule: 'slides', expectedModule: 'sheets' },
      }),
    )
    expect(host.isReady).toBe(false)
  })

  it('an old docs frame (no module) is refused by a host expecting markdown', async () => {
    const { onHandshakeError } = setup({ module: 'markdown' })
    await flush()
    expect(onHandshakeError).toHaveBeenCalledWith(expect.objectContaining({ code: 'malformed' }))
  })

  it('getInit may name the module instead of the option; it is checked the same way', async () => {
    const getInit = vi.fn(async () => baseInit({ module: 'html' }))
    const { onHandshakeError, hostWin } = setup({ getInit }, { module: 'pdf' })
    await flush()
    expect(getInit).toHaveBeenCalled()
    expect(sentOfType(hostWin.sent, 'init')).toHaveLength(0)
    expect(onHandshakeError).toHaveBeenCalledWith(expect.objectContaining({ code: 'malformed' }))
  })

  it('the frame refuses an init for another module (host without the check)', async () => {
    const { client, onHandshakeError } = setup(
      { getInit: async () => ({ ...baseInit(), module: undefined }) },
      { module: 'html' },
    )
    // host has no module option and getInit names none: init goes out as docs, the html frame refuses it
    await expect(client.whenInitialized()).rejects.toMatchObject({ code: 'malformed' })
    await flush()
    expect(onHandshakeError).toHaveBeenCalledWith(expect.objectContaining({ code: 'malformed' }))
  })
})

describe('additive fields for the modules (GO-B4)', () => {
  const init = { ...baseInit(), protocolVersion: 1 }
  const open = {
    file: { fileId: 'f1', name: 'a.md' },
    source: { kind: 'url', url: `${ORIGIN}/f1` },
  }

  it('init.user is optional display data', () => {
    expect(isInitPayload({ ...init, user: { displayName: 'Lan' } })).toBe(true)
    expect(isInitPayload({ ...init, user: { displayName: '' } })).toBe(true)
    expect(isInitPayload({ ...init, user: {} })).toBe(false)
    expect(isInitPayload({ ...init, user: 'Lan' })).toBe(false)
  })

  it('open.assets maps relative paths to URLs', () => {
    expect(isInitPayload({ ...init, open })).toBe(true)
    expect(isInitPayload({ ...init, open: { ...open, assets: { 'assets/x.png': '/a/1' } } })).toBe(
      true,
    )
    expect(isInitPayload({ ...init, open: { ...open, assets: { 'assets/x.png': '' } } })).toBe(
      false,
    )
    expect(isInitPayload({ ...init, open: { ...open, assets: { 'x.png': 1 } } })).toBe(false)
    expect(isInitPayload({ ...init, open: { ...open, assets: ['x'] } })).toBe(false)
  })

  it('the frame session carries user (copied) and open.assets', async () => {
    const getInit = vi.fn(async () =>
      baseInit({
        user: { displayName: 'Lan' },
        open: { ...(open as InitPayload['open'] & object), assets: { 'img/a.png': '/x/a' } },
      }),
    )
    const { client } = setup({ getInit }, {})
    const session = await client.whenInitialized()
    expect(session.user).toEqual({ displayName: 'Lan' })
    expect(session.open?.assets).toEqual({ 'img/a.png': '/x/a' })
  })

  it('init.recovery carries a CryptoKey and a non-empty scope (C18)', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    expect(isInitPayload({ ...init, recovery: { key, scope: 'u1:d1' } })).toBe(true)
    expect(isInitPayload({ ...init, recovery: { key, scope: '' } })).toBe(false)
    expect(isInitPayload({ ...init, recovery: { key: 'k', scope: 'u1:d1' } })).toBe(false)
    expect(isInitPayload({ ...init, recovery: { scope: 'u1:d1' } })).toBe(false)
    expect(isInitRecovery({ key, scope: 'u1:d1' })).toBe(true)
  })

  it('the frame session carries recovery through structured clone', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const getInit = vi.fn(async () => baseInit({ recovery: { key, scope: 'u1:d1' } }))
    const { client } = setup({ getInit }, {})
    const session = await client.whenInitialized()
    expect(session.recovery?.scope).toBe('u1:d1')
    expect(session.recovery?.key).toBeInstanceOf(CryptoKey)
  })
})
