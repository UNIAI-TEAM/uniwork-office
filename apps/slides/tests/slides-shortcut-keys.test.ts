/**
 * UNI-2011: the editor's keys come from the @genoffice/shortcuts slides table —
 * PowerPoint's Windows chords on Windows, PowerPoint for Mac's on macOS,
 * PowerPoint for the web's in the web frame. Each chord fires its command, the
 * old colliding chords no longer do, and IME composition / AltGr never fire.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGlobalKeydown } from '../src/renderer/keyboard-actions'
import { slidesHint, slidesTipKbd } from '../src/renderer/shortcuts'
import { slidesMenuAccelerator } from '../src/shared/slides-shortcuts'
import * as arrangeActions from '../src/renderer/arrange-actions'
import * as capabilities from '../src/renderer/capabilities'
import * as clipboardActions from '../src/renderer/clipboard-actions'
import * as insertActions from '../src/renderer/insert-actions'
import * as showActions from '../src/renderer/show-actions'
import * as slideActions from '../src/renderer/slide-actions'
import type { ActionCtx } from '../src/renderer/action-context'

vi.mock('../src/renderer/capabilities', () => ({ cap: () => true, isWeb: vi.fn(() => false) }))
vi.mock('../src/renderer/clipboard-actions', () => ({
  copySelected: vi.fn(),
  cutSelected: vi.fn(),
  copySlides: vi.fn(),
  copyFormat: vi.fn(),
  pasteFormat: vi.fn(),
  pasteClipboard: vi.fn(),
  duplicateSelected: vi.fn(),
  deleteSelected: vi.fn(),
}))
vi.mock('../src/renderer/slide-actions', () => ({
  addSlide: vi.fn(),
  cutSlides: vi.fn(),
  deleteSlides: vi.fn(),
  duplicateSlides: vi.fn(),
  moveSlidesTo: vi.fn(),
}))
vi.mock('../src/renderer/file-actions', () => ({ flushActiveEdit: vi.fn(async () => {}) }))
vi.mock('../src/renderer/arrange-actions', () => ({
  groupSelected: vi.fn(),
  ungroupSelected: vi.fn(),
  regroupSelected: vi.fn(),
  rotateSelected: vi.fn(),
}))
vi.mock('../src/renderer/insert-actions', () => ({ openLinkDialog: vi.fn() }))
vi.mock('../src/renderer/show-actions', () => ({
  startSlideShow: vi.fn(),
  startPresenterView: vi.fn(),
}))
vi.mock('../src/renderer/style-actions', () => ({
  onAlign: vi.fn(),
  onFontSizeStep: vi.fn(),
  onTextToggle: vi.fn(),
}))

const WIN = 'Win32'
const MAC = 'MacIntel'

function makeCtx(over: Record<string, unknown> = {}): ActionCtx {
  return {
    slideShow: false,
    presenter: false,
    editing: null,
    selectedIds: [],
    slide: { nodes: [] },
    slides: [{}, {}, {}, {}],
    current: 1,
    selectedSlides: [1],
    setSelectedSlides: vi.fn(),
    setSelectedIds: vi.fn(),
    masterItems: null,
    inkTool: 'select',
    viewMode: 'normal',
    brushMode: null,
    enteredGroupId: null,
    overlayOpen: false,
    findNodeCtx: () => null,
    flushNotes: vi.fn(async () => {}),
    undo: vi.fn(async () => {}),
    redo: vi.fn(async () => {}),
    setFindOpen: vi.fn(),
    setZoom: vi.fn(),
    zoomToFit: vi.fn(),
    setPrintDlgOpen: vi.fn(),
    openAskPopover: vi.fn(),
    newComment: vi.fn(),
    ...over,
  } as unknown as ActionCtx
}

/** A keydown with explicit modifiers (none by default) and the physical code. */
function key(k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const code = /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : k
  return new KeyboardEvent('keydown', { key: k, code, cancelable: true, ...init })
}

function press(
  ctx: ActionCtx,
  k: string,
  init: KeyboardEventInit,
  platform: string,
): KeyboardEvent {
  const e = key(k, init)
  handleGlobalKeydown(ctx, e, platform)
  return e
}

