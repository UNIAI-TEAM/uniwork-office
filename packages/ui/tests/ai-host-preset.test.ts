// UNI-2264: the job a web host hands over (`ai.start`) runs only on UniWork AI; the panel reads its
// provider right before the job would run.
import { expect, it } from 'vitest'
import { aiPanelOnUniwork } from '../src/ai-host-preset'

it('is true only while the panel is on UniWork AI', async () => {
  expect(await aiPanelOnUniwork(async () => ({ provider: 'uniwork' }))).toBe(true)
  expect(await aiPanelOnUniwork(async () => ({ provider: 'openai' }))).toBe(false)
  expect(await aiPanelOnUniwork(async () => null)).toBe(false)
})

it('a settings read that fails, even before it returns a promise, counts as not UniWork AI', async () => {
  expect(await aiPanelOnUniwork(() => Promise.reject(new Error('offline')))).toBe(false)
  expect(
    await aiPanelOnUniwork(() => {
      throw new Error('no bridge')
    }),
  ).toBe(false)
})
