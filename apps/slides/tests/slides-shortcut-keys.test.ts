/**
 * UNI-2011: the editor's keys come from the @genoffice/shortcuts slides table —
 * PowerPoint's Windows chords on Windows, PowerPoint for Mac's on macOS,
 * PowerPoint for the web's in the web frame. Each chord fires its command, the
 * old colliding chords no longer do, and IME composition / AltGr never fire.
 */
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

  it('menu accelerators', () => {
    expect(slidesMenuAccelerator('save', 'win')).toBe('CmdOrCtrl+S')
    expect(slidesMenuAccelerator('saveAs', 'mac')).toBe('CmdOrCtrl+Shift+S')
    expect(slidesMenuAccelerator('redo', 'win')).toBe('CmdOrCtrl+Y')
    expect(slidesMenuAccelerator('redo', 'mac')).toBe('CmdOrCtrl+Y')
    expect(slidesMenuAccelerator('close', 'mac')).toBe('CmdOrCtrl+W')
  })
})
