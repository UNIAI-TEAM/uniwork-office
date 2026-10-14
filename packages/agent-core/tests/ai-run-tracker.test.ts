// The frame's AI turn state: `aiRun` events for the host and the idle gate of the new-version bar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRunPayload } from '../src'
import { createAiRunTracker } from '../src/ai-run-tracker'

let sent: AiRunPayload[]

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
})

afterEach(() => {
  vi.useRealTimers()
})

const tracker = (graceMs = 1000) => createAiRunTracker({ report: (p) => sent.push(p), graceMs })

describe('aiRun events', () => {
  it('running at the first stream, exactly one idle after the last one, with one run id', () => {
    const t = tracker(0)
    t.begin('s1')
    expect(sent).toEqual([{ state: 'running', run_id: 'r1' }])
    expect(t.running()).toBe(true)
    t.begin('s2')
    t.end('s1')
    expect(sent).toHaveLength(1)
    t.end('s2')
    expect(sent).toEqual([
      { state: 'running', run_id: 'r1' },
      { state: 'idle', run_id: 'r1' },
    ])
    expect(t.running()).toBe(false)
  })

  it('a stream that starts inside the grace continues the same run (a tool step is not a new turn)', () => {
    const t = tracker(1000)
    t.begin('s1')
    t.end('s1')
    // between two model calls the turn is still running
    expect(t.running()).toBe(true)
    vi.advanceTimersByTime(500)
    t.begin('s2')
    vi.advanceTimersByTime(5000)
    expect(sent).toEqual([{ state: 'running', run_id: 'r1' }])
    t.end('s2')
    vi.advanceTimersByTime(1000)
    expect(sent.map((p) => p.state)).toEqual(['running', 'idle'])
    expect(t.running()).toBe(false)
    // the next turn is a new run
    t.begin('s3')
    expect(sent.at(-1)).toEqual({ state: 'running', run_id: 'r2' })
  })

  it('ending a stream twice, or one that never began, sends nothing', () => {
    const t = tracker(0)
    t.end('nope')
    t.begin('s1')
    t.end('s1')
    t.end('s1')
    expect(sent.map((p) => p.state)).toEqual(['running', 'idle'])
  })

  it('is silent without a reporter and a throwing reporter never breaks the turn', () => {
    const quiet = createAiRunTracker({ graceMs: 0 })
    quiet.begin('s1')
    quiet.end('s1')
    const bad = createAiRunTracker({
      graceMs: 0,
      report: () => {
        throw new Error('port gone')
      },
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bad.begin('s1')
    expect(bad.running()).toBe(true)
    bad.end('s1')
    expect(bad.running()).toBe(false)
  })

  it('bind() points the events at the protocol client later', () => {
    const t = createAiRunTracker({ graceMs: 0 })
    t.bind((p) => sent.push(p))
    t.begin('s1')
    t.end('s1')
    expect(sent.map((p) => p.state)).toEqual(['running', 'idle'])
  })
})

describe('onChange and stop()', () => {
  it('tells subscribers when running flips, and the unsubscribe works', () => {
    const t = tracker(0)
    const flips: boolean[] = []
    const off = t.onChange((r) => flips.push(r))
    t.begin('s1')
    t.end('s1')
    off()
    t.begin('s2')
    expect(flips).toEqual([true, false])
  })

  it('stop() cancels every active stream and resolves at idle without waiting for the grace', async () => {
    const t = tracker(1000)
    const aborted: string[] = []
    t.begin('s1', () => {
      aborted.push('s1')
      // the stream's own finally runs after the abort
      queueMicrotask(() => t.end('s1'))
    })
    t.begin('s2', () => {
      aborted.push('s2')
      queueMicrotask(() => t.end('s2'))
    })
    let done = false
    const stopped = t.stop().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    await stopped
    expect(done).toBe(true)
    expect(aborted).toEqual(['s1', 's2'])
    expect(t.running()).toBe(false)
    expect(sent.map((p) => p.state)).toEqual(['running', 'idle'])
  })

  it('stop() inside the grace ends the run now; stop() when idle resolves at once', async () => {
    const t = tracker(1000)
    await t.stop()
    t.begin('s1')
    t.end('s1')
    expect(t.running()).toBe(true)
    await t.stop()
    expect(t.running()).toBe(false)
    expect(sent.map((p) => p.state)).toEqual(['running', 'idle'])
    // the grace timer that was pending does not fire a second idle
    vi.advanceTimersByTime(5000)
    expect(sent).toHaveLength(2)
  })
})

describe('setRunId', () => {
  it('a server run id replaces the local one: running again with it, and the idle carries it', () => {
    const t = tracker(0)
    t.begin('s1')
    t.setRunId('run-from-server')
    t.setRunId('run-from-server')
    t.end('s1')
    expect(sent).toEqual([
      { state: 'running', run_id: 'r1' },
      { state: 'running', run_id: 'run-from-server' },
      { state: 'idle', run_id: 'run-from-server' },
    ])
  })

  it('an id that arrives while idle names the next run; an empty id is ignored', () => {
    const t = tracker(0)
    t.setRunId('')
    t.setRunId('early')
    expect(sent).toEqual([])
    t.begin('s1')
    t.end('s1')
    expect(sent).toEqual([
      { state: 'running', run_id: 'early' },
      { state: 'idle', run_id: 'early' },
    ])
    t.begin('s2')
    expect(sent.at(-1)).toEqual({ state: 'running', run_id: 'r1' })
  })
})
