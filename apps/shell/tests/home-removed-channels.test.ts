import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOME_CHANNELS } from '../src/shared/home-api'

const REMOVED_KEYS = ['pushAiPreset', 'fileExcerpts', 'activeOfficeTab', 'openCreditUsage']
const REMOVED_CHANNELS = [
  'home:push-ai-preset',
  'home:file-excerpts',
  'home:active-office-tab',
  'home:open-credit-usage',
  'my-ai:ai-preset',
]

// My AI and the OpenRouter credit wallet are gone, so are the four Home channels that served them
describe('the Home channels of My AI and the credit wallet', () => {
  it('are not in HOME_CHANNELS', () => {
    for (const key of REMOVED_KEYS) expect(Object.keys(HOME_CHANNELS)).not.toContain(key)
    const values: string[] = Object.values(HOME_CHANNELS)
    for (const channel of REMOVED_CHANNELS) expect(values).not.toContain(channel)
  })

  it('are not registered by the main process, the shell preload or any editor preload', () => {
    const srcs = [
      '../src/main/index.ts',
      '../src/preload/index.ts',
      '../../docs/src/preload/index.ts',
      '../../sheets/src/preload/index.ts',
      '../../pdf/src/preload/index.ts',
      '../../slides/src/preload/index.ts',
    ].map((rel) => readFileSync(join(__dirname, rel), 'utf8'))
    srcs.push(readFileSync(join(__dirname, '../src/main/tab-manager.ts'), 'utf8'))
    for (const text of srcs) {
      for (const channel of REMOVED_CHANNELS) expect(text).not.toContain(channel)
      // tab-manager keeps `activeOfficeTab()` for activeFilePath(); only the Home exposures are gone
      for (const key of REMOVED_KEYS.filter((k) => k !== 'activeOfficeTab'))
        expect(text).not.toMatch(new RegExp(`\\b${key}\\b`))
    }
  })
})
