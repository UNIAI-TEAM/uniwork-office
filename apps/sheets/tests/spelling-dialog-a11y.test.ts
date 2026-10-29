// @vitest-environment jsdom
// The Spelling dialog is keyboard-usable: it takes focus on open (so Escape works), gives focus
// back on close, opens on the first finding (the actions render only for the selected one) and
// its result rows are focusable and selectable with Enter / Space.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { SpellingDialog } from '../src/renderer/SpellingDialog'
import { SPELL_PROBE_WORD } from '../src/renderer/spell-check'
import type { SpellWorkbookLike } from '../src/renderer/spell-apply'

const workbook: SpellWorkbookLike = {
  getSheets: () => [{ getSheetId: () => 's1', getSheetName: () => 'Data' }],
  getSnapshot: () => ({
    sheets: {
      s1: { name: 'Data', cellData: { 0: { 0: { v: 'teh one' }, 1: { v: 'recieve it' } } } },
    },
  }),
  getSheetBySheetId: () => null,
}

describe('SpellingDialog keyboard contract', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    vi.unstubAllGlobals()
  })

  it('focuses itself, opens on the first finding, selects rows by key and restores focus', async () => {
    vi.stubGlobal('desktopApi', { onLanguageChanged: () => () => {} })
    vi.stubGlobal('nativeSpell', {
      isWordMisspelled: (word: string) =>
        word === 'teh' || word === 'recieve' || word === SPELL_PROBE_WORD,
      getWordSuggestions: (word: string) => (word === 'teh' ? ['the'] : ['receive']),
    })
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const onJumpTo = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en', children: null },
          createElement(SpellingDialog, {
            onClose,
            getWorkbook: () => workbook,
            isWithheld: () => false,
            onJumpTo,
            lazyNote: '',
            sessionIgnoredRef: { current: new Set<string>() },
            setMessage: () => {},
          }),
        ),
      )
    })
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement
    expect(document.activeElement).toBe(dialog)

    const rows = [...container.querySelectorAll<HTMLElement>('tbody tr')]
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.tabIndex === 0)).toBe(true)
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(container.querySelector('.spell-suggestion')?.textContent).toBe('the')

    await act(async () => {
      rows[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onJumpTo).toHaveBeenCalledWith('s1', 0, 1)
    expect(
      [...container.querySelectorAll('tbody tr')].map((row) => row.getAttribute('aria-selected')),
    ).toEqual(['false', 'true'])
    expect(container.querySelector('.spell-suggestion')?.textContent).toBe('receive')

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => root!.unmount())
    root = null
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('keeps focus in the dialog when Ignore removes the focused button, so Escape still closes', async () => {
    vi.stubGlobal('desktopApi', { onLanguageChanged: () => () => {} })
    vi.stubGlobal('nativeSpell', {
      isWordMisspelled: (word: string) =>
        word === 'teh' || word === 'recieve' || word === SPELL_PROBE_WORD,
      getWordSuggestions: (word: string) => (word === 'teh' ? ['the'] : ['receive']),
    })
    const onClose = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en', children: null },
          createElement(SpellingDialog, {
            onClose,
            getWorkbook: () => workbook,
            isWithheld: () => false,
            onJumpTo: () => {},
            lazyNote: '',
            sessionIgnoredRef: { current: new Set<string>() },
            setMessage: () => {},
          }),
        ),
      )
    })
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement
    const ignore = [...container.querySelectorAll<HTMLButtonElement>('.spell-actions button')].find(
      (button) => button.textContent === 'Ignore',
    )!
    ignore.focus()
    expect(document.activeElement).toBe(ignore)

    // Ignore drops the finding; the selection clears and the whole detail block unmounts
    await act(async () => {
      ignore.click()
    })
    expect(ignore.isConnected).toBe(false)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(document.activeElement).toBe(dialog)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports unavailable instead of an all-clear when the engine never flags the probe word', async () => {
    vi.stubGlobal('desktopApi', { onLanguageChanged: () => () => {} })
    vi.stubGlobal('nativeSpell', {
      isWordMisspelled: () => false,
      getWordSuggestions: () => [],
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en', children: null },
          createElement(SpellingDialog, {
            onClose: () => {},
            getWorkbook: () => workbook,
            isWithheld: () => false,
            onJumpTo: () => {},
            lazyNote: '',
            sessionIgnoredRef: { current: new Set<string>() },
            setMessage: () => {},
          }),
        ),
      )
    })
    const status = container.querySelector('[role="status"]')?.textContent ?? ''
    expect(status).toContain('unavailable')
    expect(status).not.toContain('No suspected')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
  })
})
