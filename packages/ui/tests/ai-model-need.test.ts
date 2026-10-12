/** @vitest-environment jsdom */
// UNI-1232 FX2 (N3-01 / G-N1) + UNI-1240 (final3 F3-N2): in a web frame, while the chip reads
// "Choose model" (a key without a known model, or no key at all) the composer's send is off and says
// why, the same for a viewer and an editor; with a model, or on desktop, it is untouched.
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

function settingsWith(
  provider: 'custom' | 'openai',
  apiKey: string,
  model: string,
  baseUrl = 'https://router.example/v1',
): AiSettings {
  const settings = { ...defaultAiSettings(), uniAiAvailable: false, provider }
  settings.providers[provider] = { ...settings.providers[provider], apiKey, model }
  if (provider === 'custom') settings.providers.custom.baseUrl = baseUrl
  return settings
}

async function mount(
  settings: AiSettings,
  requireModel: boolean,
  opts: { iconOnly?: boolean; openModelSettings?: () => void } = {},
) {
  const bridge: AiModelPickerBridge = {
    getSettings: async () => settings,
    setSettings: async () => {},
    requireModel,
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
    send: host.querySelector('.ai-send-btn') as HTMLButtonElement,
    hint: host.querySelector('.ai-input-hint')?.textContent ?? null,
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

it('no key at all: send is off too, and the hint is the add-a-key copy (viewer and editor alike)', async () => {
  const { send, hint, chip } = await mount(settingsWith('custom', '', ''), true)
  expect(chip).toBe(AI_MODEL_PICKER_STRINGS.en.choose)
  expect(send.disabled).toBe(true)
  expect(hint).toBe('Add an API key in AI settings to use the assistant.')
  expect(send.title).toBe(hint)
})

it('a key list that failed to load is not "add an API key": send stays on and the server decides', async () => {
  const unknown = { ...settingsWith('custom', '', ''), credentialsUnavailable: true }
  const { send, hint } = await mount(unknown, true)
  expect(send.disabled).toBe(false)
  expect(hint).toBe('Enter to send')
  expect(host.querySelector('.ai-input-need')).toBeNull()
})

it('opening the chip reads the settings again while the key list is unknown', async () => {
  let reads = 0
  const unknown = { ...settingsWith('custom', '', ''), credentialsUnavailable: true }
  const bridge: AiModelPickerBridge = {
    getSettings: async () => (reads++, unknown),
    setSettings: async () => {},
    requireModel: true,
  }
  await act(async () => {
    root.render(createElement(AiModelPicker, { bridge, lang: 'en' }))
  })
  await act(async () => {})
  const before = reads
  await act(async () => {
    ;(host.querySelector('.ai-model-chip') as HTMLButtonElement).click()
  })
  expect(reads).toBeGreaterThan(before)
})

it('the icon-only composer shows the hint above the footer and it opens the AI settings', async () => {
  const open = vi.fn()
  const { send } = await mount(settingsWith('custom', '', ''), true, {
    iconOnly: true,
    openModelSettings: open,
  })
  expect(send.disabled).toBe(true)
  const link = host.querySelector('.ai-input-need button') as HTMLButtonElement
  expect(link.textContent).toBe('Add an API key in AI settings to use the assistant.')
  act(() => link.click())
  expect(open).toHaveBeenCalledTimes(1)
})

it('the hint goes away once a key and a model are known', async () => {
  const { send } = await mount(settingsWith('openai', '…abcd', 'gpt-x'), true, { iconOnly: true })
  expect(send.disabled).toBe(false)
  expect(host.querySelector('.ai-input-need')).toBeNull()
})

it('desktop: a chosen vendor that cannot send yet says what is missing instead of becoming uniAI', async () => {
  // UNI-1395: the chip and the request agree, so send is off with the same hint as a web frame
  const model = await mount(settingsWith('custom', '…abcd', ''), false)
  expect(model.chip).toBe(AI_MODEL_PICKER_STRINGS.en.choose)
  expect(model.send.disabled).toBe(true)
  expect(model.hint).toBe('Choose a model to send')
  act(() => root.unmount())
  root = createRoot(host)
  const key = await mount(settingsWith('openai', '', 'gpt-x'), false)
  expect(key.send.disabled).toBe(true)
  expect(key.hint).toBe('Add an API key in AI settings to use the assistant.')
})

it('a host that did not ask for the rule keeps send on for the default uniAI selection', async () => {
  const { send, hint } = await mount(
    { ...defaultAiSettings(), uniAiAvailable: false, provider: 'genspark' },
    false,
  )
  expect(send.disabled).toBe(false)
  expect(hint).toBe('Enter to send')
})

it('custom with a model but no server URL asks for the URL, not an API key (desktop and web frame)', async () => {
  // UNI-1395 FE F2: a custom endpoint's key is optional, so "add an API key" pointed at the wrong field
  for (const requireModel of [false, true]) {
    act(() => root.unmount())
    root = createRoot(host)
    const { send, hint, chip } = await mount(settingsWith('custom', '', 'llama3', ''), requireModel)
    expect(chip, String(requireModel)).toBe(AI_MODEL_PICKER_STRINGS.en.choose)
    expect(send.disabled, String(requireModel)).toBe(true)
    expect(hint, String(requireModel)).toBe(AI_MODEL_PICKER_STRINGS.en.needBaseUrl)
    expect(hint, String(requireModel)).not.toBe(AI_MODEL_PICKER_STRINGS.en.needKey)
  }
})

it('every locale has all three hints', () => {
  for (const [lang, strings] of Object.entries(AI_MODEL_PICKER_STRINGS)) {
    expect(strings.needModel, lang).toBeTruthy()
    expect(strings.needKey, lang).toBeTruthy()
    expect(strings.needBaseUrl, lang).toBeTruthy()
  }
  expect(AI_MODEL_PICKER_STRINGS.en.needBaseUrl).toBe(
    'Add the server URL in AI settings to use the assistant.',
  )
})
