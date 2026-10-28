// UNI-2264: the job a web host hands over (`ai.start`) runs only on UniWork AI; the desktop shell's
// presets run as asked.
import { expect, it, vi } from 'vitest'
import { aiPresetAutoRuns } from '../src/ai-host-preset'

it('a desktop preset runs as asked, without reading the settings', async () => {
  const settings = vi.fn(async () => ({ provider: 'openai' }))
  expect(await aiPresetAutoRuns({}, false, settings)).toBe(true)
  expect(await aiPresetAutoRuns({ autoRun: false }, false, settings)).toBe(false)
  expect(settings).not.toHaveBeenCalled()
})

it('a web job runs only while the panel is on UniWork AI', async () => {
  expect(
    await aiPresetAutoRuns({ autoRun: true }, true, async () => ({ provider: 'uniwork' })),
  ).toBe(true)
  expect(
    await aiPresetAutoRuns({ autoRun: true }, true, async () => ({ provider: 'openai' })),
  ).toBe(false)
  expect(await aiPresetAutoRuns({ autoRun: true }, true, async () => null)).toBe(false)
  expect(
    await aiPresetAutoRuns({ autoRun: true }, true, () => Promise.reject(new Error('offline'))),
  ).toBe(false)
  expect(
    await aiPresetAutoRuns({ autoRun: false }, true, async () => ({ provider: 'uniwork' })),
  ).toBe(false)
})
