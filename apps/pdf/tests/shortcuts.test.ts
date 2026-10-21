/**
 * UNI-2011 S-pdf: the PDF renderer's keys come from the @genoffice/shortcuts pdf
 * table. Each chord fires its action per platform and surface, the old colliding
 * keys no longer do, an IME composition / AltGr never fires, hints per platform,
 * and the dialogs ignore an Enter / Esc that belongs to the IME.
 */
import { act, createElement, createRef, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { formatHint, type ShortcutPlatform, type ShortcutSurface } from '@genoffice/shortcuts'
import { useRibbonCollapse, type RibbonCollapse } from '@genoffice/ui'
import { navKeyAction } from '../src/renderer/keyNav'
import {
  isCancelKey,
  isConfirmKey,
  isContextKey,
  matchPdfKey,
  pdfHint,
  pdfPrevMatchTip,
  pdfRibbonCollapseOptions,
  pdfTip,
  resolvePdfWindowKey,
  searchEnterDirection,
} from '../src/renderer/shortcuts'
import { PasswordDialog } from '../src/renderer/PasswordDialog'
import { SignatureDialog } from '../src/renderer/SignatureDialog'
import { SignaturesDialog } from '../src/renderer/SignaturesDialog'
import { StampDialog } from '../src/renderer/StampDialog'
import { StaticTextDialog } from '../src/renderer/StaticTextDialog'
import type { TFunc } from '../src/renderer/i18n/locale'

type Init = KeyboardEventInit & { keyCode?: number }

function keydown(init: Init): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  return event
}

/** the row id a chord triggers on a platform and surface (null: no row) */
function fires(
  platform: ShortcutPlatform,
  init: Init,
  surface: ShortcutSurface = 'desktop',
  context?: string,
): string | null {
  return matchPdfKey(keydown(init), context, platform, surface)?.id ?? null
}

const win = (init: Init): Init => ({ ctrlKey: true, ...init })
const mac = (init: Init): Init => ({ metaKey: true, ...init })

