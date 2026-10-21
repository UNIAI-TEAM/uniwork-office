import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerUniworkWork } from '../src/main/uniwork-work/wiring'
import { UNIWORK_WORK_CHANNELS as C } from '../src/shared/uniwork-work-api'

type Handler = (event: unknown, ...args: unknown[]) => unknown

function setup(
  profile: { apiOrigin: string } | null = { apiOrigin: 'https://uniwork.example/api' },
) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) }
  const openExternal = vi.fn(async (_url: string) => undefined)
  registerUniworkWork(ipc as unknown as IpcMain, {
    profile: () => profile as never,
    identity: () => ({ accountId: 'acc_1' }),
    org: () => ({ id: 'org_1', slug: 'acme' }),
    authorized: (call) => call('token'),
    openExternal,
  })
  return {
    call: (...args: unknown[]) => Promise.resolve(handlers.get(C.webUrl)?.({}, ...args)),
    openExternal,
  }
}

describe('uniwork-work webUrl (UNI-2047 A4: Copy link)', () => {
  it('answers the same URL openWeb would open, without opening anything', async () => {
    const { call, openExternal } = setup()
    expect(await call({ kind: 'document', orgSlug: 'acme', wsSlug: 'eng', id: 'd_1' })).toBe(
      'https://uniwork.example/acme/eng/documents/d_1',
    )
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('answers null for a bad target, a URL, no profile or an unparsable origin', async () => {
    const { call } = setup()
    for (const target of [
      { kind: 'document', orgSlug: 'acme', wsSlug: 'eng' },
      { kind: 'document', orgSlug: 'a/b', wsSlug: 'eng', id: 'd_1' },
      'https://evil.example',
      null,
    ]) {
      expect(await call(target)).toBeNull()
    }
    expect(await setup(null).call({ kind: 'onboarding' })).toBeNull()
    expect(await setup({ apiOrigin: 'not a url' }).call({ kind: 'onboarding' })).toBeNull()
  })
})
