/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiNoticeText, composerNoteFor, type ComposerNote } from '@genoffice/ai-provider'
import { AiComposer, type AiComposerProps } from '../src/AiComposer'
import {
  ack,
  clearUniworkAcks,
  isAcked,
  type UniworkAckKey,
} from '../src/ai-uniwork-composer'
import { aiUniworkText } from '../src/strings-ai-uniwork'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  clearUniworkAcks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.clear()
  clearUniworkAcks()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function baseProps(overrides: Partial<AiComposerProps> = {}): AiComposerProps {
  return {
    value: 'Hello AI',
    onChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    busy: false,
    placeholder: 'Ask anything',
    sendLabel: 'Send custom',
    stopLabel: 'Stop custom',
    lang: 'vi',
    ...overrides,
  }
}

function renderComposer(props: Partial<AiComposerProps> = {}) {
  const merged = baseProps(props)
  act(() => {
    root.render(createElement(AiComposer, merged))
  })
  return merged
}

describe('AiComposer — UniWork AI composer note (S7) and view-only coexistence (S11)', () => {
  it('renders one composer note above the composer for each note kind with its action button', () => {
    const onSignIn = vi.fn()
    const onChooseProvider = vi.fn()
    const signedOutNote = composerNoteFor({ uniworkSelected: true, cloudState: 'signed-out' })!
    renderComposer({
      lang: 'vi',
      uniwork: {
        active: true,
        provider: 'uniwork',
        note: signedOutNote,
        onSignIn,
        onChooseProvider,
      },
    })

    const noteEl = host.querySelector<HTMLElement>('.ai-uniwork-composer-note')
    expect(noteEl).not.toBeNull()
    expect(noteEl!.textContent).toContain(aiUniworkText('vi', 'aiUniworkSignedOut'))
    const actionBtn = noteEl!.querySelector<HTMLButtonElement>('button')
    expect(actionBtn).not.toBeNull()
    expect(actionBtn!.textContent).toBe(aiUniworkText('vi', 'acctSignIn'))
    // Visible note element does NOT carry role="status" or aria-live (prevent double reading)
    expect(noteEl!.getAttribute('role')).toBeNull()
    expect(noteEl!.getAttribute('aria-live')).toBeNull()

    // Persistent polite live region exists in DOM and has the note text written once
    const liveEl = host.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')
    expect(liveEl).not.toBeNull()
    expect(liveEl!.textContent).toContain(aiUniworkText('vi', 'aiUniworkSignedOut'))
  })

  it('maps not-entitled, subscription-inactive, credits-exhausted, unavailable and off to Choose another provider', () => {
    const cases: Array<[ComposerNote, string]> = [
      [
        { kind: 'off', key: 'aiUniworkOff', action: 'choose-provider' },
        aiUniworkText('en', 'aiUniworkOff'),
      ],
      [
        { kind: 'not-entitled', key: 'not_entitled', action: 'choose-provider' },
        aiNoticeText('not_entitled', 'en'),
      ],
      [
        {
          kind: 'subscription-inactive',
          key: 'cloudInactiveBody',
          action: 'choose-provider',
        },
        aiUniworkText('en', 'cloudInactiveBody'),
      ],
      [
        { kind: 'credits-exhausted', key: 'credits_exhausted', action: 'choose-provider' },
        aiNoticeText('credits_exhausted', 'en'),
      ],
      [
        { kind: 'unavailable', key: 'aiErrUnavailable', action: 'choose-provider' },
        aiUniworkText('en', 'aiErrUnavailable'),
      ],
    ]

    for (const [note, expectedBody] of cases) {
      renderComposer({
        lang: 'en',
        uniwork: {
          active: true,
          provider: 'uniwork',
          note,
        },
      })
      const noteEl = host.querySelector<HTMLElement>('.ai-uniwork-composer-note')
      expect(noteEl).not.toBeNull()
      expect(noteEl!.textContent).toContain(expectedBody)
      const btn = noteEl!.querySelector<HTMLButtonElement>('button')
      expect(btn!.textContent).toBe(aiUniworkText('en', 'aiRunChooseOther'))
    }
  })

  it('never auto-hides over time, clears when its action button is clicked, and resets when provider changes', () => {
    vi.useFakeTimers()
    try {
      const onChooseProvider = vi.fn()
      const note: ComposerNote = {
        kind: 'credits-exhausted',
        key: 'credits_exhausted',
        action: 'choose-provider',
      }
      renderComposer({
        lang: 'vi',
        uniwork: {
          active: true,
          provider: 'uniwork',
          note,
          onChooseProvider,
        },
      })

      expect(host.querySelector('.ai-uniwork-composer-note')).not.toBeNull()
      act(() => {
        vi.advanceTimersByTime(120_000)
      })
      // Still visible after 2 minutes (never auto-hides)
      const noteEl = host.querySelector<HTMLElement>('.ai-uniwork-composer-note')
      expect(noteEl).not.toBeNull()

      // Clicking action button invokes callback and clears the note
      act(() => {
        noteEl!.querySelector('button')!.click()
      })
      expect(onChooseProvider).toHaveBeenCalledTimes(1)
      expect(host.querySelector('.ai-uniwork-composer-note')).toBeNull()

      // Switching provider away and back re-shows the note if condition still holds
      renderComposer({
        lang: 'vi',
        uniwork: {
          active: false,
          provider: 'openai',
          note: null,
          onChooseProvider,
        },
      })
      renderComposer({
        lang: 'vi',
        uniwork: {
          active: true,
          provider: 'uniwork',
          note,
          onChooseProvider,
        },
      })
      expect(host.querySelector('.ai-uniwork-composer-note')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders view-only sub-line under the composer and co-exists with a composer note above it (S11)', () => {
    const note: ComposerNote = {
      kind: 'credits-exhausted',
      key: 'credits_exhausted',
      action: 'choose-provider',
    }
    renderComposer({
      lang: 'vi',
      viewOnly: true,
      uniwork: {
        active: true,
        provider: 'uniwork',
        note,
      },
    })

    const noteEl = host.querySelector<HTMLElement>('.ai-uniwork-composer-note')
    const viewOnlyEl = host.querySelector<HTMLElement>('.ai-uniwork-view-only')
    expect(noteEl).not.toBeNull()
    expect(viewOnlyEl).not.toBeNull()
    expect(viewOnlyEl!.textContent).toBe(aiUniworkText('vi', 'aiUniworkViewOnly'))
  })
})

describe('AiComposer — First-use disclosure & local-file variant (S8 + G05BE-6)', () => {
  const ackKey: UniworkAckKey = { account: 'user-1', org: 'org-acme', document: 'doc-42' }

  it('renders disclosure region with role="region", aria-label, tabIndex=-1, and does not steal focus on appear', () => {
    const outsideInput = document.createElement('input')
    document.body.append(outsideInput)
    outsideInput.focus()
    expect(document.activeElement).toBe(outsideInput)

    const onLearnMore = vi.fn()
    renderComposer({
      lang: 'vi',
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: {
          ackKey,
          orgName: 'Acme Corp',
          variant: 'document',
          onLearnMore,
        },
      },
    })

    // Focus was not stolen by the disclosure appearing
    expect(document.activeElement).toBe(outsideInput)

    const region = host.querySelector<HTMLElement>('[role="region"]')
    expect(region).not.toBeNull()
    expect(region!.getAttribute('aria-label')).toBe(
      aiUniworkText('vi', 'aiUniworkDisclosureLabel'),
    )
    expect(region!.getAttribute('tabindex')).toBe('-1')
    expect(region!.textContent).toContain(
      aiUniworkText('vi', 'aiUniworkDisclosure', { org: 'Acme Corp' }),
    )

    // Ack button has aria-describedby pointing to the disclosure sentence id
    const buttons = [...region!.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons).toHaveLength(2)
    const [ackBtn, learnMoreBtn] = buttons
    expect(ackBtn!.textContent).toBe(aiUniworkText('vi', 'aiUniworkAck'))
    expect(learnMoreBtn!.textContent).toBe(aiUniworkText('vi', 'aiUniworkLearnMore'))
    const descId = ackBtn!.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(descId!)?.textContent).toContain('Acme Corp')

    act(() => learnMoreBtn!.click())
    expect(onLearnMore).toHaveBeenCalledTimes(1)

    outsideInput.remove()
  })

  it('shows local-file disclosure + conversation-restart notice (G05BE-6) when variant="local"', () => {
    const localKey: UniworkAckKey = { account: 'user-1', org: 'org-acme', document: 'local' }
    renderComposer({
      lang: 'vi',
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: {
          ackKey: localKey,
          orgName: 'Acme Corp',
          variant: 'local',
        },
      },
    })

    const region = host.querySelector<HTMLElement>('[role="region"]')
    expect(region).not.toBeNull()
    expect(region!.textContent).toContain(
      aiUniworkText('vi', 'aiUniworkLocalFile', { org: 'Acme Corp' }),
    )
    expect(region!.textContent).toContain(aiUniworkText('vi', 'aiUniworkLocalFileRestart'))
  })

  it('keeps Send in tab order with aria-disabled="true" while unacked, and clicking Send or pressing Enter announces aiUniworkSendNeedsAck and focuses disclosure', () => {
    const props = renderComposer({
      lang: 'vi',
      value: 'Summarize this',
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: {
          ackKey,
          orgName: 'Acme Corp',
          variant: 'document',
        },
      },
    })

    const sendBtn = host.querySelector<HTMLButtonElement>('.ai-send-btn')!
    expect(sendBtn.getAttribute('aria-disabled')).toBe('true')
    // Must NOT be native disabled so keyboard users can tab to it and hear aria-describedby
    expect(sendBtn.disabled).toBe(false)

    const describedBy = (sendBtn.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    expect(describedBy.length).toBeGreaterThanOrEqual(2)
    const describedText = describedBy
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    expect(describedText).toContain(aiUniworkText('vi', 'aiUniworkSendNeedsAck'))
    expect(describedText).toContain(
      aiUniworkText('vi', 'aiUniworkDisclosure', { org: 'Acme Corp' }),
    )

    // Clicking Send while unacked does not call onSend, announces aiUniworkSendNeedsAck, and focuses the disclosure region
    const region = host.querySelector<HTMLElement>('[role="region"]')!
    act(() => {
      sendBtn.click()
    })
    expect(props.onSend).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(region)
    const liveEl = host.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!
    expect(liveEl.textContent).toContain(aiUniworkText('vi', 'aiUniworkSendNeedsAck'))

    // Pressing Enter in textarea while unacked also does not send and focuses disclosure
    const textarea = host.querySelector<HTMLTextAreaElement>('.ai-input')!
    textarea.focus()
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(props.onSend).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(region)
  })

  it('collapses to permanent aiUniworkDisclosureShort sub-line after clicking Ack and enables Send; re-prompts when document or org changes', () => {
    const onSend = vi.fn()
    renderComposer({
      lang: 'vi',
      value: 'Hello',
      onSend,
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: {
          ackKey,
          orgName: 'Acme Corp',
          variant: 'document',
        },
      },
    })

    const region = host.querySelector<HTMLElement>('[role="region"]')!
    const ackBtn = region.querySelector<HTMLButtonElement>('button')!
    act(() => {
      ackBtn.click()
    })

    expect(isAcked(ackKey)).toBe(true)
    expect(host.querySelector('[role="region"]')).toBeNull()

    const shortEl = host.querySelector<HTMLElement>('.ai-uniwork-disclosure-short')
    expect(shortEl).not.toBeNull()
    expect(shortEl!.textContent).toContain(
      aiUniworkText('vi', 'aiUniworkDisclosureShort', { org: 'Acme Corp' }),
    )

    const sendBtn = host.querySelector<HTMLButtonElement>('.ai-send-btn')!
    expect(sendBtn.getAttribute('aria-disabled')).toBeNull()
    act(() => {
      sendBtn.click()
    })
    expect(onSend).toHaveBeenCalledTimes(1)

    // Changing document or org re-prompts the full disclosure
    renderComposer({
      lang: 'vi',
      value: 'Hello',
      onSend,
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: {
          ackKey: { ...ackKey, document: 'doc-99' },
          orgName: 'Acme Corp',
          variant: 'document',
        },
      },
    })
    expect(host.querySelector('[role="region"]')).not.toBeNull()
    expect(host.querySelector<HTMLButtonElement>('.ai-send-btn')!.getAttribute('aria-disabled')).toBe(
      'true',
    )
  })
})