describe('pdf table chords fire their action', () => {
  const cases: Array<[string, string, Init, Init]> = [
    ['pdf-01 Save', 'pdf-01', win({ key: 's', code: 'KeyS' }), mac({ key: 's', code: 'KeyS' })],
    [
      'pdf-02 Save As',
      'pdf-02',
      win({ key: 'S', code: 'KeyS', shiftKey: true }),
      mac({ key: 's', code: 'KeyS', shiftKey: true }),
    ],
    ['pdf-03 Undo', 'pdf-03', win({ key: 'z', code: 'KeyZ' }), mac({ key: 'z', code: 'KeyZ' })],
    [
      'pdf-04 Redo (Ctrl+Shift+Z / Shift+Cmd+Z)',
      'pdf-04',
      win({ key: 'Z', code: 'KeyZ', shiftKey: true }),
      mac({ key: 'z', code: 'KeyZ', shiftKey: true }),
    ],
    ['pdf-05 Find', 'pdf-05', win({ key: 'f', code: 'KeyF' }), mac({ key: 'f', code: 'KeyF' })],
    [
      'pdf-06 Find next',
      'pdf-06',
      win({ key: 'g', code: 'KeyG' }),
      mac({ key: 'g', code: 'KeyG' }),
    ],
    [
      'pdf-06 Find previous',
      'pdf-06',
      win({ key: 'G', code: 'KeyG', shiftKey: true }),
      mac({ key: 'g', code: 'KeyG', shiftKey: true }),
    ],
    ['pdf-07 Print', 'pdf-07', win({ key: 'p', code: 'KeyP' }), mac({ key: 'p', code: 'KeyP' })],
    [
      'pdf-08 Zoom in',
      'pdf-08',
      win({ key: '=', code: 'Equal' }),
      mac({ key: '=', code: 'Equal' }),
    ],
    [
      'pdf-09 Zoom out',
      'pdf-09',
      win({ key: '-', code: 'Minus' }),
      mac({ key: '-', code: 'Minus' }),
    ],
    [
      'pdf-10 Reset zoom',
      'pdf-10',
      win({ key: '0', code: 'Digit0' }),
      mac({ key: '0', code: 'Digit0' }),
    ],
    [
      'pdf-11 Fit toggle',
      'pdf-11',
      win({ key: '\\', code: 'Backslash' }),
      mac({ key: '\\', code: 'Backslash' }),
    ],
    [
      'pdf-12 Rotate counterclockwise',
      'pdf-12',
      win({ key: '[', code: 'BracketLeft' }),
      mac({ key: '[', code: 'BracketLeft' }),
    ],
    [
      'pdf-12 Rotate clockwise',
      'pdf-12',
      win({ key: ']', code: 'BracketRight' }),
      mac({ key: ']', code: 'BracketRight' }),
    ],
  ]

  for (const [name, id, winInit, macInit] of cases) {
    it(`${name} on Windows and macOS, desktop and web`, () => {
      for (const surface of ['desktop', 'web'] as const) {
        expect(fires('win', winInit, surface), `win ${surface}`).toBe(id)
        expect(fires('mac', macInit, surface), `mac ${surface}`).toBe(id)
      }
    })
  }

  it('pdf-04 Redo also answers to Ctrl+Y on Windows and Cmd+Y on the web (Mac)', () => {
    expect(fires('win', win({ key: 'y', code: 'KeyY' }))).toBe('pdf-04')
    expect(fires('mac', mac({ key: 'y', code: 'KeyY' }), 'web')).toBe('pdf-04')
    // Mac desktop prints Shift+Cmd+Z only: Cmd+Y stays free there
    expect(fires('mac', mac({ key: 'y', code: 'KeyY' }), 'desktop')).toBeNull()
  })

  it('pdf-06 Find next / previous also answer to F3 / Shift+F3', () => {
    for (const platform of ['win', 'mac'] as const) {
      expect(fires(platform, { key: 'F3', code: 'F3' })).toBe('pdf-06')
      expect(fires(platform, { key: 'F3', code: 'F3', shiftKey: true })).toBe('pdf-06')
    }
  })

  it('Ctrl+Enter is the margin-note submit and the text-edit commit, only in their own context', () => {
    const enter = win({ key: 'Enter', code: 'Enter' })
    expect(fires('win', enter, 'desktop', 'note')).toBe('pdf-21')
    expect(fires('win', enter, 'desktop', 'text-edit')).toBe('pdf-24')
    expect(fires('win', enter)).toBeNull()
    expect(fires('mac', mac({ key: 'Enter', code: 'Enter' }), 'desktop', 'note')).toBe('pdf-21')
    expect(fires('mac', mac({ key: 'Enter', code: 'Enter' }), 'web', 'text-edit')).toBe('pdf-24')
  })
})

describe('the old colliding keys no longer fire', () => {
  it('Ctrl+Shift+S is Save As, not Save', () => {
    expect(fires('win', win({ key: 'S', code: 'KeyS', shiftKey: true }))).toBe('pdf-02')
  })

  it('Ctrl+Shift+P (print with the system dialog) is not Print', () => {
    expect(fires('win', win({ key: 'P', code: 'KeyP', shiftKey: true }))).toBeNull()
  })

  it('a chord with an extra modifier is not the base chord', () => {
    expect(fires('win', win({ key: 'f', code: 'KeyF', shiftKey: true }))).toBeNull()
    expect(fires('win', win({ key: 'f', code: 'KeyF', altKey: true }))).toBeNull()
    expect(fires('mac', { metaKey: true, ctrlKey: true, key: 's', code: 'KeyS' })).toBeNull()
  })

  it('Ctrl+0 resets the zoom (pdf-10) instead of fitting the width; Ctrl+\\ toggles the fit', () => {
    expect(fires('win', win({ key: '0', code: 'Digit0' }))).toBe('pdf-10')
    expect(fires('win', win({ key: '\\', code: 'Backslash' }))).toBe('pdf-11')
  })
})

/** Windows layouts: `code → [unshifted, shifted]` for the keys the zoom and rotate chords use. */
const LAYOUTS: Record<string, Record<string, readonly [string, string]>> = {
  US: {
    Equal: ['=', '+'],
    Minus: ['-', '_'],
    BracketLeft: ['[', '{'],
    BracketRight: [']', '}'],
    Backslash: ['\\', '|'],
  },
  German: {
    Equal: ['´', '`'],
    Minus: ['ß', '?'],
    Slash: ['-', '_'],
    BracketLeft: ['ü', 'Ü'],
    BracketRight: ['+', '*'],
    Backslash: ['#', "'"],
  },
  Spanish: {
    Equal: ['¡', '¿'],
    Minus: ["'", '?'],
    Slash: ['-', '_'],
    BracketLeft: ['`', '^'],
    BracketRight: ['+', '*'],
    Backslash: ['ç', 'Ç'],
  },
  Italian: {
    Equal: ['ì', '^'],
    Minus: ["'", '?'],
    Slash: ['-', '_'],
    BracketLeft: ['è', 'é'],
    BracketRight: ['+', '*'],
    Backslash: ['ù', '§'],
  },
}

