/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findDisplayChord } from '@genoffice/shortcuts'
import { FindPanel, type FindPanelStrings, type FindTarget } from '../src/find-panel'

const TARGET: FindTarget = {
  editable: true,
  search: () => 0,
  activate: () => {},
  replaceOne: () => {},
  replaceAll: () => {},
  clear: () => {},
  onDocChanged: () => () => {},
}

// tooltips keep the chord; the names are the plain command
const STRINGS: FindPanelStrings = {
  findPlaceholder: 'Find',
  replacePlaceholder: 'Replace with',
  matchCase: 'Match case',
  wholeWord: 'Whole words only',
  noResults: 'No results',
  prevMatch: 'Previous (Shift+Enter)',
  nextMatch: 'Next (Enter)',
  closeEsc: 'Close (Esc)',
  prevName: 'Previous',
  nextName: 'Next',
  closeName: 'Close',
  replace: 'Replace',
  replaceAll: 'Replace All',
}

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

const mount = (strings: FindPanelStrings) =>
  act(() => root.render(createElement(FindPanel, { target: TARGET, strings, onClose: () => {} })))

const prev = () => host.querySelector<HTMLElement>('[data-find-step="prev"]')!
const next = () => host.querySelector<HTMLElement>('[data-find-step="next"]')!
const close = () => host.querySelector<HTMLElement>('.find-close')!

describe('shared FindPanel names its stepping buttons plainly', () => {
  it('names Previous / Next / Close without a chord and announces the chord in aria-keyshortcuts', () => {
    mount(STRINGS)
    expect(prev().getAttribute('aria-label')).toBe('Previous')
    expect(next().getAttribute('aria-label')).toBe('Next')
    expect(close().getAttribute('aria-label')).toBe('Close')
    expect(prev().getAttribute('aria-keyshortcuts')).toBe('Shift+Enter')
    expect(next().getAttribute('aria-keyshortcuts')).toBe('Enter')
    expect(close().getAttribute('aria-keyshortcuts')).toBe('Escape')
  })

  it('keeps the tooltips as they were', () => {
    mount(STRINGS)
    expect(prev().getAttribute('data-tip')).toBe('Previous (Shift+Enter)')
    expect(next().getAttribute('data-tip')).toBe('Next (Enter)')
    expect(close().getAttribute('data-tip')).toBe('Close (Esc)')
  })

  it('no control in the panel carries a chord in its accessible name', () => {
    mount(STRINGS)
    for (const el of host.querySelectorAll('[aria-label]')) {
      expect(findDisplayChord(el.getAttribute('aria-label') ?? ''), el.outerHTML).toBeNull()
    }
  })

  it('falls back to the tooltip strings when a host passes no names', () => {
    const { prevName: _p, nextName: _n, closeName: _c, ...legacy } = STRINGS
    mount(legacy)
    expect(prev().getAttribute('aria-label')).toBe('Previous (Shift+Enter)')
    expect(prev().getAttribute('aria-keyshortcuts')).toBeNull()
  })
})
