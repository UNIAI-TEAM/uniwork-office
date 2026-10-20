import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SHORTCUT_TABLES, findShortcut, type ShortcutPlatform } from '@genoffice/shortcuts'

import {
  devToolsAccelerator,
  editMenuAccelerators,
  fileMenuAccelerators,
  fullScreenAccelerator,
  interfaceScaleAccelerators,
  matchShellKey,
  menuAccelerator,
  shortcutPlatform,
  type ShellKeyContext,
  type ShellKeyInput,
} from '../src/main/shell-shortcuts'

const WIN: ShortcutPlatform = 'win'
const MAC: ShortcutPlatform = 'mac'

function input(over: Partial<ShellKeyInput> = {}): ShellKeyInput {
  return {
    type: 'keyDown',
    key: 'w',
    code: 'KeyW',
    control: false,
    alt: false,
    shift: false,
    meta: false,
    ...over,
  }
}

function ctx(over: Partial<ShellKeyContext> = {}): ShellKeyContext {
  return { platform: WIN, devTools: true, activeKind: 'pdf', ...over }
}

describe('shortcutPlatform', () => {
  it('maps macOS to mac and everything else to win', () => {
    expect(shortcutPlatform('darwin')).toBe('mac')
    expect(shortcutPlatform('win32')).toBe('win')
    expect(shortcutPlatform('linux')).toBe('win')
  })
})

describe('shell menu accelerators come from the tables', () => {
  it('Home: New, Open and Close', () => {
    expect(fileMenuAccelerators('home', WIN)).toEqual({
      new: 'CmdOrCtrl+N',
      open: 'CmdOrCtrl+O',
      close: 'CmdOrCtrl+W',
    })
    expect(fileMenuAccelerators('home', MAC)).toEqual(fileMenuAccelerators('home', WIN))
  })

  it('PDF keeps Ctrl+Shift+S for Save As (the table row decides, F12 stays with Docs)', () => {
    expect(fileMenuAccelerators('pdf', WIN)).toEqual({
      new: 'CmdOrCtrl+N',
      open: 'CmdOrCtrl+O',
      save: 'CmdOrCtrl+S',
      saveAs: 'CmdOrCtrl+Shift+S',
      print: 'CmdOrCtrl+P',
      close: 'CmdOrCtrl+W',
    })
  })

  it.each(['markdown', 'html'] as const)(
    '%s: Save As is F12 on Windows, Shift+Cmd+S on Mac',
    (kind) => {
      expect(fileMenuAccelerators(kind, WIN)).toMatchObject({
        open: 'CmdOrCtrl+O',
        save: 'CmdOrCtrl+S',
        saveAs: 'F12',
        print: 'CmdOrCtrl+P',
        close: 'CmdOrCtrl+W',
      })
      expect(fileMenuAccelerators(kind, MAC).saveAs).toBe('Shift+Command+S')
    },
  )

  it('every File menu row exists in its table', () => {
    for (const kind of ['home', 'pdf', 'markdown', 'html'] as const) {
      for (const platform of [WIN, MAC]) {
        expect(Object.keys(fileMenuAccelerators(kind, platform)).length).toBeGreaterThan(2)
      }
    }
  })

  it('no module menu keeps Back to Home on Ctrl+Shift+H (Word Hide, Excel Mac Replace)', () => {
    for (const kind of ['home', 'pdf', 'markdown', 'html'] as const) {
      expect(Object.values(fileMenuAccelerators(kind, WIN))).not.toContain('Shift+CmdOrCtrl+H')
    }
    const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/Shift\+CmdOrCtrl\+H/)
  })

  it('Redo is Ctrl+Y on Windows (CmdOrCtrl+Y, the macOS menu keeps its role)', () => {
    expect(editMenuAccelerators(WIN)).toEqual({ undo: 'CmdOrCtrl+Z', redo: 'CmdOrCtrl+Y' })
    expect(editMenuAccelerators(MAC).undo).toBe('CmdOrCtrl+Z')
  })

  it('the interface scale follows the zoom keys, not the AltGr-prone Ctrl+Alt chords', () => {
    expect(interfaceScaleAccelerators(WIN)).toEqual({
      zoomIn: 'CmdOrCtrl+=',
      zoomOut: 'CmdOrCtrl+-',
      zoomReset: 'CmdOrCtrl+0',
    })
  })

  it('Full screen is F11 on Windows and Ctrl+Cmd+F on macOS', () => {
    expect(fullScreenAccelerator(WIN)).toBe('F11')
    expect(fullScreenAccelerator(MAC)).toBe('Ctrl+Command+F')
  })

  it('Developer tools: Ctrl+Shift+I / Alt+Cmd+I', () => {
    expect(devToolsAccelerator(WIN)).toBe('Ctrl+Shift+I')
    expect(devToolsAccelerator(MAC)).toBe('Alt+Command+I')
  })

  it('an unknown row has no accelerator', () => {
    expect(menuAccelerator('common', 'common-does-not-exist', WIN)).toBeUndefined()
  })

  it('index.ts writes no accelerator literal in the shell-built menus', () => {
    const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    const start = source.indexOf('function buildHomeMenu')
    const end = source.indexOf('Save As for pdf tabs')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(source.slice(start, end)).not.toMatch(/accelerator:\s*'/)
  })
})

