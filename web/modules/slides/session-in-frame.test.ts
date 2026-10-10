// @vitest-environment jsdom
/**
 * Web half of the frame parity check (GO-B5 S2): the shared editing scenario through the
 * frame's window.slidesApi (session core on the browser shims, saved through api.save) must
 * produce the package the desktop half (apps/slides/tests/frame-parity.test.ts) pins.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessions } from '../../../apps/slides/src/session'
import { createMockPort } from '../../docs/bridge/testing/mock-port'
import { FIT, PARITY_TIME, packageDigest, runParity } from './testing/parity-scenario'
import { createWebSlidesApi } from './web-slides-api'

const here = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = join(here, '__snapshots__', 'frame-parity.json')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(PARITY_TIME)
  let n = 0
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
    () => `20000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as const,
  )
})

afterAll(() => {
  vi.useRealTimers()
  sessions.clear()
})

describe('frame parity, web half', () => {
  it('saves the scenario with the same package entries as the desktop', async () => {
    const mock = createMockPort()
    const file = mock.seed(
      'sample.pptx',
      new Uint8Array(readFileSync(join(here, '..', '..', 'fixtures', 'sample.pptx'))),
    )
    const { slidesApi } = createWebSlidesApi({ client: mock.port, capabilities: {} })
    mock.init({ documentId: file.fileId })
    const opened = await slidesApi.consumePendingOpen(FIT)
    expect(opened?.slides).toHaveLength(5)
    const api = slidesApi as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
    await runParity((step, args) => api[step.method]!(...args))
    const saved = await slidesApi.save()
    expect(saved.ok).toBe(true)
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(1)
    const digest = await packageDigest(mock.bytesOf(file.fileId)!)
    await expect(JSON.stringify(digest, null, 2) + '\n').toMatchFileSnapshot(SNAPSHOT)
  })
})
