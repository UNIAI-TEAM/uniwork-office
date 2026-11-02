/** @vitest-environment jsdom */
// UNI-1232 FX2 (N3-01 / G-N1) + UNI-1240 (final3 F3-N2) + UNI-2309: while UniWork AI, the one
// provider, is not on here the composer's send is off and the hint says so (it opens the account
// settings); once it is offered the composer is untouched. There is no key or model to ask for.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultAiSettings, setUniworkAiAvailable } from '@genoffice/ai-provider'
import { AiComposer } from '../src/AiComposer'
import { AiModelPicker, type AiModelPickerBridge } from '../src/AiModelPicker'
import { AI_MODEL_PICKER_STRINGS } from '../src/strings-ai-model-picker'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setUniworkAiAvailable(false)
  vi.unstubAllGlobals()
})

async function mount(opts: { iconOnly?: boolean; openModelSettings?: () => void } = {}) {
  const handlers = new Set<() => void>()
  const bridge: AiModelPickerBridge = {
    // every read answers a fresh object, as an IPC host does
    getSettings: async () => defaultAiSettings(),
    onSettingsChanged: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    ...(opts.openModelSettings ? { openModelSettings: opts.openModelSettings } : {}),
  }
  await act(async () => {
    root.render(
      createElement(AiComposer, {
        value: 'hello',
        busy: false,
        placeholder: 'Ask',
        hintIdle: 'Enter to send',
        hintBusy: 'Esc to stop',
        sendLabel: 'Send',
        stopLabel: 'Stop',
        footerStart: createElement(AiModelPicker, { bridge, lang: 'en' }),
        ...(opts.iconOnly ? { iconOnly: true } : {}),
        onChange: () => {},
        onSend: () => {},
        onStop: () => {},
      }),
    )
  })
  await act(async () => {})
  return {
    send: () => host.querySelector('.ai-send-btn') as HTMLButtonElement,
    hint: () => host.querySelector('.ai-input-hint')?.textContent ?? null,
    emitChanged: async () => {
      await act(async () => {
        for (const h of handlers) h()
      })
      await act(async () => {})
    },
  }
}

const NOT_ON = AI_MODEL_PICKER_STRINGS.en.needModel

it('UniWork AI not on here: send is off and the hint says so', async () => {
  setUniworkAiAvailable(false)
  const { send, hint } = await mount()
  expect(send().disabled).toBe(true)
  expect(hint()).toBe(NOT_ON)
  expect(send().title).toBe(NOT_ON)
})

it('UniWork AI offered: send is on', async () => {
  setUniworkAiAvailable(true)
  const { send, hint } = await mount()
  expect(send().disabled).toBe(false)
  expect(hint()).toBe('Enter to send')
})

it('the icon-only composer shows the hint above the footer and it opens the account settings', async () => {
  setUniworkAiAvailable(false)
  const open = vi.fn()
  const { send } = await mount({ iconOnly: true, openModelSettings: open })
  expect(send().disabled).toBe(true)
  const link = host.querySelector('.ai-input-need button') as HTMLButtonElement
  expect(link.textContent).toBe(NOT_ON)
  act(() => link.click())
  expect(open).toHaveBeenCalledTimes(1)
})

it('the hint goes away once the host offers UniWork AI', async () => {
  setUniworkAiAvailable(false)
  const { send, emitChanged } = await mount({ iconOnly: true })
  expect(host.querySelector('.ai-input-need')).not.toBeNull()
  setUniworkAiAvailable(true)
  await emitChanged()
  expect(send().disabled).toBe(false)
  expect(host.querySelector('.ai-input-need')).toBeNull()
})