describe('Close tab (common-07)', () => {
  it('Ctrl+W on Windows, Cmd+W on macOS', () => {
    expect(matchShellKey(input({ control: true }), ctx())).toEqual({ command: 'close-tab' })
    expect(matchShellKey(input({ meta: true }), ctx({ platform: MAC }))).toEqual({
      command: 'close-tab',
    })
  })

  it('the other platform’s modifier does not close', () => {
    expect(matchShellKey(input({ meta: true }), ctx())).toBeNull()
    expect(matchShellKey(input({ control: true }), ctx({ platform: MAC }))).toBeNull()
  })

  it('works under a non-Latin layout through the physical key', () => {
    expect(matchShellKey(input({ key: 'ц', control: true }), ctx())).toEqual({
      command: 'close-tab',
    })
  })

  it('ignores extra modifiers, repeat, key-up and composition', () => {
    for (const over of [
      { control: true, shift: true },
      { control: true, alt: true },
      { control: true, isAutoRepeat: true },
      { control: true, type: 'keyUp' },
      { control: true, isComposing: true },
      { control: true, key: 'q', code: 'KeyQ' },
    ]) {
      expect(matchShellKey(input(over), ctx())).toBeNull()
    }
  })
})

describe('Region cycling (common-09)', () => {
  it('F6 goes forward and Shift+F6 backward', () => {
    expect(matchShellKey(input({ key: 'F6', code: 'F6' }), ctx())).toEqual({
      command: 'cycle-region',
      backwards: false,
    })
    expect(matchShellKey(input({ key: 'F6', code: 'F6', shift: true }), ctx())).toEqual({
      command: 'cycle-region',
      backwards: true,
    })
  })

  it('works on macOS and lets a held key repeat', () => {
    expect(
      matchShellKey(input({ key: 'F6', code: 'F6', isAutoRepeat: true }), ctx({ platform: MAC })),
    ).toEqual({ command: 'cycle-region', backwards: false })
  })

  it('Ctrl+F6 is not the shell’s key', () => {
    expect(matchShellKey(input({ key: 'F6', code: 'F6', control: true }), ctx())).toBeNull()
  })
})

describe('Developer tools (common-21)', () => {
  const f12 = input({ key: 'F12', code: 'F12' })

  it('F12 opens them on a tab whose module does not bind F12', () => {
    expect(matchShellKey(f12, ctx({ activeKind: 'pdf' }))).toEqual({ command: 'toggle-devtools' })
    expect(matchShellKey(f12, ctx({ activeKind: 'home' }))).toEqual({ command: 'toggle-devtools' })
  })

  it('F12 stays Save As in the modules that bind it (Sheets, HTML, Markdown; Docs once its row lands)', () => {
    for (const kind of ['sheets', 'html', 'markdown'] as const) {
      expect(matchShellKey(f12, ctx({ activeKind: kind }))).toBeNull()
    }
    // data-driven: whichever module table binds F12 keeps it
    for (const kind of ['docs', 'slides', 'pdf'] as const) {
      const owns = SHORTCUT_TABLES[kind].some(
        (a) => a.context === undefined && a.win.includes('F12'),
      )
      expect(matchShellKey(f12, ctx({ activeKind: kind }))).toEqual(
        owns ? null : { command: 'toggle-devtools' },
      )
    }
  })

  it('never in a packaged build', () => {
    expect(matchShellKey(f12, ctx({ devTools: false }))).toBeNull()
  })

  it('Ctrl+Shift+I is the menu item’s, not a key the shell takes twice', () => {
    expect(
      matchShellKey(input({ key: 'I', code: 'KeyI', control: true, shift: true }), ctx()),
    ).toBeNull()
  })

  it('has no F12 on macOS', () => {
    expect(matchShellKey(f12, ctx({ platform: MAC }))).toBeNull()
  })
})

describe('the rows the shell reads', () => {
  it.each([
    ['common', 'common-01'],
    ['common', 'common-03'],
    ['common', 'common-07'],
    ['common', 'common-09'],
    ['common', 'common-16'],
    ['common', 'common-17'],
    ['common', 'common-18'],
    ['common', 'common-20'],
    ['common', 'common-21'],
    ['shell', 'shell-04'],
    ['shell', 'shell-05'],
  ] as const)('%s %s exists', (scope, id) => {
    expect(findShortcut(scope, id)).toBeDefined()
  })
})