/** A Ctrl chord pressed on `layout`: the key a layout types at `code`, with or without Shift. */
function press(layout: string, code: string, shift = false): Init {
  const [plain, shifted] = LAYOUTS[layout]![code] ?? ['', '']
  return win({ key: shift ? shifted : plain, code, shiftKey: shift })
}

const NON_US = ['German', 'Spanish', 'Italian']

describe('zoom on US, German, Spanish and Italian layouts (the matcher compares the character)', () => {
  it('US: Ctrl+= and Ctrl+Shift+= zoom in, Ctrl+- zooms out, Ctrl+[ / Ctrl+] rotate, Ctrl+\\ fits', () => {
    expect(fires('win', press('US', 'Equal'))).toBe('pdf-08')
    expect(fires('win', press('US', 'Equal', true))).toBe('pdf-08')
    expect(fires('win', press('US', 'Minus'))).toBe('pdf-09')
    expect(fires('win', press('US', 'BracketLeft'))).toBe('pdf-12')
    expect(fires('win', press('US', 'BracketRight'))).toBe('pdf-12')
    expect(fires('win', press('US', 'Backslash'))).toBe('pdf-11')
  })

  it.each(NON_US)('%s: Ctrl + "+" zooms in and Ctrl + "-" zooms out; neither rotates', (layout) => {
    // "+" sits on the physical BracketRight key, "-" on the physical Slash key
    expect(fires('win', press(layout, 'BracketRight')), 'plus').toBe('pdf-08')
    expect(fires('win', press(layout, 'Slash')), 'minus').toBe('pdf-09')
    const plus = resolvePdfWindowKey(keydown(press(layout, 'BracketRight')), {
      inEditable: false,
      documentUndo: true,
      platform: 'win',
      surface: 'desktop',
    })
    expect(plus?.action.id).toBe('pdf-08')
    expect(plus?.rotate).toBeUndefined()
  })

  it('German: the "#" key (the US backslash position) is not the fit toggle, Ctrl + backslash is', () => {
    // by position only where a key types no ASCII character; "#" is ASCII
    expect(fires('win', press('German', 'Backslash'))).toBeNull()
    expect(fires('win', win({ key: '\\', code: 'Backslash' }))).toBe('pdf-11')
  })

  it.each(NON_US)('%s: the keys at the US [ / ] positions never rotate', (layout) => {
    for (const code of ['BracketLeft', 'BracketRight']) {
      const effect = resolvePdfWindowKey(keydown(press(layout, code)), {
        inEditable: false,
        documentUndo: true,
        platform: 'win',
        surface: 'desktop',
      })
      expect(effect?.rotate, `${layout} ${code}`).toBeUndefined()
    }
  })

  it('the keypad zooms: Ctrl+NumpadAdd / NumpadSubtract / Numpad0 on both platforms and surfaces', () => {
    for (const surface of ['desktop', 'web'] as const) {
      for (const [platform, modifier] of [
        ['win', { ctrlKey: true }],
        ['mac', { metaKey: true }],
      ] as const) {
        const f = (init: Init) => fires(platform, { ...modifier, ...init }, surface)
        expect(f({ key: '+', code: 'NumpadAdd' }), `${platform} ${surface} +`).toBe('pdf-08')
        expect(f({ key: '-', code: 'NumpadSubtract' }), `${platform} ${surface} -`).toBe('pdf-09')
        expect(f({ key: '0', code: 'Numpad0' }), `${platform} ${surface} 0`).toBe('pdf-10')
      }
    }
  })

  it('Ctrl+Shift+= and Shift+Cmd+= (the + key of a US layout) zoom in', () => {
    expect(fires('win', win({ key: '+', code: 'Equal', shiftKey: true }))).toBe('pdf-08')
    expect(fires('mac', mac({ key: '+', code: 'Equal', shiftKey: true }))).toBe('pdf-08')
  })

  it('a keypad key without Ctrl / Cmd, and Ctrl+Alt+keypad, are not zoom', () => {
    expect(fires('win', { key: '+', code: 'NumpadAdd' })).toBeNull()
    expect(fires('win', win({ key: '+', code: 'NumpadAdd', altKey: true }))).toBeNull()
  })
})

