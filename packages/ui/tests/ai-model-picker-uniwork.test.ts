/** @vitest-environment jsdom */
// G6-05u WI-A (UNI-1372): when the UniWork AI flag is on, `uniwork` (which has `models: []`) must
// be listed by aiModelPickerGroups so the chip shows "UniWork AI" (not "Choose model") and web
// frames (`requireModel: true`, `providers.uniwork.apiKey = '…'`) do not resolve `needModel`.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings, setUniworkAiAvailable, type AiSettings } from '@genoffice/ai-provider'
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
  setUniworkAiAvailable(false)
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function mountPickerAndComposer(
  settings: AiSettings,
  requireModel: boolean,
  bridgeOverrides: Partial<AiModelPickerBridge> = {},
) {
  const bridge: AiModelPickerBridge = {
    getSettings: async () => settings,
    setSettings: async () => {},
    requireModel,
    ...bridgeOverrides,
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
    chip: host.querySelector('.ai-model-chip-text')?.textContent ?? null,
    send: host.querySelector('.ai-send-btn') as HTMLButtonElement,
    hint: host.querySelector('.ai-input-hint')?.textContent ?? null,
  }
}

describe('AiModelPicker with UniWork AI selected', () => {
  it('shows "UniWork AI" on the chip when the flag is on (desktop)', async () => {
    setUniworkAiAvailable(true)
    const settings: AiSettings = {
      ...defaultAiSettings(),
      uniAiAvailable: false,
      provider: 'uniwork',
    }
    const { chip, send, hint } = await mountPickerAndComposer(settings, false)
    expect(chip).toBe('UniWork AI')
    expect(send.disabled).toBe(false)
    expect(hint).toBe('Enter to send')
  })

  it('does not resolve needModel on web when UniWork AI is offered and selected', async () => {
    setUniworkAiAvailable(true)
    const settings: AiSettings = {
      ...defaultAiSettings(),
      uniAiAvailable: false,
      provider: 'uniwork',
    }
    settings.providers.uniwork = { apiKey: '…uw', model: '' }
    const { chip, send, hint } = await mountPickerAndComposer(settings, true)
    expect(chip).toBe('UniWork AI')
    expect(hint).not.toBe(AI_MODEL_PICKER_STRINGS.en.needModel)
    expect(send.disabled).toBe(false)
    expect(hint).toBe('Enter to send')
  })

  it('shows "Choose model" and disables Send with needModel hint when the UniWork AI flag is off', async () => {
    setUniworkAiAvailable(false)
    const settings: AiSettings = {
      ...defaultAiSettings(),
      uniAiAvailable: false,
      provider: 'uniwork',
    }
    const { chip, send, hint } = await mountPickerAndComposer(settings, false)
    expect(chip).toBe(AI_MODEL_PICKER_STRINGS.en.choose)
    expect(send.disabled).toBe(true)
    expect(hint).toBe(AI_MODEL_PICKER_STRINGS.en.needModel)
  })

  it('never silently falls back from a saved uniwork choice to UniAI when UniWork AI is unavailable even while UniAI is signed in', async () => {
    setUniworkAiAvailable(false)
    const settings: AiSettings = {
      ...defaultAiSettings(),
      uniAiAvailable: true,
      provider: 'uniwork',
    }
    const { chip, send, hint } = await mountPickerAndComposer(settings, false, {
      getAccountStatus: async () => ({ loggedIn: true }),
    })
    expect(chip).toBe(AI_MODEL_PICKER_STRINGS.en.choose)
    expect(send.disabled).toBe(true)
    expect(hint).toBe(AI_MODEL_PICKER_STRINGS.en.needModel)
  })
})