const ctrl = { ctrlKey: true }
const cmd = { metaKey: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(capabilities.isWeb).mockReturnValue(false)
  document.body.innerHTML = ''
})

describe('duplicate slide vs duplicate object (P0: Ctrl+Shift+D)', () => {
  it.each([
    [WIN, ctrl],
    [MAC, cmd],
  ])('%s: Shift+mod+D duplicates the selected slides, even with a shape selected', (p, mod) => {
    const ctx = makeCtx({ selectedIds: ['s1'], selectedSlides: [1, 2] })
    const e = press(ctx, 'D', { ...mod, shiftKey: true }, p)
    expect(e.defaultPrevented).toBe(true)
    expect(slideActions.duplicateSlides).toHaveBeenCalledWith(ctx, [1, 2])
    expect(clipboardActions.duplicateSelected).not.toHaveBeenCalled()
  })

  it.each([
    [WIN, ctrl],
    [MAC, { ctrlKey: true }],
    [MAC, cmd],
  ])('%s: Ctrl+D / Control+D / Cmd+D duplicates the selected shape', (p, mod) => {
    const ctx = makeCtx({ selectedIds: ['s1'] })
    press(ctx, 'd', mod, p)
    expect(clipboardActions.duplicateSelected).toHaveBeenCalledWith(ctx, ['s1'])
    expect(slideActions.duplicateSlides).not.toHaveBeenCalled()
  })
})

describe('insert hyperlink (Ctrl+K, Ask AI by button only)', () => {
  it.each([
    [WIN, ctrl],
    [MAC, cmd],
  ])('%s: mod+K opens the link dialog for the selected shape, not Ask AI', (p, mod) => {
    const ctx = makeCtx({ selectedIds: ['s1'] })
    const e = press(ctx, 'k', mod, p)
    expect(e.defaultPrevented).toBe(true)
    expect(insertActions.openLinkDialog).toHaveBeenCalledWith(ctx)
    expect((ctx as unknown as { openAskPopover: () => void }).openAskPopover).not.toBeCalled()
  })

  it('opens the link dialog on the text being edited', () => {
    const editor = document.createElement('div')
    editor.className = 'slide-text-editor'
    editor.contentEditable = 'true'
    editor.tabIndex = 0
    document.body.appendChild(editor)
    editor.focus()
    const ctx = makeCtx({ editing: { sourceId: 's1' } })
    press(ctx, 'k', ctrl, WIN)
    expect(insertActions.openLinkDialog).toHaveBeenCalledWith(ctx)
  })

  it('leaves Ctrl+K alone without a single selected shape', () => {
    const ctx = makeCtx({ selectedIds: ['a', 'b'] })
    const e = press(ctx, 'k', ctrl, WIN)
    expect(e.defaultPrevented).toBe(false)
    expect(insertActions.openLinkDialog).not.toHaveBeenCalled()
  })
})

describe('new slide', () => {
  it('Windows Ctrl+M, Mac Shift+Cmd+N', async () => {
    press(makeCtx(), 'm', ctrl, WIN)
    press(makeCtx(), 'N', { ...cmd, shiftKey: true }, MAC)
    await vi.waitFor(() => expect(slideActions.addSlide).toHaveBeenCalledTimes(2))
  })

  it('leaves Cmd+M to Minimize on the Mac', () => {
    const e = press(makeCtx(), 'm', cmd, MAC)
    expect(e.defaultPrevented).toBe(false)
  })

  it('has no web key on the Mac (PowerPoint for the web prints none)', () => {
    vi.mocked(capabilities.isWeb).mockReturnValue(true)
    const e = press(makeCtx(), 'N', { ...cmd, shiftKey: true }, MAC)
    expect(e.defaultPrevented).toBe(false)
    expect(press(makeCtx(), 'm', ctrl, WIN).defaultPrevented).toBe(true)
  })
})