describe('bare keys are table rows in their own context', () => {
  const plain = (key: string, extra: Init = {}): Init => ({
    key,
    code: key === ' ' ? 'Space' : key,
    ...extra,
  })

  it('the window-level keymap (no context) does not see a bare key', () => {
    for (const key of ['Enter', 'Escape', ' ', 'PageDown', 'Home', 'ArrowLeft', 'Delete']) {
      expect(fires('win', plain(key))).toBeNull()
    }
  })

  it.each([
    ['page-box', 'Enter', 'pdf-13'],
    ['nav', ' ', 'pdf-14'],
    ['nav', 'PageDown', 'pdf-14'],
    ['nav', 'PageUp', 'pdf-14'],
    ['nav', 'Home', 'pdf-15'],
    ['nav', 'End', 'pdf-15'],
    ['nav', 'ArrowUp', 'pdf-15'],
    ['nav', 'ArrowDown', 'pdf-15'],
    ['nav', 'ArrowLeft', 'pdf-16'],
    ['nav', 'ArrowRight', 'pdf-16'],
    ['selection', 'Delete', 'pdf-22'],
    ['selection', 'Backspace', 'pdf-22'],
    ['overlay', 'Escape', 'pdf-23'],
    ['text-edit', 'Escape', 'pdf-24'],
    ['text-edit', 'Backspace', 'pdf-24'],
    ['note', 'Escape', 'pdf-21'],
    ['ask', 'Enter', 'pdf-25'],
    ['ask', 'Escape', 'pdf-25'],
    ['dialog', 'Enter', 'pdf-dialog-keys'],
    ['dialog', 'Escape', 'pdf-dialog-keys'],
  ])('%s: %s is %s on both platforms and surfaces', (context, key, id) => {
    for (const platform of ['win', 'mac'] as const) {
      for (const surface of ['desktop', 'web'] as const) {
        expect(fires(platform, plain(key), surface, context), `${platform} ${surface}`).toBe(id)
        expect(fires(platform, plain(key, { isComposing: true }), surface, context)).toBeNull()
        expect(fires(platform, plain(key, { keyCode: 229 }), surface, context)).toBeNull()
      }
    }
  })

  it('Shift+Space is the Space row; any other Shift, Ctrl, Alt or Cmd chord is not a bare key', () => {
    expect(fires('win', plain(' ', { shiftKey: true }), 'desktop', 'nav')).toBe('pdf-14')
    for (const extra of [
      { shiftKey: true },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
    ]) {
      expect(fires('win', plain('Enter', extra), 'desktop', 'dialog')).toBeNull()
      expect(fires('win', plain('ArrowLeft', extra), 'desktop', 'nav')).toBeNull()
    }
  })

  it('isContextKey also needs the key to be the asked one', () => {
    expect(isContextKey(keydown(plain('Enter')), 'dialog', 'Enter')).toBe(true)
    expect(isContextKey(keydown(plain('Enter')), 'dialog', 'Escape')).toBe(false)
    expect(isContextKey(keydown(plain('Enter')), 'nav', 'Enter')).toBe(false)
  })

  it('confirm and cancel read the context they are given', () => {
    expect(isConfirmKey(keydown(plain('Enter')), 'page-box')).toBe(true)
    expect(isConfirmKey(keydown(plain('Enter')), 'ask')).toBe(true)
    expect(isCancelKey(keydown(plain('Escape')), 'overlay')).toBe(true)
    expect(isCancelKey(keydown(plain('Escape')), 'page-box')).toBe(false)
    expect(isCancelKey(keydown(plain('Escape')), 'nav')).toBe(false)
  })
})

