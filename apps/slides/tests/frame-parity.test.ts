// @vitest-environment node
/**
 * Desktop half of the frame parity check (GO-B5 S2): the shared editing scenario
 * (web/modules/slides/testing/parity-scenario.ts) through the session handler registry in
 * Node, saved the way Electron saves (savePptxToFile). The web half
 * (web/modules/slides/session-in-frame.test.ts) runs the same scenario through the frame's
 * slidesApi on the browser shims and must match the same snapshot entry for entry.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { savePptxToFile, type OpenedPptx } from '@genoffice/pptx-engine'
import {
  MemoryHostIO,
  callSessionHandler,
  openSessionFromBytes,
  sessions,
  type SessionChannel,
} from '../src/session'
import {
  FIT,
  PARITY_TIME,
  packageDigest,
  runParity,
} from '../../../web/modules/slides/testing/parity-scenario'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, '..', '..', '..', 'web', 'fixtures', 'sample.pptx')
const SNAPSHOT = join(
  here,
  '..',
  '..',
  '..',
  'web',
  'modules',
  'slides',
  '__snapshots__',
  'frame-parity.json',
)

/** Electron's writeDeck: stream the package to a file */
class FileHostIO extends MemoryHostIO {
  override async writeDeck(opened: OpenedPptx, target: string): Promise<void> {
    await savePptxToFile(opened, target)
  }
}

let dir = ''

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(PARITY_TIME)
  let n = 0
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
    () => `20000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as const,
  )
  dir = mkdtempSync(join(tmpdir(), 'slides-parity-'))
})

afterAll(() => {
  vi.useRealTimers()
  sessions.clear()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('frame parity, desktop half', () => {
  it('saves the scenario with the pinned package entries', async () => {
    const target = join(dir, 'deck.pptx')
    const ctx = { clientId: 1, host: new FileHostIO() }
    await openSessionFromBytes(1, {
      path: target,
      bytes: new Uint8Array(readFileSync(FIXTURE)),
      fitWidthPx: FIT,
    })
    await runParity(async (step, args) =>
      (callSessionHandler as (c: SessionChannel, ...a: unknown[]) => unknown)(
        step.channel as SessionChannel,
        ctx,
        ...args,
      ),
    )
    const saved = (await callSessionHandler('slides:save', ctx)) as { ok: boolean }
    expect(saved.ok).toBe(true)
    const digest = await packageDigest(new Uint8Array(readFileSync(target)))
    await expect(JSON.stringify(digest, null, 2) + '\n').toMatchFileSnapshot(SNAPSHOT)
  })
})
