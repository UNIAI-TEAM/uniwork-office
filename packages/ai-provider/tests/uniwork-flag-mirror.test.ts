// A renderer has its own AI_PROVIDERS (a separate module realm from the shell's main process), so
// the availability flag the main process computes is mirrored in over a preload bridge (G6-05 S2
// gap 2). Minimal entry only: the picker shows or hides the `uniwork` row, nothing else changes.
import { afterEach, describe, expect, it } from 'vitest'
import { AI_PROVIDERS, setUniworkAiAvailable, uniworkAiAvailable } from '../src/providers'
import { mirrorUniworkAiFlag, type UniworkAiFlagBridge } from '../src/uniwork/flag-mirror'

const listed = () => AI_PROVIDERS.some((m) => m.id === 'uniwork')

/** a bridge whose pull answers `initial` and whose pushes the test fires by hand */
function fakeBridge(initial: boolean | Error) {
  const handlers = new Set<(available: boolean) => void>()
  const bridge: UniworkAiFlagBridge = {
    get: async () => {
      if (initial instanceof Error) throw initial
      return initial
    },
    onChange: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
  return { bridge, push: (available: boolean) => handlers.forEach((h) => h(available)), handlers }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('mirrorUniworkAiFlag', () => {
  afterEach(() => setUniworkAiAvailable(false))

  it('flag true: the pulled value puts the uniwork entry in the renderer list', async () => {
    const { bridge } = fakeBridge(true)
    expect(listed()).toBe(false)
    mirrorUniworkAiFlag(bridge)
    await settle()
    expect(uniworkAiAvailable()).toBe(true)
    expect(listed()).toBe(true)
  })

  it('flag false: the entry is absent, and a later push true/false adds and removes it', async () => {
    const { bridge, push } = fakeBridge(false)
    mirrorUniworkAiFlag(bridge)
    await settle()
    expect(listed()).toBe(false)
    push(true)
    expect(listed()).toBe(true)
    push(false)
    expect(listed()).toBe(false)
  })

  it('a push that lands while the pull is in flight wins over the older pulled value', async () => {
    let release: (v: boolean) => void = () => {}
    const handlers = new Set<(a: boolean) => void>()
    mirrorUniworkAiFlag({
      get: () => new Promise<boolean>((resolve) => (release = resolve)),
      onChange: (h) => (handlers.add(h), () => handlers.delete(h)),
    })
    handlers.forEach((h) => h(false))
    release(true)
    await settle()
    expect(listed()).toBe(false)
  })

  it('no bridge, a failing pull or a non-boolean answer leaves the entry hidden', async () => {
    mirrorUniworkAiFlag(undefined)
    mirrorUniworkAiFlag(fakeBridge(new Error('ipc gone')).bridge)
    mirrorUniworkAiFlag({ get: async () => 'yes' as unknown as boolean, onChange: () => () => {} })
    await settle()
    expect(listed()).toBe(false)
  })

  it('the returned function unsubscribes', async () => {
    const { bridge, push, handlers } = fakeBridge(false)
    const off = mirrorUniworkAiFlag(bridge)
    await settle()
    off()
    expect(handlers.size).toBe(0)
    push(true)
    expect(listed()).toBe(false)
  })
})