describe('move slides', () => {
  it.each([
    [WIN, ctrl, 'ArrowUp', 0],
    [WIN, ctrl, 'ArrowDown', 3],
    [MAC, cmd, 'ArrowUp', 0],
    [MAC, cmd, 'ArrowDown', 3],
  ])('%s: mod+%s moves the current slide one step (gap %s)', (p, mod, k, gap) => {
    const ctx = makeCtx()
    const e = press(ctx, k, mod, p)
    expect(e.defaultPrevented).toBe(true)
    expect(slideActions.moveSlidesTo).toHaveBeenCalledWith(ctx, [1], gap)
  })

  it.each([
    [WIN, ctrl, 'ArrowUp', 0],
    [WIN, ctrl, 'ArrowDown', 4],
    [MAC, cmd, 'ArrowDown', 4],
  ])('%s: Shift+mod+%s moves the selection to the start / end', (p, mod, k, gap) => {
    const ctx = makeCtx({ selectedSlides: [1, 2] })
    press(ctx, k, { ...mod, shiftKey: true }, p)
    expect(slideActions.moveSlidesTo).toHaveBeenCalledWith(ctx, [1, 2], gap)
  })

  it('nudges a selected shape with Ctrl+arrow instead', () => {
    const ctx = makeCtx({ selectedIds: ['s1'] })
    press(ctx, 'ArrowUp', ctrl, WIN)
    expect(slideActions.moveSlidesTo).not.toHaveBeenCalled()
  })
})

describe('group / ungroup / regroup', () => {
  it.each([
    [WIN, 'g', ctrl, 'groupSelected'],
    [MAC, 'g', { metaKey: true, altKey: true }, 'groupSelected'],
    [MAC, 'g', cmd, 'groupSelected'],
    [WIN, 'G', { ctrlKey: true, shiftKey: true }, 'ungroupSelected'],
    [MAC, 'G', { metaKey: true, altKey: true, shiftKey: true }, 'ungroupSelected'],
    [WIN, 'J', { ctrlKey: true, shiftKey: true }, 'regroupSelected'],
    [MAC, 'j', { metaKey: true, altKey: true }, 'regroupSelected'],
  ] as const)('%s: %s %o → %s', (p, k, mod, fn) => {
    const ctx = makeCtx({ selectedIds: ['a', 'b'] })
    press(ctx, k, mod, p)
    expect(arrangeActions[fn]).toHaveBeenCalledWith(ctx)
  })

  it('Mac web: Cmd+Option+G groups, the desktop-only Cmd+G does not', () => {
    vi.mocked(capabilities.isWeb).mockReturnValue(true)
    press(makeCtx({ selectedIds: ['a', 'b'] }), 'g', cmd, MAC)
    expect(arrangeActions.groupSelected).not.toHaveBeenCalled()
    press(makeCtx({ selectedIds: ['a', 'b'] }), 'g', { metaKey: true, altKey: true }, MAC)
    expect(arrangeActions.groupSelected).toHaveBeenCalledOnce()
  })
})

describe('start the show', () => {
  it.each([
    [WIN, 'F5', {}, true],
    [WIN, 'F5', { shiftKey: true }, false],
    [MAC, 'Enter', { metaKey: true, shiftKey: true }, true],
    [MAC, 'F5', {}, true],
  ])('desktop %s: %s %o (from start: %s)', (p, k, mod, fromStart) => {
    const ctx = makeCtx()
    press(ctx, k, mod, p)
    expect(showActions.startSlideShow).toHaveBeenCalledWith(ctx, fromStart)
  })

  it.each([
    [WIN, 'F5', { altKey: true }],
    [MAC, 'Enter', { altKey: true }],
  ])('%s: Alt+F5 / Option+Return opens presenter view, not the plain show', (p, k, mod) => {
    const ctx = makeCtx()
    press(ctx, k, mod, p)
    expect(showActions.startPresenterView).toHaveBeenCalledWith(ctx, false)
    expect(showActions.startSlideShow).not.toHaveBeenCalled()
  })

  it.each([
    [WIN, 'F5', ctrl, true],
    [WIN, 'F5', { ctrlKey: true, shiftKey: true }, false],
    [MAC, 'Enter', { metaKey: true, shiftKey: true }, true],
    [MAC, 'F5', { metaKey: true, shiftKey: true }, false],
  ])('web %s: %s %o (from start: %s)', (p, k, mod, fromStart) => {
    vi.mocked(capabilities.isWeb).mockReturnValue(true)
    const ctx = makeCtx()
    press(ctx, k, mod, p)
    expect(showActions.startSlideShow).toHaveBeenCalledWith(ctx, fromStart)
  })

  it('web: a plain F5 stays the browser reload', () => {
    vi.mocked(capabilities.isWeb).mockReturnValue(true)
    const e = press(makeCtx(), 'F5', {}, WIN)
    expect(e.defaultPrevented).toBe(false)
    expect(showActions.startSlideShow).not.toHaveBeenCalled()
  })
})

