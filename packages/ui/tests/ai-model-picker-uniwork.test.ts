/** @vitest-environment jsdom */
// G6-05u WI-A (UNI-1372), UNI-2309: the chip always names UniWork AI, the one provider; while the
// host does not offer it Send stays off and the hint says so. A cloud state (signed out, no
// credits, unavailable) is the composer note's to name: the hint never gives a second reason.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  composerNoteFor,
  defaultAiSettings,
  setUniworkAiAvailable,
  type AiSettings,
  type ComposerNote,
} from '@genoffice/ai-provider'
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
  gatesSend = true,
  note: ComposerNote | null = null,
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
        footerStart: createElement(AiModelPicker, { bridge, lang: 'en', gatesSend }),
        onChange: () => {},
        onSend: () => {},
        onStop: () => {},
        ...(note ? { uniwork: { lang: 'en' as const, note } } : {}),
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

  it('a cloud state other than ready gives no hint while the host flag is on: the composer note names it', async () => {
    setUniworkAiAvailable(true)
    const { send, hint } = await mountPickerAndComposer(defaultAiSettings(), {
      getCloudStatus: async () => ({ state: 'credits-exhausted', hasCompletedRead: true }),
    })
    // the chip no longer closes Send here; a panel's composer note does, and says why
    expect(send.disabled).toBe(false)
    expect(hint).toBe('Enter to send')
  })

  it('desktop: the host flag is off in every cloud state but ready, so credits used up shows the note alone and keeps Send off', async () => {
    // the shell offers UniWork AI only while the cloud reads ready; its snapshot has no
    // hasCompletedRead (it is null until the first read completed)
    setUniworkAiAvailable(false)
    const { send, hint } = await mountPickerAndComposer(
      defaultAiSettings(),
      {
        getCloudStatus: async () => ({
          state: 'credits-exhausted',
          signedIn: true,
          enabled: true,
        }),
      },
      true,
      composerNoteFor({ uniworkSelected: true, cloudState: 'credits-exhausted', signedOut: false }),
    )
    expect(hint).toBe('Enter to send')
    expect(host.querySelector('.ai-uniwork-composer-note')?.getAttribute('data-note-kind')).toBe(
      'credits-exhausted',
    )
    expect(send.disabled).toBe(true)
  })

  it('signed out gives no hint either, though the host flag is off: the composer note asks to sign in', async () => {
    setUniworkAiAvailable(false)
    const { hint } = await mountPickerAndComposer(defaultAiSettings(), {
      getCloudStatus: async () => ({
        state: 'signed-out',
        signedIn: false,
        hasCompletedRead: true,
      }),
    })
    expect(hint).toBe('Enter to send')
  })

  it('a chip that does not gate Send (Sheets) publishes no hint while UniWork AI is not offered', async () => {
    setUniworkAiAvailable(false)
    const { send, hint } = await mountPickerAndComposer(defaultAiSettings(), {}, false)
    expect(send.disabled).toBe(false)
    expect(hint).toBe('Enter to send')
  })
})
