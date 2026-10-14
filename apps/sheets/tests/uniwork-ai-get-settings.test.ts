// @vitest-environment node
/**
 * No silent fallback (sheets): the standalone sheets get-settings resolves the provider through
 * selectedProvider() only, which keeps a saved `uniwork` while UniWork AI is not offered, and a
 * send with `uniwork` stops at the ai_disabled error before any provider config or call.
 * The handlers sit behind a per-tab session (created by the window code, not reachable from a
 * test), so the wiring is pinned from the source; the resolution itself is pinned on the real
 * selectedProvider() here and in packages/ai-provider tests.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultAiSettings, selectedProvider, setUniworkAiAvailable } from '@genoffice/ai-provider'

const source = readFileSync(join(__dirname, '..', 'src', 'main', 'sheets-main.ts'), 'utf8')

/** the text of one `ipcMain.handle(channel, ...)` block up to the next top-level handler */
function handlerBody(channel: string): string {
  const start = source.indexOf(`ipcMain.handle(${channel}`)
  expect(start).toBeGreaterThan(-1)
  const next = source.indexOf('\n  ipcMain.handle(', start + 1)
  return source.slice(start, next < 0 ? undefined : next)
}

describe('sheets AI settings keep uniwork', () => {
  afterEach(() => setUniworkAiAvailable(false))

  it('selectedProvider keeps a saved uniwork whether or not it is offered', () => {
    const settings = { ...defaultAiSettings(), provider: 'uniwork' as const }
    expect(selectedProvider(settings)).toBe('uniwork')
    setUniworkAiAvailable(true)
    expect(selectedProvider(settings)).toBe('uniwork')
  })

  it('get-settings resolves through selectedProvider only (no UniAI substitution)', () => {
    const body = handlerBody('IPC_CHANNELS.aiGetSettings')
    expect(body).toContain('settings.provider = selectedProvider(settings)')
    expect(body).not.toMatch(/provider = 'genspark'/)
  })

  it('a uniwork send ends in ai_disabled before any provider config or request', () => {
    const body = handlerBody('IPC_CHANNELS.aiStream')
    const guard = body.indexOf("provider === 'uniwork'")
    expect(guard).toBeGreaterThan(-1)
    expect(body.slice(guard)).toMatch(/^[^]*?uniworkCode: 'ai_disabled'[^]*?return/)
    // nothing that talks to a provider runs before the guard
    expect(body.slice(0, guard)).not.toMatch(/streamForProvider|chatForProvider/)
    expect(body.slice(guard, body.indexOf('return', guard))).not.toMatch(/streamForProvider/)
  })
})