describe('the ribbon collapse key comes from common-10', () => {
  it('hands the shared collapse row to the hook, per platform and surface', () => {
    const options = pdfRibbonCollapseOptions('win', 'desktop')
    expect(options.action.id).toBe('common-10')
    expect(formatHint(options.action, 'win', 'desktop')).toBe('Ctrl+F1')
    expect(formatHint(options.action, 'mac', 'desktop')).toBe('⌥⌘R')
    // the common row keeps the desktop chord in a browser frame
    expect(formatHint(options.action, 'win', 'web')).toBe('Ctrl+F1')
    expect(pdfRibbonCollapseOptions('mac', 'web')).toMatchObject({
      surface: 'web',
      platform: 'mac',
    })
  })

  describe('in a mounted ribbon', () => {
    let root: Root | null = null
    let host: HTMLDivElement | null = null

    beforeAll(() => {
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    })

    afterEach(async () => {
      if (root) await act(async () => root?.unmount())
      host?.remove()
      root = null
      host = null
      try {
        localStorage.clear()
      } catch {
        /* no storage in this environment */
      }
    })

    function Probe(props: { surface: ShortcutSurface; sink: (state: RibbonCollapse) => void }) {
      const state = useRibbonCollapse(
        'pdf-test-ribbon',
        { collapse: 'Collapse the ribbon', expand: 'Expand the ribbon' },
        pdfRibbonCollapseOptions('win', props.surface),
      )
      useEffect(() => {
        props.sink(state)
      })
      return null
    }

    async function mountProbe(surface: ShortcutSurface): Promise<() => RibbonCollapse> {
      let latest: RibbonCollapse | null = null
      host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
      await act(async () => {
        root!.render(createElement(Probe, { surface, sink: (s) => (latest = s) }))
        await Promise.resolve()
      })
      return () => latest!
    }

    it('desktop: shows Ctrl+F1 in the tip, and Ctrl+F1 collapses the band', async () => {
      const state = await mountProbe('desktop')
      expect(state().shortcutLabel).toBe('Ctrl+F1')
      expect(state().tabTip(true)).toBe('Collapse the ribbon (Ctrl+F1)')
      await act(async () => {
        window.dispatchEvent(keydown({ key: 'F1', code: 'F1', ctrlKey: true }))
      })
      expect(state().collapsed).toBe(true)
      // an IME composition does not toggle it back
      await act(async () => {
        window.dispatchEvent(keydown({ key: 'F1', code: 'F1', ctrlKey: true, isComposing: true }))
      })
      expect(state().collapsed).toBe(true)
    })

    it('web frame: the same key and tip as the desktop (common-10 keeps the chord there)', async () => {
      const state = await mountProbe('web')
      expect(state().shortcutLabel).toBe('Ctrl+F1')
      expect(state().tabTip(true)).toBe('Collapse the ribbon (Ctrl+F1)')
      await act(async () => {
        window.dispatchEvent(keydown({ key: 'F1', code: 'F1', ctrlKey: true }))
      })
      expect(state().collapsed).toBe(true)
    })
  })
})

describe('IME composition and AltGr never fire', () => {
  it('ignores isComposing and keyCode 229 on every table chord', () => {
    const chords: Init[] = [
      win({ key: 's', code: 'KeyS' }),
      win({ key: 'f', code: 'KeyF' }),
      win({ key: 'z', code: 'KeyZ' }),
      win({ key: '=', code: 'Equal' }),
      win({ key: '\\', code: 'Backslash' }),
      { key: 'F3', code: 'F3' },
    ]
    for (const chord of chords) {
      expect(fires('win', chord), JSON.stringify(chord)).not.toBeNull()
      expect(fires('win', { ...chord, isComposing: true }), 'isComposing').toBeNull()
      expect(fires('win', { ...chord, keyCode: 229 }), '229').toBeNull()
    }
    expect(
      fires(
        'win',
        { ...win({ key: 'Enter', code: 'Enter' }), isComposing: true },
        'desktop',
        'note',
      ),
    ).toBeNull()
  })

  it('does not take AltGr+S (Ctrl+Alt on Windows) for Save', () => {
    const altGr = keydown({ key: 'ś', code: 'KeyS', ctrlKey: true, altKey: true })
    Object.defineProperty(altGr, 'getModifierState', { value: (k: string) => k === 'AltGraph' })
    expect(matchPdfKey(altGr, undefined, 'win', 'desktop')).toBeNull()
    expect(fires('win', { key: 's', code: 'KeyS', ctrlKey: true, altKey: true })).toBeNull()
  })

  it('a Dvorak or Cyrillic layout still reaches Ctrl+S / Ctrl+F by the physical key', () => {
    expect(fires('win', win({ key: 'ы', code: 'KeyS' }))).toBe('pdf-01')
    expect(fires('win', win({ key: 'а', code: 'KeyF' }))).toBe('pdf-05')
  })
})

