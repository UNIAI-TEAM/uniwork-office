/**
 * UNI-2060: the chord leaves the accessible name and goes into
 * `aria-keyshortcuts`, written from the same table row as the hint.
 */
import { describe, expect, it } from 'vitest'
import {
  accessibleShortcutProblems,
  ariaKeyshortcuts,
  chordsFor,
  containsDisplayChord,
  findDisplayChord,
  formatAriaChord,
  formatAriaChords,
  formatChord,
  formatHint,
  keyHintAfterName,
  SHORTCUT_TABLES,
  type ShortcutAction,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '../src/index'

function action(partial: Partial<ShortcutAction> & { id: string }): ShortcutAction {
  return { scope: 'docs', win: [], mac: [], match: 'key', guard: {}, ...partial }
}

const PLATFORMS: readonly ShortcutPlatform[] = ['win', 'mac']
const SURFACES: readonly ShortcutSurface[] = ['desktop', 'web']

describe('formatAriaChord', () => {
  it('writes Control on win and Meta for Command on mac', () => {
    expect(formatAriaChord('Ctrl+E', 'win')).toBe('Control+E')
    expect(formatAriaChord('Cmd+E', 'mac')).toBe('Meta+E')
    expect(formatAriaChord('Ctrl+Shift+S', 'win')).toBe('Control+Shift+S')
    expect(formatAriaChord('Shift+Cmd+S', 'mac')).toBe('Shift+Meta+S')
    expect(formatAriaChord('Alt+Cmd+R', 'mac')).toBe('Alt+Meta+R')
    expect(formatAriaChord('Ctrl+H', 'mac')).toBe('Control+H')
  })

  it('uses UI Events key values for named keys', () => {
    expect(formatAriaChord('F12', 'win')).toBe('F12')
    expect(formatAriaChord('Ctrl+F1', 'win')).toBe('Control+F1')
    expect(formatAriaChord('Alt+Shift+Up', 'win')).toBe('Alt+Shift+ArrowUp')
    expect(formatAriaChord('Alt+Left', 'win')).toBe('Alt+ArrowLeft')
    expect(formatAriaChord('Escape', 'mac')).toBe('Escape')
    expect(formatAriaChord('Shift+Tab', 'win')).toBe('Shift+Tab')
    expect(formatAriaChord('Ctrl+Space', 'win')).toBe('Control+Space')
    expect(formatAriaChord('Ctrl+Enter', 'win')).toBe('Control+Enter')
  })

  it('writes punctuation as its character, the Shift character on a Shift chord, + as Plus', () => {
    expect(formatAriaChord('Ctrl+Period', 'win')).toBe('Control+.')
    expect(formatAriaChord('Ctrl+Shift+Period', 'win')).toBe('Control+Shift+>')
    expect(formatAriaChord('Cmd+Slash', 'mac')).toBe('Meta+/')
    expect(formatAriaChord('Ctrl+Equal', 'win')).toBe('Control+=')
    expect(formatAriaChord('Ctrl+Shift+Equal', 'win')).toBe('Control+Shift+Plus')
    expect(formatAriaChord('Ctrl+NumpadAdd', 'win')).toBe('Control+Plus')
    expect(formatAriaChord('Ctrl+NumpadSubtract', 'win')).toBe('Control+-')
  })

  it('is empty for an invalid chord or Cmd on win', () => {
    expect(formatAriaChord('Cmd+E', 'win')).toBe('')
    expect(formatAriaChord('Shift+Ctrl+E', 'win')).toBe('')
    expect(formatAriaChord('', 'win')).toBe('')
  })

  it('joins several chords with spaces, primary first, without duplicates', () => {
    expect(formatAriaChords(['Ctrl+Y', 'F4', 'Ctrl+Y'], 'win')).toBe('Control+Y F4')
    expect(formatAriaChords([], 'mac')).toBe('')
  })
})

describe('ariaKeyshortcuts', () => {
  const saveAs = action({ id: 'save-as', win: ['F12'], mac: ['Shift+Cmd+S'] })
  const close = action({
    id: 'close',
    win: ['Ctrl+W'],
    mac: ['Cmd+W'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Alt+Shift+W' },
  })
  const redo = action({ id: 'redo', win: ['Ctrl+Y', 'F4'], mac: ['Cmd+Y'] })

  it('formats every chord of the platform and surface', () => {
    expect(ariaKeyshortcuts(saveAs, 'win', 'desktop')).toBe('F12')
    expect(ariaKeyshortcuts(saveAs, 'mac', 'desktop')).toBe('Shift+Meta+S')
    expect(ariaKeyshortcuts(redo, 'win', 'desktop')).toBe('Control+Y F4')
  })

  it('on web uses the webAlt chord the hint shows, and nothing where the surface has no key', () => {
    expect(formatHint(close, 'win', 'web')).toBe('Alt+Shift+W')
    expect(ariaKeyshortcuts(close, 'win', 'web')).toBe('Alt+Shift+W')
    expect(ariaKeyshortcuts(close, 'mac', 'web')).toBe('')
    expect(ariaKeyshortcuts(close, 'win', 'desktop')).toBe('Control+W')
  })

  it('names the hint chord first for every row of every table', () => {
    for (const table of Object.values(SHORTCUT_TABLES)) {
      for (const row of table) {
        for (const platform of PLATFORMS) {
          for (const surface of SURFACES) {
            const hint = formatHint(row, platform, surface)
            const aria = ariaKeyshortcuts(row, platform, surface)
            const first = chordsFor(row, platform, surface)[0]
            expect(aria === '', `${row.id} ${platform} ${surface}`).toBe(hint === '')
            expect(aria.split(' ')[0], `${row.id} ${platform} ${surface}`).toBe(
              first ? formatAriaChord(first, platform) : '',
            )
          }
        }
      }
    }
  })
})

describe('findDisplayChord', () => {
  it('finds a chord in the notation formatChord writes, on both platforms', () => {
    for (const table of Object.values(SHORTCUT_TABLES)) {
      for (const row of table) {
        for (const platform of PLATFORMS) {
          for (const chord of row[platform]) {
            // a bare letter or named key (slide-show B, PDF Space) is only a chord in a hint's parentheses
            if (!chord.includes('+') && !/^F\d/.test(chord)) continue
            const text = `Command (${formatChord(chord, platform)})`
            expect(findDisplayChord(text), `${row.id} ${platform} ${chord}`).not.toBeNull()
          }
        }
      }
    }
  })

  it('finds hand-written and ARIA-notation chords', () => {
    expect(findDisplayChord('Source (Ctrl+E)')).toBe('Ctrl+E')
    expect(findDisplayChord('Bullets (Ctrl+.)')).toBe('Ctrl+.')
    expect(findDisplayChord('Collapse the ribbon (⌥⌘R)')).toBe('⌥')
    expect(findDisplayChord('Save As (F12)')).toBe('(F12)')
    expect(findDisplayChord('Find next (⇧F4)')).toBe('⇧F')
    expect(findDisplayChord('Close (Esc)')).toBe('(Esc)')
    expect(findDisplayChord('Undo Control+Z')).toBe('Control+Z')
    expect(findDisplayChord('Mở (Ctrl+O)')).toBe('Ctrl+O')
  })

  it('finds the localized key names the translated strings really use', () => {
    // each string below is a real translation in the locale shards
    for (const name of [
      'Fermer (Échap)',
      'Quitter la présentation (Échap)',
      'Suivant (Entrée)',
      'Précédent (Maj+Entrée)',
      'Siguiente (Entrar)',
      'Anterior (Mayús+Entrar)',
      'Weiter (Eingabetaste)',
      'Zurück (Umschalt+Eingabetaste)',
      'Successivo (Invio)',
      'Precedente (Maiusc+Invio)',
      'Öffnen Strg+O',
      'Strg+Klicken',
      'Maj+clic pour étendre la plage',
      'Mayús+clic para ampliar el intervalo',
      'Umschalt+Klick erweitert den Bereich',
      'Maiusc+clic',
      'Supprimer (Suppr)',
      'Löschen (Entf)',
    ]) {
      expect(findDisplayChord(name), name).not.toBeNull()
      expect(containsDisplayChord(name), name).toBe(true)
    }
    expect(findDisplayChord('Fermer (Échap)')).toBe('(Échap)')
    expect(findDisplayChord('Précédent (Maj+Entrée)')).toBe('Maj+E')
  })

  it('leaves localized words that are not key names alone', () => {
    for (const name of [
      'Zoom (Beenden)',
      'Zanikanie (wyjście)',
      'Entrar na conta',
      'Maj de la page',
      'Invio di una email',
      'Mayúsculas',
      'Umschalten',
      'Eingabetaste ändern',
      'Entrée en matière',
      'Échapper les caractères',
    ]) {
      expect(findDisplayChord(name), name).toBeNull()
    }
  })

  it('leaves plain command names alone', () => {
    for (const name of [
      'Source',
      'Save As',
      'Shift cells down',
      'Insert Function F(x)',
      'Alt text',
      'Ctrl key options',
      'Page 1 of 12',
      'Heading 1',
      'Zoom 100%',
      'C++ code',
      'Bold, Italic + Underline',
      '保存',
      'Tiêu đề 1',
    ]) {
      expect(findDisplayChord(name), name).toBeNull()
      expect(containsDisplayChord(name), name).toBe(false)
    }
  })
})

describe('accessibleShortcutProblems', () => {
  const source = action({ id: 'md-source', win: ['Ctrl+E'], mac: ['Cmd+E'] })

  it('accepts a plain name with the platform ARIA chord', () => {
    expect(
      accessibleShortcutProblems(
        { name: 'Source', keyshortcuts: 'Control+E' },
        source,
        'win',
        'desktop',
      ),
    ).toEqual([])
    expect(
      accessibleShortcutProblems({ name: 'Source', keyshortcuts: 'Meta+E' }, source, 'mac', 'web'),
    ).toEqual([])
  })

  it('reports a chord in the name and a missing or wrong aria-keyshortcuts', () => {
    expect(
      accessibleShortcutProblems(
        { name: 'Source (Ctrl+E)', keyshortcuts: null },
        source,
        'win',
        'desktop',
      ),
    ).toHaveLength(2)
    expect(
      accessibleShortcutProblems(
        { name: 'Source', keyshortcuts: 'Control+E' },
        source,
        'mac',
        'desktop',
      ),
    ).toEqual(['md-source: aria-keyshortcuts is "Control+E", want "Meta+E" (mac, desktop)'])
  })
})

describe('keyHintAfterName', () => {
  it('returns the hint a label carries after its plain name', () => {
    expect(keyHintAfterName('Exit Read Mode (Esc)', 'Exit Read Mode')).toBe('(Esc)')
    expect(keyHintAfterName('Quitter le mode Lecture (Échap)', 'Quitter le mode Lecture')).toBe(
      '(Échap)',
    )
    expect(keyHintAfterName('退出演示（Esc）', '退出演示')).toBe('（Esc）')
  })

  it('is empty when the label is the name, or does not start with it', () => {
    expect(keyHintAfterName('Exit', 'Exit')).toBe('')
    expect(keyHintAfterName('Leave (Esc)', 'Exit')).toBe('')
  })
})
