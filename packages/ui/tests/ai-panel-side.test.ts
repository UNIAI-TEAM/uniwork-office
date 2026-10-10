/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  aiPanelInitiallyOpen,
  rememberAiPanelOpen,
  applyAiPanelPrefs,
  aiPanelWidthAtPointer,
} from '../src/ai-panel-prefs-store'

afterEach(() => {
  applyAiPanelPrefs({})
  vi.unstubAllGlobals()
})

describe('AI panel side in the renderer', () => {
  it('moves the layout on a side-only update and restores the default', () => {
    applyAiPanelPrefs({ side: 'right' })
    expect(document.documentElement.dataset.aiPanelSide).toBe('right')
    applyAiPanelPrefs({ side: 'left' })
    expect(document.documentElement.dataset.aiPanelSide).not.toBe('right')
  })

  it('measures width inward from the selected window edge', () => {
    vi.stubGlobal('innerWidth', 1200)
    applyAiPanelPrefs({ side: 'left' })
    expect(aiPanelWidthAtPointer(350)).toBe(350)
    applyAiPanelPrefs({ side: 'right' })
    expect(aiPanelWidthAtPointer(850)).toBe(350)
    expect(aiPanelWidthAtPointer(750)).toBe(450)
  })
})

describe('AI panel initial open state', () => {
  afterEach(() => localStorage.clear())

  it('follows the remembered per-app state while the setting is on', () => {
    applyAiPanelPrefs({ openInNewDocs: true })
    expect(aiPanelInitiallyOpen('k')).toBe(true)
    localStorage.setItem('k', '0')
    expect(aiPanelInitiallyOpen('k')).toBe(false)
  })

  it('starts collapsed regardless of the remembered state when off', () => {
    applyAiPanelPrefs({ openInNewDocs: false })
    localStorage.setItem('k', '1')
    expect(aiPanelInitiallyOpen('k')).toBe(false)
  })

  it('leaves the remembered state alone while off so turning it back on restores it', () => {
    applyAiPanelPrefs({ openInNewDocs: true })
    rememberAiPanelOpen('k', true)
    applyAiPanelPrefs({ openInNewDocs: false })
    rememberAiPanelOpen('k', false)
    applyAiPanelPrefs({ openInNewDocs: true })
    expect(aiPanelInitiallyOpen('k')).toBe(true)
    rememberAiPanelOpen('k', false)
    expect(aiPanelInitiallyOpen('k')).toBe(false)
  })

  it('starts collapsed in a narrow window when nothing is remembered, and does not remember that', () => {
    vi.stubGlobal('innerWidth', 390)
    localStorage.removeItem('narrow')
    applyAiPanelPrefs({ openInNewDocs: true })
    expect(aiPanelInitiallyOpen('narrow')).toBe(false)
    // the app's effect reports the implicit default: nothing is stored
    rememberAiPanelOpen('narrow', false)
    expect(localStorage.getItem('narrow')).toBeNull()
    // a later wide window still opens by default
    vi.stubGlobal('innerWidth', 1440)
    expect(aiPanelInitiallyOpen('narrow')).toBe(true)
  })

  it('a deliberate choice in a narrow window is remembered and wins over the width', () => {
    vi.stubGlobal('innerWidth', 390)
    localStorage.removeItem('narrow2')
    applyAiPanelPrefs({ openInNewDocs: true })
    rememberAiPanelOpen('narrow2', true)
    expect(localStorage.getItem('narrow2')).toBe('1')
    expect(aiPanelInitiallyOpen('narrow2')).toBe(true)
  })

  it('a wide window still opens by default and remembers an explicit close', () => {
    vi.stubGlobal('innerWidth', 1440)
    localStorage.removeItem('wide')
    applyAiPanelPrefs({ openInNewDocs: true })
    expect(aiPanelInitiallyOpen('wide')).toBe(true)
    rememberAiPanelOpen('wide', true)
    expect(localStorage.getItem('wide')).toBeNull()
    rememberAiPanelOpen('wide', false)
    expect(aiPanelInitiallyOpen('wide')).toBe(false)
  })
})