describe('the window handler decision (resolvePdfWindowKey)', () => {
  const resolve = (
    platform: ShortcutPlatform,
    init: Init,
    opts: { inEditable?: boolean; nativeUndo?: boolean } = {},
  ) =>
    resolvePdfWindowKey(keydown(init), {
      inEditable: opts.inEditable ?? false,
      documentUndo: !opts.nativeUndo,
      platform,
      surface: 'desktop',
    })

  it('Ctrl+Shift+S is Save As: not Save, and the key is left to the shell menu', () => {
    const effect = resolve('win', win({ key: 'S', code: 'KeyS', shiftKey: true }))
    expect(effect?.action.id).toBe('pdf-02')
    expect(effect?.preventDefault).toBe(false)
    expect(resolve('win', win({ key: 's', code: 'KeyS' }))?.preventDefault).toBe(true)
  })

  it('Ctrl+0 resets the zoom and does not fit the width', () => {
    expect(resolve('win', win({ key: '0', code: 'Digit0' }))?.action.id).toBe('pdf-10')
  })

  it('a US layout rotates on Ctrl+[ / Ctrl+], counterclockwise / clockwise', () => {
    expect(resolve('win', win({ key: '[', code: 'BracketLeft' }))?.rotate).toBe(-90)
    expect(resolve('win', win({ key: ']', code: 'BracketRight' }))?.rotate).toBe(90)
    expect(resolve('mac', mac({ key: ']', code: 'BracketRight' }))?.rotate).toBe(90)
  })

  it('German layout: Ctrl + "+" zooms in (the matcher compares the character), it does not rotate', () => {
    // "+" sits on the physical BracketRight key of a German layout
    expect(fires('win', win({ key: '+', code: 'BracketRight' }))).toBe('pdf-08')
    expect(resolve('win', win({ key: '+', code: 'BracketRight' }))?.action.id).toBe('pdf-08')
    expect(resolve('win', win({ key: '+', code: 'BracketRight' }))?.rotate).toBeUndefined()
  })

  it('German layout: Ctrl + "ü" (no ASCII character, so by position) never rotates', () => {
    expect(fires('win', win({ key: 'ü', code: 'BracketLeft' }))).toBe('pdf-12')
    expect(resolve('win', win({ key: 'ü', code: 'BracketLeft' }))).toBeNull()
    expect(resolve('win', win({ key: 'ö', code: 'Semicolon' }))).toBeNull()
  })

  it('fit toggle and rotate never run inside a text field', () => {
    const inField = { inEditable: true }
    expect(resolve('win', win({ key: '\\', code: 'Backslash' }), inField)).toBeNull()
    expect(resolve('win', win({ key: ']', code: 'BracketRight' }), inField)).toBeNull()
    expect(resolve('win', win({ key: '[', code: 'BracketLeft' }), inField)).toBeNull()
    // save, find and Find next / F3 in the search box still work in a field
    expect(resolve('win', win({ key: 's', code: 'KeyS' }), inField)?.action.id).toBe('pdf-01')
    expect(resolve('win', { key: 'F3', code: 'F3' }, inField)?.action.id).toBe('pdf-06')
  })

  it('a text field keeps its own undo and redo', () => {
    const native = { inEditable: true, nativeUndo: true }
    expect(resolve('win', win({ key: 'z', code: 'KeyZ' }), native)).toBeNull()
    expect(resolve('win', win({ key: 'y', code: 'KeyY' }), native)).toBeNull()
    expect(resolve('win', win({ key: 'z', code: 'KeyZ' }))?.action.id).toBe('pdf-03')
  })

  it('an IME composition resolves to nothing', () => {
    expect(resolve('win', win({ key: 's', code: 'KeyS', isComposing: true }))).toBeNull()
  })
})

