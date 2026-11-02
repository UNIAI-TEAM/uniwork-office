import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scrubFileSearchSetting } from '../src/main/app-settings-scrub'

/** The decision-model file search kept its keys in app-settings.json; they must not outlive it. */

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'app-settings-scrub-'))
  file = join(dir, 'app-settings.json')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('scrubFileSearchSetting', () => {
  it('drops fileSearch (and its keys) and keeps every other setting', () => {
    writeFileSync(
      file,
      JSON.stringify({
        language: 'vi',
        theme: 'dark',
        fileSearch: { rerank: true, keys: { openrouter: 'k' } },
      }),
    )
    scrubFileSearchSetting(file)
    const text = readFileSync(file, 'utf8')
    expect(text).not.toContain('fileSearch')
    expect(text).not.toContain('openrouter')
    expect(JSON.parse(text)).toEqual({ language: 'vi', theme: 'dark' })
  })

  it('does not rewrite a file that has no fileSearch', () => {
    writeFileSync(file, JSON.stringify({ language: 'vi' }))
    const past = new Date('2020-01-01T00:00:00Z')
    utimesSync(file, past, past)
    scrubFileSearchSetting(file)
    expect(statSync(file).mtimeMs).toBe(past.getTime())
  })

  it('does nothing for a missing file', () => {
    scrubFileSearchSetting(file)
    expect(() => readFileSync(file)).toThrow()
  })
})
