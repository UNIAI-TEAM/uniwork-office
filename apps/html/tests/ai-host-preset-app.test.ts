/**
 * UNI-2264: the HTML App reads the preset a web host hands over (`consumeAiPreset`, `onAiPreset`)
 * and gives it to the panel only once the page has loaded (the App renders no panel while the page
 * loads or after it failed to open); in a web frame it marks it as a job that runs only on UniWork
 * AI. The panel is stubbed and shows the preset it gets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { resetForTest } from '../src/renderer/capabilities'

const panel = vi.hoisted(() => ({ preset: undefined as unknown }))
vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: (props: { preset: unknown }) => {
    panel.preset = props.preset
    return null
  },
}))

const PAGE = '<!doctype html><html><head><title>Plan</title></head><body><p>x</p></body></html>'
const JOB = 'Draft this page from the job: Plan'

type Preset = { text: string; autoRun?: boolean; displayText?: string }

async function mount(web: boolean) {
  let load!: () => void
  let fail!: () => void
  const loaded = new Promise<string>((resolve, reject) => {
    load = () => resolve(PAGE)
    fail = () => reject(new Error('gone'))
  })
  let listener: ((preset: Preset) => void) | null = null
  const stubs: Record<string, unknown> = {
    consumePending: vi.fn(async () => '/home/u/docs/plan.html'),
    readFile: vi.fn(() => loaded),
    getPreviewInfo: vi.fn(async () => ({ url: 'about:blank' })),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    consumeAiPreset: vi.fn(async () => null),
    onAiPreset: vi.fn((handler: (preset: Preset) => void) => {
      listener = handler
      return () => {
        listener = null
      }
    }),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities') return web ? { platform: 'web' } : undefined
      if (prop === 'consumeRecovered' || prop === 'provideText') return undefined
      if (prop in target) return target[prop]
      target[prop] = /^on[A-Z]/.test(prop) ? vi.fn(() => () => {}) : vi.fn(async () => undefined)
      return target[prop]
    },
  })
  ;(window as unknown as { htmlApi: unknown }).htmlApi = api
  resetForTest()
  panel.preset = undefined
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(App)))
  })
  await settle()
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return {
    load: async () => {
      load()
      await settle()
    },
    fail: async () => {
      fail()
      await settle()
    },
    fire: async (preset: Preset) => {
      await act(async () => listener!(preset))
      await settle()
    },
  }
}

const cleanups: Array<() => void> = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  resetForTest()
})

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 10)))
}

describe('html App: a preset from outside waits for the page', () => {
  it('a preset that arrives while the page loads reaches the panel once it has loaded', async () => {
    const app = await mount(false)
    await app.fire({ text: JOB, autoRun: true, displayText: 'Draft the page' })
    expect(panel.preset ?? null).toBeNull()
    await app.load()
    expect(panel.preset).toMatchObject({ text: JOB, autoRun: true, displayText: 'Draft the page' })
    expect(panel.preset).not.toHaveProperty('uniworkOnly')
  })

  it('a page that did not open never hands the preset to a panel', async () => {
    const app = await mount(false)
    await app.fail()
    await app.fire({ text: JOB, autoRun: true })
    expect(panel.preset ?? null).toBeNull()
  })

  it('in a web frame the preset is a job that runs only on UniWork AI', async () => {
    const app = await mount(true)
    await app.load()
    await app.fire({ text: JOB, autoRun: true })
    expect(panel.preset).toMatchObject({ text: JOB, autoRun: true, uniworkOnly: true })
  })
})
