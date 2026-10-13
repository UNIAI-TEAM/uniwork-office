// @vitest-environment jsdom
// X-02: what every frame (Docs install.ts and installModuleBridge) claims in `ready`, against a real host.
import { afterEach, describe, expect, it } from 'vitest'
import { createDocsFrameClient } from '../protocol/client'
import { createDocsFrameHost } from '../protocol/host'
import { OFFICE_MODULES, type Capabilities, type OfficeModule } from '../protocol/types'
import { ORIGIN, wirePair } from '../protocol/test/fake-windows'
import { FRAME_BASE_CAPABILITIES } from './module-bridge'

const NOW = 1_000_000
const live: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const x of live.splice(0)) x.dispose()
})

async function effective(module: OfficeModule, granted: Capabilities): Promise<Capabilities> {
  const { host: hostWin, frame: frameWin } = wirePair()
  const host = createDocsFrameHost({
    self: hostWin,
    frame: () => frameWin,
    allowedOrigins: [ORIGIN],
    module,
    getInit: async () => ({
      token: 'tok',
      tokenExpiresAt: NOW + 600_000,
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      apiBase: `${ORIGIN}/api`,
      apiMode: 'host-proxy',
      locale: 'vi',
      theme: 'light',
      capabilities: granted,
    }),
    refreshToken: async () => ({ token: 'tok', tokenExpiresAt: NOW + 600_000 }),
    timeoutMs: 1_000,
  })
  const client = createDocsFrameClient({
    self: frameWin,
    parent: hostWin,
    allowedOrigins: [ORIGIN],
    // as install.ts / installModuleBridge build it: the shared keys, then the module's own
    capabilities: { ...FRAME_BASE_CAPABILITIES, save: true },
    ...(module === 'docs' ? {} : { module }),
    now: () => NOW,
    timeoutMs: 1_000,
  })
  live.push(host, client)
  return (await client.whenInitialized()).capabilities
}

describe('frame base capabilities (X-02)', () => {
  it('every frame claims download and does not claim uniworkAi yet (G6-05 flips it)', () => {
    expect(FRAME_BASE_CAPABILITIES).toMatchObject({ download: true, desktopOpen: true, ai: true })
    expect(FRAME_BASE_CAPABILITIES.uniworkAi).toBe(false)
  })

  it.each(OFFICE_MODULES)(
    '%s: download is effective after init when the host advertises it',
    async (m) => {
      expect((await effective(m, { save: true, download: true })).download).toBe(true)
    },
  )

  it.each(OFFICE_MODULES)('%s: no download without the host grant', async (m) => {
    expect((await effective(m, { save: true })).download).toBe(false)
  })

  it.each(OFFICE_MODULES)('%s: a host advertising uniworkAi gets no effective grant', async (m) => {
    expect((await effective(m, { ai: true, uniworkAi: true })).uniworkAi).toBe(false)
  })
})
