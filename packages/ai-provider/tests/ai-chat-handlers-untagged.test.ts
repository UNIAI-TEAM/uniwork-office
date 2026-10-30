import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The handlers live inside Electron main modules, so these guard their source.
const ROOT = resolve(__dirname, '../../..')
const DOCS_MAIN = 'apps/docs/src/main/docs-main.ts'
const SHEETS_MAIN = 'apps/sheets/src/main/sheets-main.ts'
const SLIDES_AI = 'apps/slides/src/main/ai-ipc.ts'

// UniWork AI is the only provider: no main module sends a request to a provider any more, so none
// registers the one-shot chat or imports the provider chat/stream calls.
describe('no main module talks to a provider', () => {
  for (const file of [DOCS_MAIN, SHEETS_MAIN, SLIDES_AI]) {
    it(`${file} has no one-shot chat and no provider stream`, () => {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      expect(text).not.toMatch(/'ai:chat'|IPC_CHANNELS\.aiChat\b/)
      expect(text).not.toMatch(/chatForProvider|streamForProvider|testChatConnection/)
    })
  }
})

// The AI panels ask the cloud status when they open; the plan may have changed on the server since
// the last read, so the handler re-reads before answering.
describe('ai:gsk-status', () => {
  for (const file of [DOCS_MAIN, SHEETS_MAIN, SLIDES_AI]) {
    it(`${file} re-reads the plan before answering`, () => {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      expect(text).toMatch(/await refreshUniworkCloudStatus\(\)\n\s*if \(!hasGskAuth\(\)\)/)
    })
  }
})
