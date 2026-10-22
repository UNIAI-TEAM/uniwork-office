/**
 * Ask UNI in the editor panels: the sheets preload installs the shared editor bridge once and it
 * exposes only `uniworkAskUniDoc` (the seven contract methods), no workspace or document handle.
 */
import { describe, expect, it, vi } from 'vitest'
import { aiRunElectronMock } from '../../shell/tests/fixtures/ai-run-contract'

const capture = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
  calls: [] as string[],
}))

vi.mock('electron', () => {
  const base = aiRunElectronMock(capture) as {
    contextBridge: { exposeInMainWorld: (name: string, value: unknown) => void }
  }
  const expose = base.contextBridge.exposeInMainWorld
  base.contextBridge.exposeInMainWorld = (name, value) => {
    capture.calls.push(name)
    expose(name, value)
  }
  return base
})

describe('sheets preload Ask UNI bridge', () => {
  it('exposes window.uniworkAskUniDoc exactly once, with the contract methods only', async () => {
    await import('../src/preload/index')
    expect(capture.calls.filter((n) => n === 'uniworkAskUniDoc')).toHaveLength(1)
    const bridge = capture.exposed.get('uniworkAskUniDoc') as Record<string, unknown>
    expect(Object.keys(bridge).sort()).toEqual([
      'askUniDocFeedbackClear',
      'askUniDocFeedbackSet',
      'askUniDocFlags',
      'askUniDocMessages',
      'askUniDocStream',
      'askUniDocStreamCancel',
      'onAskUniDocStreamEvent',
    ])
    for (const fn of Object.values(bridge)) expect(typeof fn).toBe('function')
  })
})
