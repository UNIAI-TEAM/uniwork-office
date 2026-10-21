// UNI-2060: a ribbon button's accessible name is the plain command name; the chord goes into
// aria-keyshortcuts (from the same @genoffice/shortcuts row) and stays in the visible tooltip.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  accessibleShortcutProblems,
  findDisplayChord,
  findShortcut,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { htmlHint, htmlSurface, type HtmlShortcutCommand } from '../src/renderer/shortcuts'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

function renderRibbon(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const props = {
    disabled: false,
    dirty: true,
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onFind: vi.fn(),
    autoSave: false,
    onToggleAutoSave: vi.fn(),
    aiOpen: false,
    onToggleAi: vi.fn(),
    onAiPreset: vi.fn(),
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    view: 'preview' as const,
    onView: vi.fn(),
    canInsert: true,
    onInsert: vi.fn(),
    canvasMode: 'edit' as const,
    onPresent: vi.fn(),
  }
  act(() => root.render(createElement(Ribbon, props)))
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

/** quick-access buttons in render order, with the table row each is bound to */
const QUICK_ACCESS: ReadonlyArray<{ command: HtmlShortcutCommand; row: string }> = [
  { command: 'save', row: 'html-002' },
  { command: 'saveAs', row: 'html-003' },
  { command: 'undo', row: 'html-006' },
  { command: 'redo', row: 'html-007' },
  { command: 'find', row: 'html-012' },
]

describe.each<ShortcutPlatform>(['win', 'mac'])('HTML ribbon accessible names (%s)', (platform) => {
  beforeEach(() => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(
      platform === 'mac' ? 'MacIntel' : 'Win32',
    )
  })

  it('no aria-label carries a chord', () => {
    const container = renderRibbon()
    const own = '[aria-label]'
    expect(container.querySelectorAll(own).length).toBeGreaterThan(5)
    for (const el of container.querySelectorAll(own)) {
      expect(findDisplayChord(el.getAttribute('aria-label')!), el.outerHTML).toBeNull()
    }
  })

  it('every table-bound quick-access button has the plain name and the platform aria-keyshortcuts', () => {
    const container = renderRibbon()
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.ribbon-tabs button.qa-btn')]
    expect(buttons.length).toBeGreaterThanOrEqual(QUICK_ACCESS.length)
    QUICK_ACCESS.forEach(({ command, row }, i) => {
      const button = buttons[i]!
      const action = findShortcut('html', row)!
      expect(
        accessibleShortcutProblems(
          {
            name: button.getAttribute('aria-label') ?? button.textContent ?? '',
            keyshortcuts: button.getAttribute('aria-keyshortcuts'),
          },
          action,
          platform,
          htmlSurface(),
        ),
      ).toEqual([])
      // the visible tooltip keeps the chord
      const hint = htmlHint(command, platform, htmlSurface())
      if (hint) expect(button.getAttribute('data-tip')).toContain(hint)
    })
  })
})
