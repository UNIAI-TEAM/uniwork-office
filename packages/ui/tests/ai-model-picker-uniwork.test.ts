/** @vitest-environment jsdom */
// G6-05u WI-A (UNI-1372), UNI-2309: the chip always names UniWork AI, the one provider; while the
// host does not offer it (or the cloud says it cannot answer) Send stays off and the hint says so.
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
  bridgeOverrides: Partial<AiModelPickerBridge> = {},
) {
  const bridge: AiModelPickerBridge = {
    getSettings: async () => settings,
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

describe('AiModelPicker: UniWork AI is the one provider', () => {
  it('shows "UniWork AI" on the chip and keeps Send on while UniWork AI is offered', async () => {
    setUniworkAiAvailable(true)
    const { chip, send, hint } = await mountPickerAndComposer(defaultAiSettings())
    expect(chip).toBe('UniWork AI')
    expect(send.disabled).toBe(false)
    expect(hint).toBe('Enter to send')
  })

  it('keeps the name, disables Send and says UniWork AI is not on while it is not offered', async () => {
    setUniworkAiAvailable(false)
    const { chip, send, hint } = await mountPickerAndComposer(defaultAiSettings())
    expect(chip).toBe('UniWork AI')
    expect(send.disabled).toBe(true)
    expect(hint).toBe(AI_MODEL_PICKER_STRINGS.en.needModel)
  })

  it('a cloud state other than ready keeps Send off even while the host flag is on', async () => {
    setUniworkAiAvailable(true)
    const { send, hint } = await mountPickerAndComposer(defaultAiSettings(), {
      getCloudStatus: async () => ({ state: 'credits-exhausted', hasCompletedRead: true }),
    })
    expect(send.disabled).toBe(true)
    expect(hint).toBe(AI_MODEL_PICKER_STRINGS.en.needModel)
  })
})
