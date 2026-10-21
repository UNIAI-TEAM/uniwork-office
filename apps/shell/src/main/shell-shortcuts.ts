import {
  SHORTCUT_TABLES,
  findShortcut,
  fromElectronInput,
  matchChord,
  matchShortcut,
  toElectronAccelerator,
  type ElectronInputLike,
  type ShortcutAction,
  type ShortcutPlatform,
  type ShortcutScope,
} from '@genoffice/shortcuts'

import type { TabKind } from '../shared/tabs-api'

/**
 * The shell's keyboard bindings, read from `@genoffice/shortcuts`: the
 * accelerators of the menus the shell builds itself (Home, PDF, Markdown, HTML)
 * and the keys it takes straight from the key event (close tab, region
 * cycling, DevTools). No chord is written down here, so a change to a table
 * row changes the menu and the key handler together.
 */

/** `win` for Windows and Linux, `mac` for macOS */
export function shortcutPlatform(platform: NodeJS.Platform = process.platform): ShortcutPlatform {
  return platform === 'darwin' ? 'mac' : 'win'
}

/** The menu accelerator of a table row on a platform; undefined when the row
 * has no chord there or its chord cannot be a menu accelerator. */
export function menuAccelerator(
  scope: ShortcutScope,
  id: string,
  platform: ShortcutPlatform = shortcutPlatform(),
): string | undefined {
  const action = findShortcut(scope, id)
  return (action && toElectronAccelerator(action, platform)) ?? undefined
}

export type FileMenuKind = 'home' | 'pdf' | 'markdown' | 'html'
export type FileMenuItem = 'new' | 'open' | 'save' | 'saveAs' | 'print' | 'close'
export type FileMenuAccelerators = Partial<Record<FileMenuItem, string>>

type RowRef = readonly [ShortcutScope, string]

const NEW_ROW: RowRef = ['common', 'common-01']
const OPEN_ROW: RowRef = ['common', 'common-03']
const CLOSE_ROW: RowRef = ['common', 'common-07']

/** The table row behind each File menu item of a shell-built menu. Back to Home
 * has no row: Ctrl+Shift+H collides with Word and Excel Mac, so it is menu-only. */
const FILE_MENU_ROWS: Readonly<Record<FileMenuKind, Partial<Record<FileMenuItem, RowRef>>>> = {
  home: { new: NEW_ROW, open: OPEN_ROW, close: CLOSE_ROW },
  pdf: {
    new: NEW_ROW,
    open: OPEN_ROW,
    save: ['pdf', 'pdf-01'],
    saveAs: ['pdf', 'pdf-02'],
    print: ['pdf', 'pdf-07'],
    close: CLOSE_ROW,
  },
  markdown: {
    new: NEW_ROW,
    open: ['markdown', 'markdown-001'],
    save: ['markdown', 'markdown-002'],
    saveAs: ['markdown', 'markdown-003'],
    print: ['markdown', 'markdown-004'],
    close: CLOSE_ROW,
  },
  html: {
    new: NEW_ROW,
    open: ['html', 'html-001'],
    save: ['html', 'html-002'],
    saveAs: ['html', 'html-003'],
    print: ['html', 'html-004'],
    close: CLOSE_ROW,
  },
}

/** The File menu accelerators of a shell-built menu, from the tables. */
export function fileMenuAccelerators(
  kind: FileMenuKind,
  platform: ShortcutPlatform = shortcutPlatform(),
): FileMenuAccelerators {
  const result: FileMenuAccelerators = {}
  for (const [item, ref] of Object.entries(FILE_MENU_ROWS[kind]) as [FileMenuItem, RowRef][]) {
    const accelerator = menuAccelerator(ref[0], ref[1], platform)
    if (accelerator) result[item] = accelerator
  }
  return result
}

/** Undo / Redo accelerators of the Edit menu (Redo is Ctrl+Y on Windows). */
export function editMenuAccelerators(platform: ShortcutPlatform = shortcutPlatform()): {
  undo?: string
  redo?: string
} {
  const undo = menuAccelerator('shell', 'shell-04', platform)
  const redo = menuAccelerator('shell', 'shell-05', platform)
  return { ...(undo ? { undo } : {}), ...(redo ? { redo } : {}) }
}

export type InterfaceScaleItem = 'zoomIn' | 'zoomOut' | 'zoomReset'

const SCALE_ROWS: Readonly<Record<InterfaceScaleItem, string>> = {
  zoomIn: 'common-16',
  zoomOut: 'common-17',
  zoomReset: 'common-18',
}

