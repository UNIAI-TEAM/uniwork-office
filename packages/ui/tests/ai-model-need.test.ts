/** @vitest-environment jsdom */
// UNI-1232 FX2 (N3-01 / G-N1): in a web frame a stored key without a known model keeps the
// composer's send off and says why; with a model, with no key at all, or on desktop it is untouched.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
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
  vi.unstubAllGlobals()
})

function settingsWith(provider: 'custom' | 'openai', apiKey: string, model: string): AiSettings {
  const settings = { ...defaultAiSettings(), uniAiAvailable: false, provider }
  settings.providers[provider] = { ...settings.providers[provider], apiKey, model }
  if (provider === 'custom') settings.providers.custom.baseUrl = 'https://router.example/v1'
  return settings
}

async function mount(settings: AiSettings, requireModel: boolean) {
  const bridge: AiModelPickerBridge = {
    getSettings: async () => settings,
    setSettings: async () => {},
    requireModel,
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
        onChange: () => {},
        onSend: () => {},
        onStop: () => {},
      }),
    )
  })
  await act(async () => {})
  return {
    send: host.querySelector('.ai-send-btn') as HTMLButtonElement,
    hint: host.querySelector('.ai-input-hint')!.textContent,
    chip: host.querySelector('.ai-model-chip-text')!.textContent,
  }
}

it('a stored key with no model: send is off, the hint says to choose a model', async () => {
  const { send, hint, chip } = await mount(settingsWith('custom', '…abcd', ''), true)
  expect(chip).toBe(AI_MODEL_PICKER_STRINGS.en.choose)
  expect(send.disabled).toBe(true)
  expect(hint).toBe('Choose a model to send')
  expect(send.title).toBe('Choose a model to send')
})

it('a known model keeps send on', async () => {
  const { send, hint } = await mount(settingsWith('openai', '…abcd', 'gpt-x'), true)
  expect(send.disabled).toBe(false)
  expect(hint).toBe('Enter to send')
})

it('no key at all is not this state: send stays on and the turn answers with the no-key copy', async () => {
  const { send } = await mount(settingsWith('custom', '', ''), true)
  expect(send.disabled).toBe(false)
})

it('a host that did not ask for the rule (desktop) is untouched', async () => {
  const { send, hint } = await mount(settingsWith('custom', '…abcd', ''), false)
  expect(send.disabled).toBe(false)
  expect(hint).toBe('Enter to send')
})

it('every locale has the hint', () => {
  for (const [lang, strings] of Object.entries(AI_MODEL_PICKER_STRINGS)) {
    expect(strings.needModel, lang).toBeTruthy()
  }
})
