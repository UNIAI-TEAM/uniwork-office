/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiNoticeText, composerNoteFor, type ComposerNote } from '@genoffice/ai-provider'
import { AiComposer, type AiComposerProps } from '../src/AiComposer'
import { ack, clearUniworkAcks, isAcked, type UniworkAckKey } from '../src/ai-uniwork-composer'
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

  it('translates not_entitled and credits_exhausted composer notes in the active locale across non-en/vi locales (RF1-18)', () => {
    const enNotEntitled = aiNoticeText('not_entitled', 'en')
    const enExhausted = aiNoticeText('credits_exhausted', 'en')

    for (const lang of ['de', 'ja', 'zh', 'fr'] as const) {
      renderComposer({
        lang,
        uniwork: {
          active: true,
          provider: 'uniwork',
          note: { kind: 'not-entitled', key: 'not_entitled', action: 'choose-provider' },
        },
      })
      const notEntitledText =
        host.querySelector<HTMLElement>('.ai-uniwork-composer-note-text')?.textContent ?? ''
      expect(notEntitledText.length).toBeGreaterThan(0)
      expect(notEntitledText).not.toBe(enNotEntitled)

      renderComposer({
        lang,
        uniwork: {
          active: true,
          provider: 'uniwork',
          note: { kind: 'credits-exhausted', key: 'credits_exhausted', action: 'choose-provider' },
        },
      })
      const exhaustedText =
        host.querySelector<HTMLElement>('.ai-uniwork-composer-note-text')?.textContent ?? ''
      expect(exhaustedText.length).toBeGreaterThan(0)
      expect(exhaustedText).not.toBe(enExhausted)
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
    expect(region!.getAttribute('aria-label')).toBe(aiUniworkText('vi', 'aiUniworkDisclosureLabel'))
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

    const describedBy = (sendBtn.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
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
    expect(
      host.querySelector<HTMLButtonElement>('.ai-send-btn')!.getAttribute('aria-disabled'),
    ).toBe('true')
  })
})

describe('AiComposer — disclosure ack with an unscoped key (RF3-1)', () => {
  const unscoped: UniworkAckKey = { account: '', org: '', document: 'doc-42' }

  function renderUnscoped(key: UniworkAckKey, onSend = vi.fn()) {
    renderComposer({
      lang: 'vi',
      value: 'Hello',
      onSend,
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: { ackKey: key, orgName: 'Acme Corp', variant: 'document' },
      },
    })
    return onSend
  }

  const sendBtn = () => host.querySelector<HTMLButtonElement>('.ai-send-btn')!

  it('lets one in-memory ack through for an empty account, stores nothing and asks again when the key changes', () => {
    const onSend = renderUnscoped(unscoped)
    expect(host.querySelector('[role="region"]')).not.toBeNull()
    expect(sendBtn().getAttribute('aria-disabled')).toBe('true')

    act(() => {
      host.querySelector<HTMLButtonElement>('[role="region"] button')!.click()
    })
    expect(host.querySelector('[role="region"]')).toBeNull()
    expect(sendBtn().getAttribute('aria-disabled')).toBeNull()
    expect(sendBtn().disabled).toBe(false)
    act(() => {
      sendBtn().click()
    })
    expect(onSend).toHaveBeenCalledTimes(1)

    // never written to storage and never shared through the ack store
    expect(localStorage.getItem('uniwork.office.ai.disclosure.ack.v1')).toBeNull()
    expect(isAcked(unscoped)).toBe(false)

    // another document, org or the account arriving later: ack required again
    for (const next of [
      { ...unscoped, document: 'doc-99' },
      { ...unscoped, org: 'org-2' },
    ]) {
      renderUnscoped(next, onSend)
      expect(host.querySelector('[role="region"]')).not.toBeNull()
      expect(sendBtn().getAttribute('aria-disabled')).toBe('true')
    }
    // and going back to the first key does not resurrect the old ack
    renderUnscoped(unscoped, onSend)
    expect(host.querySelector('[role="region"]')).not.toBeNull()
    expect(sendBtn().getAttribute('aria-disabled')).toBe('true')
    expect(localStorage.getItem('uniwork.office.ai.disclosure.ack.v1')).toBeNull()
  })

  it('does not count an in-memory ack for the account that arrives later', () => {
    renderUnscoped(unscoped)
    act(() => {
      host.querySelector<HTMLButtonElement>('[role="region"] button')!.click()
    })
    expect(host.querySelector('[role="region"]')).toBeNull()
    renderUnscoped({ account: 'acc-1', org: '', document: 'doc-42' })
    expect(host.querySelector('[role="region"]')).not.toBeNull()
    expect(sendBtn().getAttribute('aria-disabled')).toBe('true')
  })
})

