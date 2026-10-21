/**
 * The shortcut registry is what the Keyboard Shortcuts sheet renders and what
 * App's handler, the editor keymap and the menu read, so it has to stay
 * honest: every command points at a real docs table row, no chord is listed
 * twice on a platform and surface, every row is translatable, and every menu
 * accelerator is a table row the sheet lists.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findShortcut, type ShortcutPlatform, type ShortcutSurface } from '@genoffice/shortcuts'
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  shortcutChords,
  shortcutKeys,
  visibleShortcuts,
} from '../src/renderer/shortcuts'
import { DOCS_MENU_SHORTCUTS } from '../src/shared/docs-shortcuts'
import { strings } from '../src/renderer/i18n/strings'

const CASES: [ShortcutPlatform, ShortcutSurface][] = [
  ['win', 'desktop'],
  ['mac', 'desktop'],
  ['win', 'web'],
  ['mac', 'web'],
]

describe('shortcut registry', () => {
  it('has unique ids and known groups', () => {
    const ids = SHORTCUTS.map((def) => def.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = new Set(SHORTCUT_GROUPS.map((group) => group.id))
    for (const def of SHORTCUTS) expect(groups.has(def.group)).toBe(true)
  })

  it('points every command at one docs table row, or at editor-native keys', () => {
    for (const def of SHORTCUTS) {
      expect(!!def.action !== !!def.native, def.id).toBe(true)
      if (def.action) expect(findShortcut('docs', def.action), def.id).toBeDefined()
    }
    const actions = SHORTCUTS.flatMap((def) => (def.action ? [def.action] : []))
    expect(new Set(actions).size).toBe(actions.length)
  })

  it.each(CASES)('binds every chord once on %s %s', (platform, surface) => {
    const seen = new Map<string, string>()
    for (const def of SHORTCUTS) {
      for (const chord of shortcutChords(def, platform, surface)) {
        expect(seen.get(chord), `${chord} is claimed by ${seen.get(chord)} and ${def.id}`).toBe(
          undefined,
        )
        seen.set(chord, def.id)
      }
    }
  })

  it('labels every row in every language', () => {
    for (const [lang, dict] of Object.entries(strings)) {
      for (const entry of [...SHORTCUTS, ...SHORTCUT_GROUPS]) {
        const value = (dict as Record<string, string>)[entry.labelKey]
        expect(value, `${entry.labelKey} missing in ${lang}`).toBeTruthy()
      }
    }
  })

  it('formats the keys per platform', () => {
    const byId = new Map(SHORTCUTS.map((def) => [def.id, def]))
    const keys = (id: string, platform: ShortcutPlatform, surface: ShortcutSurface = 'desktop') =>
      shortcutKeys(byId.get(id)!, platform, surface)
    expect(keys('save-as', 'win')).toBe('F12')
    expect(keys('save-as', 'mac')).toBe('⇧⌘S')
    expect(keys('redo', 'win')).toBe('Ctrl+Y / Ctrl+Shift+Z')
    expect(keys('redo', 'mac')).toBe('⌘Y / ⇧⌘Z')
    expect(keys('page-break', 'win')).toBe('Ctrl+Enter')
    expect(keys('style-h1', 'win')).toBe('Ctrl+Alt+1')
    expect(keys('comment', 'win')).toBe('Ctrl+Alt+M')
    expect(keys('comment', 'mac')).toBe('⌥⌘A')
    expect(keys('endnote', 'win')).toBe('Ctrl+Alt+D')
    expect(keys('endnote', 'mac')).toBe('⌥⌘E')
    expect(keys('bullets', 'win')).toBe('Ctrl+Shift+L')
    expect(keys('bullets', 'win', 'web')).toBe('Ctrl+.')
    expect(keys('numbering', 'win', 'web')).toBe('Ctrl+/')
    expect(keys('shortcuts', 'mac')).toBe('⌘/')
  })

  it('leaves commands without a key on this surface out of the sheet', () => {
    const web = new Set(visibleShortcuts('win', 'web').map((def) => def.id))
    // the browser keeps Ctrl+N / Ctrl+W, and F1 is the browser's help on the web
    for (const id of ['new', 'close', 'shortcuts', 'hanging-indent'])
      expect(web.has(id)).toBe(false)
    expect(web.has('ribbon-toggle')).toBe(true)
    const desktop = new Set(visibleShortcuts('win', 'desktop').map((def) => def.id))
    for (const id of ['new', 'close', 'shortcuts', 'hanging-indent'])
      expect(desktop.has(id)).toBe(true)
    // Word for Windows prints no strikethrough key
    expect(desktop.has('strike')).toBe(false)
    expect(visibleShortcuts('mac', 'desktop').some((def) => def.id === 'strike')).toBe(true)
  })

  it('leaves the zoom keys out of the web sheet: the browser zooms the page', () => {
    const web = new Set(visibleShortcuts('win', 'web').map((def) => def.id))
    for (const id of ['zoom-in', 'zoom-out', 'zoom-100']) expect(web.has(id), id).toBe(false)
    const desktop = new Set(visibleShortcuts('win', 'desktop').map((def) => def.id))
    for (const id of ['zoom-in', 'zoom-out', 'zoom-100']) expect(desktop.has(id), id).toBe(true)
  })

  it('writes no file-menu key hint by hand', () => {
    for (const file of ['components/Ribbon.tsx', 'App.tsx']) {
      const source = readFileSync(join(__dirname, '../src/renderer', file), 'utf8')
      const hand = source.match(/file-menu-key">[^{<]*[A-Za-z⌘⇧⌥][^<]*</g) ?? []
      expect(hand, file).toEqual([])
    }
  })

  it('lists every menu accelerator', () => {
    const listed = new Set(SHORTCUTS.map((def) => def.action))
    for (const [item, id] of Object.entries(DOCS_MENU_SHORTCUTS))
      expect(listed.has(id), `${item} (${id}) is not in the shortcut sheet`).toBe(true)
  })

  it('writes no menu accelerator by hand', () => {
    const source = readFileSync(join(__dirname, '../src/main/docs-main.ts'), 'utf8')
    expect(source.match(/accelerator: ['"`]/g) ?? []).toEqual([])
    expect(source.match(/accelerator: acc\(/g)?.length).toBeGreaterThan(15)
  })
})