describe('other table keys', () => {
  it.each([
    [WIN, 'ArrowRight', 15],
    [WIN, 'ArrowLeft', -15],
    [MAC, 'ArrowLeft', -15],
  ])('%s: Alt+%s rotates the selection %s°', (p, k, deg) => {
    const ctx = makeCtx({ selectedIds: ['s1'] })
    press(ctx, k, { altKey: true }, p)
    expect(arrangeActions.rotateSelected).toHaveBeenCalledWith(ctx, deg)
  })

  it.each([
    [WIN, 'h', ctrl],
    [MAC, 'H', { metaKey: true, shiftKey: true }],
  ])('%s: Replace opens the find / replace panel', (p, k, mod) => {
    const ctx = makeCtx()
    press(ctx, k, mod, p)
    expect(ctx.setFindOpen).toHaveBeenCalledWith(true)
  })

  it.each([
    [WIN, 'y', ctrl],
    [WIN, 'Z', { ctrlKey: true, shiftKey: true }],
    [MAC, 'y', cmd],
    [MAC, 'Z', { metaKey: true, shiftKey: true }],
  ])('%s: redo on %s %o', (p, k, mod) => {
    const ctx = makeCtx()
    press(ctx, k, mod, p)
    expect(ctx.redo).toHaveBeenCalledOnce()
    expect(ctx.undo).not.toHaveBeenCalled()
  })

  it('Ctrl+Alt+O fits the slide to the window, but not when AltGr types a character', () => {
    const ctx = makeCtx()
    press(ctx, 'o', { ctrlKey: true, altKey: true, modifierAltGraph: true }, WIN)
    expect(ctx.zoomToFit).not.toHaveBeenCalled()
    press(ctx, 'o', { ctrlKey: true, altKey: true }, WIN)
    expect(ctx.zoomToFit).toHaveBeenCalledOnce()
    press(ctx, 'o', { metaKey: true, altKey: true }, MAC)
    expect(ctx.zoomToFit).toHaveBeenCalledTimes(2)
  })

  it('Insert comment: Ctrl+Alt+M (not AltGr+M) on Windows, Shift+Cmd+M on the Mac', () => {
    const ctx = makeCtx()
    press(ctx, 'm', { ctrlKey: true, altKey: true, modifierAltGraph: true }, WIN)
    expect(ctx.newComment).not.toHaveBeenCalled()
    press(ctx, 'm', { ctrlKey: true, altKey: true }, WIN)
    press(ctx, 'M', { metaKey: true, shiftKey: true }, MAC)
    expect(ctx.newComment).toHaveBeenCalledTimes(2)
  })

  it('pastes formatting with Ctrl+Shift+V on the desktop only (web: plain-text paste)', () => {
    const ctx = makeCtx({ selectedIds: ['s1'] })
    press(ctx, 'V', { ctrlKey: true, shiftKey: true }, WIN)
    expect(clipboardActions.pasteFormat).toHaveBeenCalledOnce()
    vi.mocked(capabilities.isWeb).mockReturnValue(true)
    const e = press(ctx, 'V', { ctrlKey: true, shiftKey: true }, WIN)
    expect(e.defaultPrevented).toBe(false)
    expect(clipboardActions.pasteFormat).toHaveBeenCalledOnce()
    expect(clipboardActions.pasteClipboard).not.toHaveBeenCalled()
  })

  it('fires nothing while an IME (Telex / VNI) is composing', () => {
    const ctx = makeCtx({ selectedIds: ['s1'] })
    for (const [k, init] of [
      ['m', ctrl],
      ['D', { ctrlKey: true, shiftKey: true }],
      ['k', ctrl],
      ['g', ctrl],
    ] as const) {
      const e = key(k, { ...init, isComposing: true })
      handleGlobalKeydown(ctx, e, WIN)
      expect(e.defaultPrevented).toBe(false)
    }
    expect(slideActions.addSlide).not.toHaveBeenCalled()
    expect(slideActions.duplicateSlides).not.toHaveBeenCalled()
    expect(insertActions.openLinkDialog).not.toHaveBeenCalled()
    expect(arrangeActions.groupSelected).not.toHaveBeenCalled()
  })
})

