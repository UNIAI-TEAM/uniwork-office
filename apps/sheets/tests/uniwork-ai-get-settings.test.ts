// @vitest-environment node
/**
 * UniWork AI is the only provider (sheets, standalone): get-settings always answers `uniwork` (the
 * file only holds the cloud-tools opt-out), set-settings writes nothing else, and a send ends in
 * the ai_disabled error with no provider call. The handlers sit behind a per-tab session (created
 * by the window code, not reachable from a test), so the wiring is pinned from the source.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aiSettingsFileOf, defaultAiSettings } from '@genoffice/ai-provider'
import { aiSettingsInputSchema } from '../src/shared/desktop-api'

const source = readFileSync(join(__dirname, '..', 'src', 'main', 'sheets-main.ts'), 'utf8')

/** the text of one `ipcMain.handle(channel, ...)` block up to the next top-level handler */
function handlerBody(channel: string): string {
  const start = source.indexOf(`ipcMain.handle(${channel}`)
  expect(start).toBeGreaterThan(-1)
  const next = source.indexOf('\n  ipcMain.handle(', start + 1)
  return source.slice(start, next < 0 ? undefined : next)
}

describe('sheets AI settings are UniWork AI only', () => {
  it('the default provider is uniwork and the file shape drops every provider key', () => {
    expect(defaultAiSettings().provider).toBe('uniwork')
    expect(
      aiSettingsFileOf({ provider: 'openai', providers: { openai: { apiKey: 'sk-1' } } }),
    ).toEqual({ provider: 'uniwork', providers: {} })
  })

  it('get-settings answers the defaults plus the stored opt-out, never a stored provider', () => {
    const body = handlerBody('IPC_CHANNELS.aiGetSettings')
    expect(body).toContain('aiSettingsFileOf(')
    expect(body).toContain('...defaultAiSettings()')
    expect(body).not.toMatch(/resolveAiSettings|selectedProvider/)
  })

  it('set-settings writes through saveAiSettingsFile only', () => {
    const body = handlerBody('IPC_CHANNELS.aiSetSettings')
    expect(body).toMatch(/saveAiSettingsFile\(\s*SETTINGS_PATH\(\)/)
    expect(body).not.toContain('writeJsonAtomic')
  })

  it('the renderer request schema takes the UniWork settings and refuses a key-shaped field', () => {
    const settings = { provider: 'uniwork', providers: {}, gskToolsEnabled: false }
    expect(aiSettingsInputSchema.safeParse(settings).success).toBe(true)
    for (const bad of [
      { ...settings, providers: { openrouter: { apiKey: 'sk-or-1', model: 'm' } } },
      { ...settings, search: { provider: 'tavily', providers: { tavily: { apiKey: 'tv' } } } },
      { ...settings, maxOutputTokens: 4096 },
    ]) {
      expect(aiSettingsInputSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('a send ends in ai_disabled with no provider request', () => {
    const body = handlerBody('IPC_CHANNELS.aiStream')
    expect(body).toContain("uniworkCode: 'ai_disabled'")
    expect(body).not.toMatch(/streamForProvider|chatForProvider/)
  })
})
