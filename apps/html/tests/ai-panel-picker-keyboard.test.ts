// F14 (visual r2, html panel): ArrowDown / ArrowUp on the model chip opens the picker and puts focus
// on an option of the list in the same step, as in the other panels (Accessibility Floor: roving focus).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { AiPanel, type HtmlAiDeps } from '../src/renderer/ai/AiPanel'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

/** what the host answers to getAiSettings: nothing usable at first; a later read finds a model */
const host = { ready: false }

function emptySettings(): AiSettings {
  const base = defaultAiSettings()
  return { ...base, uniAiAvailable: false, provider: 'openai' } as AiSettings
}

/** a preload bridge answering every call; getAiSettings hands over settings that can send */
function bridgeProxy(): Record<string, ReturnType<typeof vi.fn>> {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
  return new Proxy(stubs, {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = /^on[A-Z]/.test(prop)
          ? vi.fn(() => () => {})
          : prop === 'getAiSettings'
            ? vi.fn(async () => (host.ready ? usableAiSettings() : emptySettings()))
            : vi.fn(async () => undefined)
      }
      return target[prop]
    },
  })
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {})
}

describe('model picker keyboard (html panel)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    vi.stubGlobal('htmlApi', bridgeProxy())
    host.ready = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    vi.unstubAllGlobals()
  })

  const text = '<!doctype html>\n<html><body><h1>Quarterly</h1></body></html>'
  const deps = {
    access: {
      getText: () => text,
      getVersion: () => 1,
      getMap: () => buildParseMap(text, 1, null),
      getLastManualVersion: () => 0,
      getFilePath: () => '/tmp/page.html',
      getSelectedSid: () => null,
      applyOps: () => ({ ok: true, ranges: [] }),
      replaceAll: () => {},
    },
    getSnapshot: () => ({}),
    restoreSnapshot: () => {},
    onPrompt: () => {},
    onRunDone: () => {},
    clearHighlights: () => {},
    navigateTo: () => {},
    onBriefConfirmed: () => {},
    previewDraft: () => {},
  } as unknown as HtmlAiDeps

  async function mounted(): Promise<HTMLElement> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AiPanel, {
            deps,
            filePath: '/docs/a.html',
            onCollapse: () => {},
            editQueue: [],
            onQueueEditInstruction: () => {},
            onQueueRemove: () => {},
            onQueueClear: () => {},
            onQueueFocus: () => {},
            onQueueConsume: () => {},
          }),
        ),
      )
    })
    await settle()
    return container
  }

  it.each(['ArrowDown', 'ArrowUp'])(
    '%s on the chip opens the picker and focus lands on an option of the list',
    async (key) => {
      const panel = await mounted()
      const chip = panel.querySelector<HTMLButtonElement>('.ai-model-chip')!
      act(() => chip.focus())
      expect(document.activeElement).toBe(chip)
      await act(async () => {
        chip.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })
      await settle()
      const list = panel.querySelector('.ai-model-pop-list')
      expect(list, 'the picker opened').not.toBeNull()
      const active = document.activeElement as HTMLElement
      expect(active.getAttribute('role')).toBe('option')
      expect(list!.contains(active)).toBe(true)
    },
  )
  it('options that arrive after the popover opened still take the keyboard focus', async () => {
    host.ready = false
    const panel = await mounted()
    const chip = panel.querySelector<HTMLButtonElement>('.ai-model-chip')!
    act(() => chip.focus())
    // the host finds a usable model only on the read that opening the picker triggers
    host.ready = true
    await act(async () => {
      chip.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
    })
    await settle()
    expect(panel.querySelector('.ai-model-pop-list'), 'the picker opened').not.toBeNull()
    const active = document.activeElement as HTMLElement
    expect(active.getAttribute('role')).toBe('option')
    expect(panel.querySelector('.ai-model-pop-list')!.contains(active)).toBe(true)
  })
})