/** The interface-scale items' accelerators (the Home page zoom). */
export function interfaceScaleAccelerators(
  platform: ShortcutPlatform = shortcutPlatform(),
): Partial<Record<InterfaceScaleItem, string>> {
  const result: Partial<Record<InterfaceScaleItem, string>> = {}
  for (const [item, id] of Object.entries(SCALE_ROWS) as [InterfaceScaleItem, string][]) {
    const accelerator = menuAccelerator('common', id, platform)
    if (accelerator) result[item] = accelerator
  }
  return result
}

/**
 * The alias chords of the interface-scale rows (Ctrl+Shift+=, the keypad keys and their Cmd twins)
 * as menu accelerators. A menu item has one accelerator, so the aliases ride on hidden items. A
 * chord the accelerator helper rejects (see `acceleratorSkipReason`) is left out.
 */
export function interfaceScaleAliasAccelerators(
  platform: ShortcutPlatform = shortcutPlatform(),
): Partial<Record<InterfaceScaleItem, readonly string[]>> {
  const result: Partial<Record<InterfaceScaleItem, readonly string[]>> = {}
  for (const [item, id] of Object.entries(SCALE_ROWS) as [InterfaceScaleItem, string][]) {
    const action = findShortcut('common', id)
    if (!action) continue
    const primary = toElectronAccelerator(action, platform)
    const aliases = action[platform]
      .slice(1)
      .map((chord) => toElectronAccelerator({ ...action, [platform]: [chord] }, platform))
      .filter((accelerator): accelerator is string => !!accelerator && accelerator !== primary)
    if (aliases.length > 0) result[item] = aliases
  }
  return result
}

/** The View menu items the shell adds to the menus it builds itself: Full screen
 * (F11 / Ctrl+Cmd+F) and, in a development build, Developer tools. */
export function fullScreenAccelerator(
  platform: ShortcutPlatform = shortcutPlatform(),
): string | undefined {
  return menuAccelerator('common', 'common-20', platform)
}

export function devToolsAccelerator(
  platform: ShortcutPlatform = shortcutPlatform(),
): string | undefined {
  return menuAccelerator('common', 'common-21', platform)
}

/** A key the shell acts on before any page sees it. */
export type ShellKeyCommand =
  | { readonly command: 'close-tab' }
  | { readonly command: 'cycle-region'; readonly backwards: boolean }
  | { readonly command: 'toggle-devtools' }

/** The `before-input-event` input plus its type. */
export interface ShellKeyInput extends ElectronInputLike {
  readonly type: string
}

export interface ShellKeyContext {
  readonly platform: ShortcutPlatform
  /** developer tools are offered in this build (never in a packaged one) */
  readonly devTools: boolean
  readonly activeKind: TabKind
}

function row(scope: ShortcutScope, id: string): ShortcutAction {
  const action = findShortcut(scope, id)
  if (!action) throw new Error(`shortcut row ${scope}/${id} is missing`)
  return action
}

/** True when the active module's own table binds the chord (F12 is Save As in
 * Docs, Sheets, HTML and Markdown), so the shell must leave it to the module. */
function moduleOwnsChord(kind: TabKind, chord: string, platform: ShortcutPlatform): boolean {
  if (kind === 'home') return false
  return SHORTCUT_TABLES[kind].some(
    (action) => action.context === undefined && action[platform].includes(chord),
  )
}

/**
 * Which shell command, if any, a key event is. Composition (Telex, VNI, IME),
 * auto-repeat of a no-repeat row and an AltGr-style Ctrl+Alt never match.
 * Developer tools only answer the chords beyond the menu's own accelerator
 * (F12): the menu item handles Ctrl+Shift+I, so the key is not taken twice.
 */
export function matchShellKey(input: ShellKeyInput, ctx: ShellKeyContext): ShellKeyCommand | null {
  if (input.type !== 'keyDown') return null
  const event = fromElectronInput(input)
  const { platform } = ctx

  if (matchShortcut(event, [row('common', 'common-07')], platform, 'desktop')) {
    return { command: 'close-tab' }
  }
  if (matchShortcut(event, [row('common', 'common-09')], platform, 'desktop')) {
    return { command: 'cycle-region', backwards: event.shiftKey }
  }
  if (ctx.devTools) {
    const devTools = row('common', 'common-21')
    if (devTools.guard.noRepeat && event.repeat) return null
    for (const chord of devTools[platform].slice(1)) {
      if (matchChord(chord, event, platform, devTools.match)) {
        return moduleOwnsChord(ctx.activeKind, chord, platform)
          ? null
          : { command: 'toggle-devtools' }
      }
    }
  }
  return null
}
