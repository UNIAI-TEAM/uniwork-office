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

  it('a send ends in ai_disabled with no provider request', () => {
    const body = handlerBody('IPC_CHANNELS.aiStream')
    expect(body).toContain("uniworkCode: 'ai_disabled'")
    expect(body).not.toMatch(/streamForProvider|chatForProvider/)
  })

  it('the panel send entry (presets, retry, queue, selection ask all land in handleSend) stops on the model-need hint', () => {
    // App.tsx cannot be mounted in a unit test; the one shared entry is pinned from the source
    const app = readFileSync(join(__dirname, '..', 'src', 'renderer', 'App.tsx'), 'utf8')
    expect(app).toMatch(/const needModelHint = useAiModelNeedHint\(\)/)
    const start = app.indexOf('  function handleSend(')
    expect(start).toBeGreaterThan(-1)
    const body = app.slice(start, app.indexOf('runToolsRef.current = []', start))
    expect(body).toMatch(/needModelHint !== null/)
  })
})
