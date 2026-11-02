import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { saveAiSettingsFile, scrubAiSettingsFile } from '../src/settings-file'

const dir = mkdtempSync(join(tmpdir(), 'ai-settings-helper-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const OLD = {
  provider: 'openrouter',
  providers: { openrouter: { apiKey: 'sk-or-old', model: 'm' } },
  gskToolsEnabled: false,
}

describe('scrubAiSettingsFile', () => {
  it('drops old keys and keeps the opt-out', () => {
    const path = join(dir, 'old.json')
    writeFileSync(path, JSON.stringify(OLD))
    scrubAiSettingsFile(path)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      provider: 'uniwork',
      providers: {},
      gskToolsEnabled: false,
    })
    expect(readFileSync(path, 'utf8')).not.toContain('sk-')
  })

  it('does not write a file already in shape', () => {
    const path = join(dir, 'clean.json')
    writeFileSync(path, JSON.stringify({ provider: 'uniwork', providers: {} }))
    const past = new Date('2020-01-01T00:00:00Z')
    utimesSync(path, past, past)
    scrubAiSettingsFile(path)
    expect(statSync(path).mtimeMs).toBe(past.getTime())
  })

  it('never throws on a missing, corrupt or unwritable file and creates nothing', () => {
    const corrupt = join(dir, 'corrupt.json')
    writeFileSync(corrupt, '{ not json')
    expect(() => scrubAiSettingsFile(corrupt)).not.toThrow()
    expect(readFileSync(corrupt, 'utf8')).toBe('{ not json')
    const missing = join(dir, 'missing.json')
    expect(() => scrubAiSettingsFile(missing)).not.toThrow()
    expect(() => readFileSync(missing)).toThrow()
    expect(() => scrubAiSettingsFile(join(corrupt, 'nested.json'))).not.toThrow()
  })
})

describe('saveAiSettingsFile', () => {
  it('writes only the boolean opt-out, keeping the stored one when the payload has none', () => {
    const path = join(dir, 'save.json')
    writeFileSync(path, JSON.stringify(OLD))
    saveAiSettingsFile(path, { provider: 'openai', providers: { openai: { apiKey: 'sk-3' } } })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      provider: 'uniwork',
      providers: {},
      gskToolsEnabled: false,
    })
    saveAiSettingsFile(path, { gskToolsEnabled: true })
    expect(JSON.parse(readFileSync(path, 'utf8')).gskToolsEnabled).toBe(true)
  })
})
