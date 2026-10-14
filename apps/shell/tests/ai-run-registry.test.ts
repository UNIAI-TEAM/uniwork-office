import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_RUN_CHANNEL } from '@genoffice/electron-utils/ai-run'
import {
  aiEpochOf,
  clearAiRun,
  isAiRunning,
  noteAiRun,
  registerAiRunIpc,
  resetAiRunRegistry,
} from '../src/main/ai-run-registry'
import { fakeSender } from './fixtures/ai-run-contract'

beforeEach(() => resetAiRunRegistry())

describe('AI run registry', () => {
  it('registers one listener on the channel and keys the flag by sender', () => {
    const on = vi.fn()
    registerAiRunIpc({ on } as never)
    expect(on).toHaveBeenCalledWith(AI_RUN_CHANNEL, expect.any(Function))
    const handler = on.mock.calls[0][1] as (e: unknown, p: unknown) => void
    const a = fakeSender(1)
    const b = fakeSender(2)
    handler({ sender: a }, { state: 'running' })
    expect(isAiRunning(1)).toBe(true)
    expect(isAiRunning(2)).toBe(false)
    handler({ sender: b }, { state: 'idle' })
    expect(isAiRunning(1)).toBe(true)
  })

  it.each([
    null,
    'running',
    [],
    {},
    { state: 'busy' },
    { state: 'running', runId: 7 },
    { state: 'running', runId: '' },
    { state: 'running', runId: 'x'.repeat(129) },
  ])('ignores a malformed payload %j', (payload) => {
    const wc = fakeSender(3)
    expect(noteAiRun(wc, payload)).toBe(false)
    expect(isAiRunning(3)).toBe(false)
  })

  it('an idle naming an older turn does not end the current one', () => {
    const wc = fakeSender(4)
    noteAiRun(wc, { state: 'running', runId: 'turn-1' })
    noteAiRun(wc, { state: 'running', runId: 'turn-2' })
    noteAiRun(wc, { state: 'idle', runId: 'turn-1' })
    expect(isAiRunning(4)).toBe(true)
    noteAiRun(wc, { state: 'idle', runId: 'turn-2' })
    expect(isAiRunning(4)).toBe(false)
  })

  it('a reload, a crashed renderer, a destroyed view or clearAiRun drops the flag', () => {
    const wc = fakeSender(5)
    noteAiRun(wc, { state: 'running' })
    ;(wc as unknown as { emit(e: string): void }).emit('did-start-loading')
    expect(isAiRunning(5)).toBe(false)
    noteAiRun(wc, { state: 'running' })
    ;(wc as unknown as { emit(e: string): void }).emit('render-process-gone')
    expect(isAiRunning(5)).toBe(false)
    noteAiRun(wc, { state: 'running' })
    clearAiRun(5)
    expect(isAiRunning(5)).toBe(false)
    noteAiRun(wc, { state: 'running' })
    wc.destroy()
    expect(isAiRunning(5)).toBe(false)
    // a late report from the dead view does not resurrect it
    noteAiRun(wc, { state: 'running' })
    expect(isAiRunning(5)).toBe(false)
  })

  it('the AI epoch counts every accepted running report and never decreases', () => {
    const wc = fakeSender(6)
    expect(aiEpochOf(6)).toBe(0)
    noteAiRun(wc, { state: 'running', runId: 'turn-1' })
    expect(aiEpochOf(6)).toBe(1)
    // an idle ends the turn but not the epoch: the reload race compares epochs
    noteAiRun(wc, { state: 'idle', runId: 'turn-1' })
    expect(isAiRunning(6)).toBe(false)
    expect(aiEpochOf(6)).toBe(1)
    noteAiRun(wc, { state: 'running', runId: 'turn-2' })
    noteAiRun(wc, { state: 'running', runId: 'turn-3' })
    expect(aiEpochOf(6)).toBe(3)
    // a reload or a crashed renderer clears the flag, never the count
    ;(wc as unknown as { emit(e: string): void }).emit('did-start-loading')
    ;(wc as unknown as { emit(e: string): void }).emit('render-process-gone')
    expect(aiEpochOf(6)).toBe(3)
    // malformed payloads and another view's reports move nothing
    expect(noteAiRun(wc, { state: 'busy' })).toBe(false)
    noteAiRun(fakeSender(7), { state: 'running' })
    expect(aiEpochOf(6)).toBe(3)
    expect(aiEpochOf(7)).toBe(1)
  })

  it('closing a tab mid-turn clears aiRunning and the epoch with the destroyed view', () => {
    const wc = fakeSender(8)
    noteAiRun(wc, { state: 'running', runId: 'turn-1' })
    // a docs tab is blanked, not destroyed: the shell forgets the turn itself
    clearAiRun(8)
    expect(isAiRunning(8)).toBe(false)
    noteAiRun(wc, { state: 'running', runId: 'turn-2' })
    wc.destroy()
    expect(isAiRunning(8)).toBe(false)
    expect(aiEpochOf(8)).toBe(0)
  })
})