describe('AiComposer — Send/Stop labels, polite live announcements, Escape guard & coarse pointer (S9)', () => {
  const ackKey: UniworkAckKey = { account: 'u1', org: 'o1', document: 'd1' }

  beforeEach(() => {
    ack(ackKey)
  })

  it('uses aiRunSend and aiRunStop when UniWork AI is active and announces aiRunRunning / aiRunStopped politely', () => {
    renderComposer({
      lang: 'vi',
      busy: false,
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: { ackKey, orgName: 'Org', variant: 'document' },
      },
    })

    const sendBtn = host.querySelector<HTMLButtonElement>('.ai-send-btn')!
    expect(sendBtn.getAttribute('aria-label')).toBe(aiUniworkText('vi', 'aiRunSend'))
    expect(sendBtn.getAttribute('title')).toBe(aiUniworkText('vi', 'aiRunSend'))

    // Transition busy: false -> true
    renderComposer({
      lang: 'vi',
      busy: true,
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: { ackKey, orgName: 'Org', variant: 'document' },
      },
    })

    const stopBtn = host.querySelector<HTMLButtonElement>('.ai-stop-btn')!
    expect(stopBtn.getAttribute('aria-label')).toBe(aiUniworkText('vi', 'aiRunStop'))
    expect(stopBtn.textContent).toBe(aiUniworkText('vi', 'aiRunStop'))

    const liveEl = host.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!
    expect(liveEl.textContent).toBe(aiUniworkText('vi', 'aiRunRunning'))

    // Transition busy: true -> false
    renderComposer({
      lang: 'vi',
      busy: false,
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: { ackKey, orgName: 'Org', variant: 'document' },
      },
    })
    expect(liveEl.textContent).toBe(aiUniworkText('vi', 'aiRunStopped'))
  })

  it('Escape stops the run only when focus is inside the composer and no popup is open', () => {
    const onStop = vi.fn()
    renderComposer({
      lang: 'vi',
      busy: true,
      onStop,
      popupOpen: false,
      uniwork: {
        active: true,
        provider: 'uniwork',
      },
    })

    const textarea = host.querySelector<HTMLTextAreaElement>('.ai-input')!
    textarea.focus()

    // While popupOpen prop is true, Escape does NOT call onStop
    renderComposer({
      lang: 'vi',
      busy: true,
      onStop,
      popupOpen: true,
      uniwork: { active: true, provider: 'uniwork' },
    })
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onStop).not.toHaveBeenCalled()

    // While a DOM listbox/menu/dialog is open, Escape does NOT call onStop
    renderComposer({
      lang: 'vi',
      busy: true,
      onStop,
      popupOpen: false,
      uniwork: { active: true, provider: 'uniwork' },
    })
    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    document.body.append(listbox)
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onStop).not.toHaveBeenCalled()
    listbox.remove()

    // With no popup open and focus inside composer, Escape calls onStop
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('defines 44x44px coarse pointer targets and uses only semantic tokens in ai-uniwork-composer.css', () => {
    const css = readFileSync(
      resolve(__dirname, '../src/ai-uniwork-composer/ai-uniwork-composer.css'),
      'utf8',
    )
    expect(css).toMatch(/@media\s*\(pointer:\s*coarse\)/)
    expect(css).toMatch(/min-width:\s*44px/)
    expect(css).toMatch(/min-height:\s*44px/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgba?\s*\(/)
  })
})
