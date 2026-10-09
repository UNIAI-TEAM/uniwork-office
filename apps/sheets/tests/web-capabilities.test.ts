// UNI-1016: renderer-side capability gating and the web engine's typed failure.
import { afterEach, describe, expect, it } from 'vitest'

import { cap, isViewOnly, platform, resetForTest } from '../src/renderer/capabilities'
import { ENGINE_UNAVAILABLE, isEngineUnavailableError } from '../src/renderer/web-engine'

const g = globalThis as { window?: unknown }
const hadWindow = 'window' in g
const previousWindow = g.window

function installDesktopApi(capabilities?: Record<string, unknown>): void {
  g.window = { desktopApi: capabilities === undefined ? {} : { capabilities } }
  resetForTest()
}

afterEach(() => {
  if (hadWindow) g.window = previousWindow
  else delete g.window
  resetForTest()
})

describe('cap()', () => {
  it('desktop (no capability object): everything stays on, not view-only', () => {
    installDesktopApi()
    expect(cap('ai')).toBe(true)
    expect(cap('xlsxEngine')).toBe(true)
    expect(cap('recalcFallback')).toBe(true)
    expect(isViewOnly()).toBe(false)
    expect(platform()).toBeUndefined()
  })

  it('web frame: explicit false hides, host grants assigned later are seen', () => {
    const caps: Record<string, unknown> = {
      platform: 'web',
      ai: false,
      save: false,
      xlsxEngine: false,
    }
    installDesktopApi(caps)
    expect(platform()).toBe('web')
    expect(cap('ai')).toBe(false)
    expect(cap('xlsxEngine')).toBe(false)
    expect(isViewOnly()).toBe(true)
    // the bridge assigns the host grants into the same object after `init`
    caps.save = true
    expect(isViewOnly()).toBe(false)
  })
})

describe('isEngineUnavailableError', () => {
  it('matches the code on an error object or the message prefix, nothing else', () => {
    expect(isEngineUnavailableError({ code: ENGINE_UNAVAILABLE })).toBe(true)
    expect(isEngineUnavailableError(new Error(`${ENGINE_UNAVAILABLE}: open`))).toBe(true)
    expect(isEngineUnavailableError(new Error('XLSX sidecar failed to start'))).toBe(false)
    expect(isEngineUnavailableError(null)).toBe(false)
  })
})
