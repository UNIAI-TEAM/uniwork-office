/**
 * AI turn signal (UNI-1339): the docs preload exposes window.uniworkAiRun and
 * its reports drive the shell registry (shared contract in
 * apps/shell/tests/fixtures/ai-run-contract.ts).
 */
import { describe, it, vi } from 'vitest'
import { aiRunElectronMock, expectAiRunContract } from '../../shell/tests/fixtures/ai-run-contract'

const capture = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
}))

vi.mock('electron', () => aiRunElectronMock(capture))

describe('docs preload AI run signal', () => {
  it('reportAiRun running -> aiRunning true; idle or a closed view -> false', async () => {
    await expectAiRunContract(capture, () => import('../src/preload/index'))
  })
})
