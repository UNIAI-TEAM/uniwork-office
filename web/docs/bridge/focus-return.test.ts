// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFocusReturn } from './focus-return'

let off: () => void
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML =
    '<button id="ribbon">Bold</button><div class="ProseMirror" contenteditable="true" tabindex="0" id="a">a</div>' +
    '<div class="ProseMirror" contenteditable="true" tabindex="0" id="b">b</div>'
  off = installFocusReturn()
})
afterEach(() => {
  off()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const el = (id: string) => document.getElementById(id) as HTMLElement
/** the host focusing the iframe window after its dialog closed */
const hostHandsFocusBack = () => {
  window.dispatchEvent(new Event('focus'))
  vi.runAllTimers()
}

describe('docs frame: focus hand-back after a host dialog', () => {
  it('puts the focus back in the editor the user was in when the body is active', () => {
    el('b').focus()
    el('b').blur() // the host dialog took the focus: <body> is active again
    expect(document.activeElement).toBe(document.body)
    hostHandsFocusBack()
    expect(document.activeElement).toBe(el('b'))
  })

  it('falls back to the first editing surface when none was focused yet', () => {
    hostHandsFocusBack()
    expect(document.activeElement).toBe(el('a'))
  })

  it('leaves a focused element alone', () => {
    el('ribbon').focus()
    hostHandsFocusBack()
    expect(document.activeElement).toBe(el('ribbon'))
  })

  it('does not steal the focus from a click (pointer press just before)', () => {
    el('a').focus()
    el('a').blur()
    document.dispatchEvent(new Event('pointerdown'))
    hostHandsFocusBack()
    expect(document.activeElement).toBe(document.body)
    // later, a real hand-back works again
    vi.advanceTimersByTime(1000)
    hostHandsFocusBack()
    expect(document.activeElement).toBe(el('a'))
  })

  it('a press followed by the window losing focus does not block the hand-back', () => {
    el('a').focus()
    document.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('blur')) // the host dialog took the focus right away
    el('a').blur()
    hostHandsFocusBack()
    expect(document.activeElement).toBe(el('a'))
  })

  it('stays out of an open modal dialog', () => {
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"></div>')
    hostHandsFocusBack()
    expect(document.activeElement).toBe(document.body)
  })

  it('stops after it is removed', () => {
    off()
    hostHandsFocusBack()
    expect(document.activeElement).toBe(document.body)
    off = installFocusReturn()
  })
})