describe('AiComposer — Send/Stop labels, polite live announcements, Escape guard & coarse pointer (S9)', () => {
  const ackKey: UniworkAckKey = { account: 'u1', org: 'o1', document: 'd1' }

  beforeEach(() => {
    ack(ackKey)
  })

  it('announces aiRunRunning when starting, does NOT announce aiRunStopped on normal completion, and announces aiRunStopped when user stops (RF1-5)', () => {
    const onStop = vi.fn()
    renderComposer({
      lang: 'vi',
      busy: false,
      onStop,
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
      onStop,
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

    // Normal completion (busy: true -> false without clicking Stop or pressing Escape) must NOT announce aiRunStopped
    renderComposer({
      lang: 'vi',
      busy: false,
      onStop,
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: { ackKey, orgName: 'Org', variant: 'document' },
      },
    })
    expect(liveEl.textContent).not.toBe(aiUniworkText('vi', 'aiRunStopped'))

    // Start a second run and stop via the Stop button -> announces aiRunStopped
    renderComposer({
      lang: 'vi',
      busy: true,
      onStop,
      uniwork: {
        active: true,
        provider: 'uniwork',
        disclosure: { ackKey, orgName: 'Org', variant: 'document' },
      },
    })
    expect(liveEl.textContent).toBe(aiUniworkText('vi', 'aiRunRunning'))

    act(() => {
      host.querySelector<HTMLButtonElement>('.ai-stop-btn')!.click()
    })
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(liveEl.textContent).toBe(aiUniworkText('vi', 'aiRunStopped'))

    // When uniwork.onAnnounce is provided, AiComposer delegates to the panel's live region
    // and does NOT render a second [role="status"][aria-live="polite"] node (S9 single live region)
    const onAnnounce = vi.fn()
    renderComposer({
      lang: 'vi',
      busy: false,
      onStop,
      uniwork: {
        active: true,
        provider: 'uniwork',
        onAnnounce,
        disclosure: { ackKey, orgName: 'Org', variant: 'document' },
      },
    })
    expect(host.querySelectorAll('[role="status"][aria-live="polite"]').length).toBe(0)
  })

  it('Escape stops the run when focus is inside the composer, ignores persistent document listboxes/expanded elements, and blocks only on composer-owned popups (RF1-8)', () => {
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
    const inputBox = host.querySelector<HTMLElement>('.ai-input-box')!
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

    // While a listbox/menu/dialog is open INSIDE the composer (.ai-input-box), Escape does NOT call onStop
    renderComposer({
      lang: 'vi',
      busy: true,
      onStop,
      popupOpen: false,
      uniwork: { active: true, provider: 'uniwork' },
    })
    const composerListbox = document.createElement('div')
    composerListbox.setAttribute('role', 'listbox')
    composerListbox.id = 'composer-owned-popup'
    const composerTrigger = document.createElement('button')
    composerTrigger.setAttribute('aria-controls', 'composer-owned-popup')
    composerTrigger.setAttribute('aria-expanded', 'true')
    inputBox.append(composerTrigger, composerListbox)
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onStop).not.toHaveBeenCalled()
    composerListbox.remove()
    composerTrigger.remove()

    // Persistent listbox or aria-expanded="true" OUTSIDE the composer (e.g. StylesPane/NavPane, thread toggles) must NOT block Escape
    const outsideListbox = document.createElement('div')
    outsideListbox.setAttribute('role', 'listbox')
    const outsideToggle = document.createElement('button')
    outsideToggle.setAttribute('aria-expanded', 'true')
    document.body.append(outsideListbox, outsideToggle)

    // Inline collapsible without aria-haspopup inside the composer (e.g. AiQueueStrip toggle) must NOT block Escape
    const inlineToggle = document.createElement('button')
    inlineToggle.setAttribute('aria-expanded', 'true')
    inputBox.append(inlineToggle)

    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onStop).toHaveBeenCalledTimes(1)

    outsideListbox.remove()
    outsideToggle.remove()
    inlineToggle.remove()
  })

  it('RF2-8: only an open popup owned by the composer blocks Escape; a persistent or hidden inline menu does not', () => {
    const onStop = vi.fn()
    renderComposer({
      lang: 'vi',
      busy: true,
      onStop,
      uniwork: { active: true, provider: 'uniwork' },
    })
    const textarea = host.querySelector<HTMLTextAreaElement>('.ai-input')!
    const inputBox = host.querySelector<HTMLElement>('.ai-input-box')!
    textarea.focus()
    const pressEscape = () =>
      act(() => {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })

    // A visible inline menu whose owner is collapsed is persistent chrome, not an open popup
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.id = 'inline-menu'
    const owner = document.createElement('button')
    owner.setAttribute('aria-controls', 'inline-menu')
    owner.setAttribute('aria-expanded', 'false')
    inputBox.append(owner, menu)
    pressEscape()
    expect(onStop).toHaveBeenCalledTimes(1)

    // A visible menu nobody owns is not a popup either
    owner.remove()
    pressEscape()
    expect(onStop).toHaveBeenCalledTimes(2)

    // An expanded owner makes it an open popup, so Escape belongs to the popup
    owner.setAttribute('aria-expanded', 'true')
    inputBox.append(owner)
    pressEscape()
    expect(onStop).toHaveBeenCalledTimes(2)

    // ...unless the popup itself is hidden
    menu.setAttribute('hidden', '')
    pressEscape()
    expect(onStop).toHaveBeenCalledTimes(3)
    menu.removeAttribute('hidden')
    menu.setAttribute('aria-hidden', 'true')
    pressEscape()
    expect(onStop).toHaveBeenCalledTimes(4)
    menu.remove()
    owner.remove()

    // A modal dialog inside the composer is open by definition
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    inputBox.append(dialog)
    pressEscape()
    expect(onStop).toHaveBeenCalledTimes(4)
    dialog.remove()

    // The composer's own popups (model picker, dropdown) are open while rendered
    const pop = document.createElement('div')
    pop.className = 'ai-model-pop'
    inputBox.append(pop)
    pressEscape()
    expect(onStop).toHaveBeenCalledTimes(4)
    pop.remove()
  })

  it('defines 44x44px coarse pointer targets, uses only semantic tokens, and exports/imports ai-uniwork-composer.css from @genoffice/ui (RF1-3)', () => {
    const css = readFileSync(
      resolve(__dirname, '../src/ai-uniwork-composer/ai-uniwork-composer.css'),
      'utf8',
    )
    expect(css).toMatch(/@media\s*\(pointer:\s*coarse\)/)
    expect(css).toMatch(/min-width:\s*44px/)
    expect(css).toMatch(/min-height:\s*44px/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgba?\s*\(/)

    const pkgJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
      exports?: Record<string, string>
    }
    expect(pkgJson.exports?.['./ai-uniwork-composer.css']).toBe(
      './src/ai-uniwork-composer/ai-uniwork-composer.css',
    )

    const composerIndexSrc = readFileSync(
      resolve(__dirname, '../src/ai-uniwork-composer/index.tsx'),
      'utf8',
    )
    expect(composerIndexSrc).toContain("import './ai-uniwork-composer.css'")
  })
})