describe('hints and menu accelerators come from the table', () => {
  it('new slide and show tips per platform and surface', () => {
    expect(slidesHint('slides-14', 'win')).toBe('Ctrl+M')
    expect(slidesHint('slides-14', 'mac')).toBe('⇧⌘N')
    expect(slidesHint('slides-22', 'win')).toBe('F5')
    expect(slidesHint('slides-22', 'mac')).toBe('⇧⌘↩')
    expect(slidesHint('slides-23', 'mac')).toBe('⌘↩')
    expect(slidesHint('slides-15', 'win')).toBe('Ctrl+Shift+D')
    vi.mocked(capabilities.isWeb).mockReturnValue(true)
    expect(slidesHint('slides-22', 'win')).toBe('Ctrl+F5')
    expect(slidesHint('slides-23', 'win')).toBe('Ctrl+Shift+F5')
    expect(slidesHint('slides-14', 'mac')).toBe('')
    expect(slidesTipKbd('slides-14')).toBe('Ctrl+M')
  })

  it('ribbon tooltips and File menu keys carry no hand-written chord', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer')
    for (const file of ['Ribbon.tsx', 'RibbonHomeTab.tsx', 'RibbonInsertTab.tsx']) {
      const src = readFileSync(join(dir, 'components', file), 'utf8')
      expect(src, file).not.toMatch(/data-tip-kbd=(["']|\{(?!slidesTipKbd|brushTipKbd))/)
      expect(src, file).not.toMatch(/file-menu-key">[^{]/)
    }
    // the show tooltips' key comes from data-tip-kbd, not from the translated text
    const en = readFileSync(join(dir, 'i18n/ribbon/en.ts'), 'utf8')
    expect(en).not.toMatch(/ribbonFrom(Beginning|Current)Tip: '[^']*F5/)
  })

  it('menu accelerators', () => {
    expect(slidesMenuAccelerator('save', 'win')).toBe('CmdOrCtrl+S')
    expect(slidesMenuAccelerator('saveAs', 'mac')).toBe('CmdOrCtrl+Shift+S')
    expect(slidesMenuAccelerator('redo', 'win')).toBe('CmdOrCtrl+Y')
    expect(slidesMenuAccelerator('redo', 'mac')).toBe('CmdOrCtrl+Y')
    expect(slidesMenuAccelerator('close', 'mac')).toBe('CmdOrCtrl+W')
  })
})

/** A text field with focus, as when the user types in the notes or a dialog box. */
function focusField(tag: 'textarea' | 'input' = 'textarea'): void {
  const el = document.createElement(tag)
  document.body.appendChild(el)
  el.focus()
}

describe('slide-level chords leave text editing alone (L5)', () => {
  const chords: Array<[string, string, string, KeyboardEventInit]> = [
    [WIN, 'ArrowUp', 'Ctrl+Up (move slide)', ctrl],
    [WIN, 'ArrowDown', 'Ctrl+Shift+Down (move slide)', { ctrlKey: true, shiftKey: true }],
    [WIN, 'D', 'Ctrl+Shift+D (duplicate slide)', { ctrlKey: true, shiftKey: true }],
    [WIN, 'g', 'Ctrl+G (group)', ctrl],
    [WIN, 'G', 'Ctrl+Shift+G (ungroup)', { ctrlKey: true, shiftKey: true }],
    [WIN, 'ArrowRight', 'Alt+Right (rotate)', { altKey: true }],
    [MAC, 'ArrowUp', 'Cmd+Up (move slide)', cmd],
    [MAC, 'D', 'Shift+Cmd+D (duplicate slide)', { metaKey: true, shiftKey: true }],
  ]
  const acted = () =>
    [
      slideActions.moveSlidesTo,
      slideActions.duplicateSlides,
      arrangeActions.groupSelected,
      arrangeActions.ungroupSelected,
      arrangeActions.rotateSelected,
      clipboardActions.duplicateSelected,
    ].some((fn) => vi.mocked(fn).mock.calls.length > 0)

  it.each(chords)('%s: %s (%s) is quiet while a shape text is edited', (p, k, _name, init) => {
    const ctx = makeCtx({ editing: { sourceId: 's1' }, selectedIds: ['s1'] })
    const e = press(ctx, k, init, p)
    expect(acted()).toBe(false)
    expect(e.defaultPrevented).toBe(false)
  })

  it.each(chords)('%s: %s (%s) is quiet in a focused text field', (p, k, _name, init) => {
    focusField()
    const e = press(makeCtx(), k, init, p)
    expect(acted()).toBe(false)
    expect(e.defaultPrevented).toBe(false)
  })
})

describe('keys while the slide show or presenter view runs (L5)', () => {
  it.each([{ slideShow: true }, { presenter: true }])(
    'Ctrl+H hides the pointer there and does not open Replace in the editor (%o)',
    (over) => {
      const ctx = makeCtx(over)
      const e = press(ctx, 'h', ctrl, WIN)
      expect(ctx.setFindOpen).not.toHaveBeenCalled()
      expect(e.defaultPrevented).toBe(false)
      const mac = press(ctx, 'H', { metaKey: true, shiftKey: true }, MAC)
      expect(ctx.setFindOpen).not.toHaveBeenCalled()
      expect(mac.defaultPrevented).toBe(false)
    },
  )
})

describe('macOS Option chords match by the physical key (L5)', () => {
  // Option + letter types a symbol on the Mac (Option+G = ©, Option+J = ∆): the key
  // property is no longer the letter, so the matcher has to fall back to the code.
  it.each([
    ['©', 'KeyG', { metaKey: true, altKey: true }, 'groupSelected'],
    ['©', 'KeyG', { metaKey: true, altKey: true, shiftKey: true }, 'ungroupSelected'],
    ['∆', 'KeyJ', { metaKey: true, altKey: true }, 'regroupSelected'],
  ] as const)('Option: key %s code %s → %s', (k, code, mod, fn) => {
    const ctx = makeCtx({ selectedIds: ['a', 'b'] })
    const e = new KeyboardEvent('keydown', { key: k, code, cancelable: true, ...mod })
    handleGlobalKeydown(ctx, e, MAC)
    expect(arrangeActions[fn]).toHaveBeenCalledWith(ctx)
  })
})

describe('Format Painter tips (L3)', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer')

  it('no ribbon shard prints the copy / paste format chord in the translated text', () => {
    const shards = readdirSync(join(dir, 'i18n/ribbon')).filter((f) => f.endsWith('.ts'))
    expect(shards.length).toBeGreaterThanOrEqual(21)
    for (const f of shards) {
      const src = readFileSync(join(dir, 'i18n/ribbon', f), 'utf8')
      const tips = /ribbonBrushTip(?:NoSelection|HasFormat|Default):\s*\n?\s*(['"`])[^]*?\1/g
      const found = [...src.matchAll(tips)]
      expect(found.length, f).toBe(3)
      for (const m of found) expect(m[0], f).not.toMatch(/[⌘⇧⌃⌥]|Ctrl|Cmd/)
    }
  })

  it('the button prints the table chords; the web has no paste-format key', () => {
    const src = readFileSync(join(dir, 'components/RibbonHomeTab.tsx'), 'utf8')
    expect(src).toMatch(/brushTipKbd\(\)/)
    expect(slidesHint('slides-11', 'mac')).toBe('⇧⌘C')
    expect(slidesHint('slides-12', 'mac')).toBe('⇧⌘V')
    vi.mocked(capabilities.isWeb).mockReturnValue(true)
    expect(slidesHint('slides-11', 'win')).toBe('Ctrl+Shift+C')
    expect(slidesHint('slides-12', 'win')).toBe('')
  })
})