describe('hints come from the table', () => {
  it('prints the primary chord per platform and surface', () => {
    expect(pdfHint('pdf-01', 'win', 'desktop')).toBe('Ctrl+S')
    expect(pdfHint('pdf-01', 'mac', 'desktop')).toBe('⌘S')
    expect(pdfHint('pdf-04', 'win', 'desktop')).toBe('Ctrl+Y')
    expect(pdfHint('pdf-04', 'mac', 'desktop')).toBe('⇧⌘Z')
    expect(pdfHint('pdf-04', 'mac', 'web')).toBe('⌘Y')
    expect(pdfHint('pdf-05', 'win', 'web')).toBe('Ctrl+F')
    expect(pdfHint('pdf-07', 'mac', 'web')).toBe('⌘P')
    expect(pdfHint('pdf-11', 'win', 'desktop')).toBe('Ctrl+\\')
  })

  it('the zoom and fit tooltips show the key where the table prints one', () => {
    expect(pdfTip('Zoom out', 'pdf-09', 'win', 'web')).toBe('Zoom out (Ctrl+-)')
    expect(pdfTip('Fit page', 'pdf-11', 'win', 'desktop')).toBe('Fit page (Ctrl+\\)')
    expect(pdfTip('Fit page', 'pdf-11', 'mac', 'desktop')).toBe('Fit page (⌘\\)')
    expect(pdfTip('Next match', 'pdf-06', 'win', 'desktop')).toMatch(/^Next match \(Ctrl\+/)
  })

  it('Previous match shows the Shift chord, Next keeps the plain one', () => {
    expect(pdfPrevMatchTip('Previous', 'win', 'desktop')).toBe('Previous (Ctrl+Shift+G)')
    expect(pdfPrevMatchTip('Previous', 'win', 'web')).toBe('Previous (Ctrl+Shift+G)')
    expect(pdfPrevMatchTip('Previous', 'mac', 'desktop')).toBe('Previous (⇧⌘G)')
    expect(pdfTip('Next', 'pdf-06', 'win', 'desktop')).toBe('Next (Ctrl+G)')
    expect(pdfTip('Next', 'pdf-06', 'mac', 'desktop')).toBe('Next (⌘G)')
  })

  it('appends the key to a tooltip label', () => {
    expect(pdfTip('Redo', 'pdf-04', 'win', 'desktop')).toBe('Redo (Ctrl+Y)')
    expect(pdfTip('Save', 'pdf-01', 'mac', 'desktop')).toBe('Save (⌘S)')
  })

  it('fails loudly for a row that is not in the table', () => {
    expect(() => pdfHint('pdf-99')).toThrow()
  })
})

describe('plain keys: Enter, Esc, navigation', () => {
  it('Enter confirms and Esc cancels only when plain and not composing', () => {
    expect(isConfirmKey(keydown({ key: 'Enter' }))).toBe(true)
    expect(isCancelKey(keydown({ key: 'Escape' }))).toBe(true)
    expect(isConfirmKey(keydown({ key: 'Enter', isComposing: true }))).toBe(false)
    expect(isConfirmKey(keydown({ key: 'Enter', keyCode: 229 }))).toBe(false)
    expect(isCancelKey(keydown({ key: 'Escape', isComposing: true }))).toBe(false)
    expect(isConfirmKey(keydown({ key: 'Enter', ctrlKey: true }))).toBe(false)
    expect(isCancelKey(keydown({ key: 'Escape', shiftKey: true }))).toBe(false)
  })

  it('a React event is read through its native event', () => {
    expect(isConfirmKey({ nativeEvent: keydown({ key: 'Enter', isComposing: true }) })).toBe(false)
    expect(isConfirmKey({ nativeEvent: keydown({ key: 'Enter' }) })).toBe(true)
  })

  it('the search box: Enter next, Shift+Enter previous, IME Enter nothing', () => {
    expect(searchEnterDirection(keydown({ key: 'Enter' }))).toBe(1)
    expect(searchEnterDirection(keydown({ key: 'Enter', shiftKey: true }))).toBe(-1)
    expect(searchEnterDirection(keydown({ key: 'Enter', isComposing: true }))).toBeNull()
    expect(searchEnterDirection(keydown({ key: 'Enter', ctrlKey: true }))).toBeNull()
    expect(searchEnterDirection(keydown({ key: 'a' }))).toBeNull()
  })

  it('Space / Shift+Space / PageUp / PageDown / Home / End / arrows navigate; chords and IME do not', () => {
    expect(navKeyAction(keydown({ key: ' ' }), false)).toEqual({ type: 'scrollViewport', dir: 1 })
    expect(navKeyAction(keydown({ key: ' ', shiftKey: true }), false)).toEqual({
      type: 'scrollViewport',
      dir: -1,
    })
    expect(navKeyAction(keydown({ key: 'PageUp' }), false)).toEqual({
      type: 'scrollViewport',
      dir: -1,
    })
    expect(navKeyAction(keydown({ key: 'Home' }), false)).toEqual({
      type: 'scrollEdge',
      edge: 'top',
    })
    expect(navKeyAction(keydown({ key: 'ArrowDown' }), true)).toEqual({ type: 'stepPage', dir: 1 })
    // Alt+Left is history back, Ctrl+End belongs to the text field, Shift+Right extends a selection
    expect(navKeyAction(keydown({ key: 'ArrowLeft', altKey: true }), false)).toBeNull()
    expect(navKeyAction(keydown({ key: 'End', ctrlKey: true }), false)).toBeNull()
    expect(navKeyAction(keydown({ key: 'ArrowRight', shiftKey: true }), false)).toBeNull()
    expect(navKeyAction(keydown({ key: ' ', isComposing: true }), false)).toBeNull()
    expect(navKeyAction(keydown({ key: 'PageDown', keyCode: 229 }), false)).toBeNull()
  })
})

describe('dialogs ignore the IME Enter / Esc', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  const t = ((key: string) => key) as unknown as TFunc

  beforeAll(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    ;(window as unknown as { pdfApi: unknown }).pdfApi = {
      listSavedSignatures: () => Promise.resolve([]),
    }
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  async function mount(element: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(element)
      await Promise.resolve()
    })
    return container
  }

  it('the password dialog submits on a plain Enter, not on the Enter that commits a composition', async () => {
    const onSubmit = vi.fn()
    const host = await mount(
      createElement(PasswordDialog, {
        fileName: 'a.pdf',
        value: 'secret',
        wrong: false,
        onChange: () => {},
        onSubmit,
        onCancel: () => {},
      }),
    )
    const input = host.querySelector('input')!
    await act(async () => {
      input.dispatchEvent(keydown({ key: 'Enter', isComposing: true }))
      input.dispatchEvent(keydown({ key: 'Enter', keyCode: 229 }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => {
      input.dispatchEvent(keydown({ key: 'Enter' }))
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('a modal dialog closes on a plain Escape, not on the Escape that cancels a composition', async () => {
    const onCancel = vi.fn()
    await mount(createElement(StampDialog, { t, onCancel, onApply: () => {} }))
    await act(async () => {
      window.dispatchEvent(keydown({ key: 'Escape', isComposing: true }))
      window.dispatchEvent(keydown({ key: 'Escape', keyCode: 229 }))
    })
    expect(onCancel).not.toHaveBeenCalled()
    await act(async () => {
      window.dispatchEvent(keydown({ key: 'Escape' }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // every dialog on the shared useModalDialog helper drops an IME Escape
  const modalDialogs: Array<[string, (onClose: () => void) => ReturnType<typeof createElement>]> = [
    [
      'SignatureDialog',
      (onCancel) =>
        createElement(SignatureDialog, { color: [0, 0, 0], t, onCancel, onConfirm: () => {} }),
    ],
    [
      'SignaturesDialog',
      (onClose) =>
        createElement(SignaturesDialog, { t, signatures: [], onClose, onGoToPage: () => {} }),
    ],
    [
      'StaticTextDialog',
      (onCancel) =>
        createElement(StaticTextDialog, {
          t,
          titleKey: 'sigPanelTitle',
          text: '',
          size: 12,
          color: '#000000',
          colorOpen: false,
          align: 'left',
          colorFieldRef: createRef<HTMLDivElement>(),
          onText: () => {},
          onSize: () => {},
          onColor: () => {},
          onColorOpen: () => {},
          onAlign: () => {},
          onCancel,
          onConfirm: () => {},
        }),
    ],
  ]

  it.each(modalDialogs)(
    '%s ignores the Escape of a composition and closes on a plain one',
    async (_name, build) => {
      const onClose = vi.fn()
      await mount(build(onClose))
      await act(async () => {
        window.dispatchEvent(keydown({ key: 'Escape', isComposing: true }))
        window.dispatchEvent(keydown({ key: 'Escape', keyCode: 229 }))
      })
      expect(onClose).not.toHaveBeenCalled()
      await act(async () => {
        window.dispatchEvent(keydown({ key: 'Escape' }))
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    },
  )
})
