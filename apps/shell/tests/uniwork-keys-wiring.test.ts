/**
 * G6-05k fx2 (G05KSH-18): the account-scoped model pick store on a real app-settings.json and the
 * revoked-device wiring of the keys host. Host behaviour is in uniwork-keys.test.ts.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appSettingsModelPicks,
  refreshAfterDeviceRevoked,
} from '../src/main/uniwork-auth/keys-wiring'

let dir = ''
let file = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uniwork-picks-'))
  file = join(dir, 'app-settings.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const onDisk = (): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8'))
const choice = (model: string, updatedAt = 1) => ({ model, updatedAt })

describe('appSettingsModelPicks on app-settings.json', () => {
  it('round-trips a pick per scope and provider, keeping the other settings and scopes', () => {
    writeFileSync(
      file,
      JSON.stringify({ uiLang: 'vi', uniworkOrgId: { accountId: 'a', orgId: 'o' } }),
    )
    const store = appSettingsModelPicks(() => file)
    expect(store.read('d|acc1|org1')).toEqual({})

    store.write('d|acc1|org1', 'anthropic', choice('claude-a'))
    store.write('d|acc1|org1', 'openai', choice('gpt-a', 2))
    store.write('d|acc2|org1', 'anthropic', choice('claude-b', 3))
    store.write('d|acc1|org1', 'anthropic', choice('claude-c', 4))

    expect(store.read('d|acc1|org1')).toEqual({
      anthropic: choice('claude-c', 4),
      openai: choice('gpt-a', 2),
    })
    expect(store.read('d|acc2|org1')).toEqual({ anthropic: choice('claude-b', 3) })
    expect(store.read('d|acc1|org2')).toEqual({})
    const saved = onDisk()
    expect(saved.uiLang).toBe('vi')
    expect(saved.uniworkOrgId).toEqual({ accountId: 'a', orgId: 'o' })
    expect(Object.keys(saved.uniworkAiModelPicks as object).sort()).toEqual([
      'd|acc1|org1',
      'd|acc2|org1',
    ])
    // a second store on the same file sees the same picks (they live on disk, not in memory)
    expect(appSettingsModelPicks(() => file).read('d|acc2|org1')).toEqual({
      anthropic: choice('claude-b', 3),
    })
  })

  it('reads nothing from a missing or corrupt file and writes a valid one over it', () => {
    const store = appSettingsModelPicks(() => file)
    expect(store.read('s')).toEqual({})
    writeFileSync(file, '{not json')
    expect(store.read('s')).toEqual({})
    store.write('s', 'openai', choice('gpt-a'))
    expect(onDisk().uniworkAiModelPicks).toEqual({ s: { openai: choice('gpt-a') } })
  })

  it('ignores a picks entry of the wrong shape instead of throwing', () => {
    for (const bad of [[], 'x', 7, null, { s: 'x' }, { s: [] }]) {
      writeFileSync(file, JSON.stringify({ uiLang: 'en', uniworkAiModelPicks: bad }))
      const store = appSettingsModelPicks(() => file)
      expect(store.read('s')).toEqual({})
      store.write('s', 'openai', choice('gpt-a'))
      expect(store.read('s')).toEqual({ openai: choice('gpt-a') })
      expect(onDisk().uiLang).toBe('en')
    }
  })
})

describe('revoked device -> account refresh', () => {
  it('asks the account to refresh, once per call, and swallows a failing refresh', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('offline')
    })
    const onRevoked = refreshAfterDeviceRevoked({ refresh })
    expect(() => onRevoked()).not.toThrow()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('is what the shell hands to the keys host', () => {
    const src = readFileSync(join(__dirname, '../src/main/uniwork-auth/index.ts'), 'utf8')
    expect(src).toMatch(/onDeviceRevoked: refreshAfterDeviceRevoked\(account\)/)
    expect(src).toMatch(/modelPicks: settingsPath \? appSettingsModelPicks\(settingsPath\)/)
  })
})
