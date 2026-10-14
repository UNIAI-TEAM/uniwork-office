// The UniWork AI flag is pulled over 'uniwork:ai-flag' by every renderer, but only the shell main
// registers it. A standalone app has no UniWork session, so its main answers "off" itself instead
// of leaving the pull to fail with "No handler registered" in the console on every run.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  UNIWORK_AI_FLAG_GET,
  answerUniworkAiFlagOff,
  parseUniworkAiFlag,
} from '../src/uniwork-ai-flag'

describe('answerUniworkAiFlagOff', () => {
  it('registers the pull channel and answers false, which the renderer parses as hidden', async () => {
    const handlers = new Map<string, () => unknown>()
    answerUniworkAiFlagOff({ handle: (channel, fn) => void handlers.set(channel, fn) })
    expect([...handlers.keys()]).toEqual([UNIWORK_AI_FLAG_GET])
    const answer = await handlers.get(UNIWORK_AI_FLAG_GET)!()
    expect(answer).toBe(false)
    expect(parseUniworkAiFlag(answer)).toBe(false)
  })

  it('every standalone editor main answers the pull; the shell registers the real flag instead', () => {
    const apps = join(__dirname, '../../../apps')
    for (const app of ['docs', 'sheets', 'slides', 'pdf', 'html', 'markdown']) {
      const src = readFileSync(join(apps, app, 'src/main', `${app}-main.ts`), 'utf8')
      const start = src.indexOf(`export function start`)
      expect(start, `${app} standalone start`).toBeGreaterThan(-1)
      expect(src.slice(start), `${app} standalone start answers the flag pull`).toContain(
        'answerUniworkAiFlagOff(ipcMain)',
      )
      // the shell hosts the module through its own register*, never through the standalone start
      expect(src.slice(0, start)).not.toContain('answerUniworkAiFlagOff(')
    }
  })
})
