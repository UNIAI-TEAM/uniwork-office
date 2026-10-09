// @vitest-environment jsdom
// GO-B4/B5/B6: the generic pieces (safe-api, capability-object) and the module installer.
import { afterEach, describe, expect, it } from 'vitest'
import { capEnabled, createCapabilityObject } from './capability-object'
import { appearanceMembers, installModuleBridge } from './module-bridge'
import { fallbackFor, mergeModules, safeApi } from './safe-api'
import { createMockPort } from './testing/mock-port'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
})

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('safe-api', () => {
  it('fills missing members: on* -> disposer, others -> async undefined', async () => {
    const api = safeApi<Record<string, unknown>>({ real: () => 42 })
    expect((api.real as () => number)()).toBe(42)
    const off = (api.onSomething as (h: () => void) => () => void)(() => {})
    expect(typeof off).toBe('function')
    expect(off()).toBeUndefined()
    await expect((api.readFile as () => Promise<unknown>)()).resolves.toBeUndefined()
    // cached: the same fallback on the next read
    expect(api.readFile).toBe(api.readFile)
  })

  it('never makes the object a thenable and leaves symbols alone', async () => {
    const api = safeApi<Record<string, unknown>>({})
    expect(api.then).toBeUndefined()
    expect(await Promise.resolve(api)).toBe(api)
    expect((api as Record<symbol, unknown>)[Symbol.toPrimitive]).toBeUndefined()
  })

  it('fallbackFor + mergeModules: later modules win', () => {
    expect(typeof (fallbackFor('onX') as () => unknown)()).toBe('function')
    expect(mergeModules([{ a: 1, b: 1 }, null, { b: 2 }])).toEqual({ a: 1, b: 2 })
  })
})

describe('capability-object', () => {
  it('starts with the defaults and receives the host grants in place', async () => {
    const mock = createMockPort()
    const caps = createCapabilityObject<{ ai: boolean; open: boolean }>(
      { ai: false, open: false },
      mock.port,
      (g) => ({
        open: g?.filePick === true,
      }),
    )
    const ref = caps
    expect(caps).toEqual({ ai: false, open: false })
    mock.init({ capabilities: { filePick: true } })
    await flush()
    expect(ref).toBe(caps)
    expect(caps).toEqual({ ai: false, open: true })
  })

  it('capEnabled: on unless explicitly false (desktop sets no object)', () => {
    expect(capEnabled(undefined, 'ai')).toBe(true)
    expect(capEnabled({ ai: false }, 'ai')).toBe(false)
    expect(capEnabled({ ai: true }, 'ai')).toBe(true)
    expect(capEnabled({}, 'ai')).toBe(true)
  })
})

describe('installModuleBridge', () => {
  it('installs the globals with appearance members, capabilities and safe fallbacks', async () => {
    const mock = createMockPort()
    const target: Record<string, unknown> = {}
    const seen: string[] = []
    const { globals, capabilities } = installModuleBridge({
      module: 'pdf',
      frameCapabilities: { save: true },
      client: mock.port,
      target,
      capabilities: {
        defaults: { ai: false, open: false },
        grants: (g) => ({ open: g?.filePick === true }),
      },
      globals: {
        pdfApi: (ctx) => {
          seen.push(ctx.module)
          return { isUntitled: () => true }
        },
      },
    })
    expect(seen).toEqual(['pdf'])
    const pdfApi = target.pdfApi as Record<string, unknown>
    expect(pdfApi).toBe(globals.pdfApi)
    for (const key of Object.keys(appearanceMembers())) expect(typeof pdfApi[key]).toBe('function')
    expect((pdfApi.isUntitled as () => boolean)()).toBe(true)
    // a member the scaffold does not implement: never throws
    await expect((pdfApi.readFile as () => Promise<unknown>)()).resolves.toBeUndefined()
    expect(typeof (pdfApi.onPrintRequest as (h: () => void) => () => void)(() => {})).toBe(
      'function',
    )
    expect(pdfApi.capabilities).toBe(capabilities)
    expect(capabilities).toEqual({ platform: 'web', ai: false, open: false })
    expect(target.projectApi).toBeDefined()
    expect(target.__officeWebModule).toBe('pdf')

    mock.init({ theme: 'dark', locale: 'vi', capabilities: { filePick: true } })
    expect(await (pdfApi.getTheme as () => Promise<string>)()).toBe('dark')
    expect(await (pdfApi.getLanguage as () => Promise<string>)()).toBe('vi')
    expect(capabilities.open).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('several globals; `capabilities.on` limits which ones carry the object', () => {
    const mock = createMockPort()
    const target: Record<string, unknown> = {}
    installModuleBridge({
      module: 'slides',
      frameCapabilities: {},
      client: mock.port,
      target,
      capabilities: { defaults: { ai: false }, on: ['slidesApi'] },
      globals: { slidesApi: () => ({}), desktop: () => ({}) },
    })
    expect((target.slidesApi as Record<string, unknown>).capabilities).toBeDefined()
    expect(Object.keys(target.desktop as object)).not.toContain('capabilities')
  })
})
