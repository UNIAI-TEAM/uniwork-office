import {
  currentShortcutPlatform,
  matchShortcut,
  pdfShortcuts,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'
import type { MarkupType } from '../shared/ipc'

export type MarkupToolClickOutcome =
  | { readonly kind: 'apply'; readonly nextTool: null }
  | { readonly kind: 'arm'; readonly nextTool: MarkupType | null }

/**
 * Ribbon Highlight / Underline / Strikeout click: with an active page selection
 * the markup applies immediately; without one, clicking arms (or toggles off)
 * the markup tool so the next selection applies it and Escape disarms it.
 */
export function clickMarkupTool(
  currentTool: MarkupType | null,
  clicked: MarkupType,
  hasSelection: boolean,
): MarkupToolClickOutcome {
  if (hasSelection) return { kind: 'apply', nextTool: null }
  return { kind: 'arm', nextTool: currentTool === clicked ? null : clicked }
}

/** Pending edit/UI state cleared when a document loads without a saved
    snapshot (a fresh open, or the reload after applying redactions to the
    working copy). Order matches the reset sequence in App.loadDoc. The armed
    draw/markup tool is deliberately absent: it is viewer state, not document
    state, and the redaction reload must keep it or the next mark fails. */
export const DOC_LOAD_RESET_KEYS = [
  'aiSelection',
  'askPop',
  'markups',
  'redactions',
  'redactionApplyConfirmed',
  'annotDeletes',
  'noteEdits',
  'drawings',
  'textEdits',
  'textInserts',
  'pendingTextInsert',
  'imageEdits',
  'textDraft',
  'stampCfg',
  'formEdits',
  'signatureTarget',
  'rotations',
  'deletedPages',
  'order',
  'metadata',
] as const

export type DocLoadReset = Record<(typeof DOC_LOAD_RESET_KEYS)[number], () => void>

export function resetDocLoadState(reset: DocLoadReset): void {
  for (const key of DOC_LOAD_RESET_KEYS) reset[key]()
}

/** What a plain (no-modifier) navigation key should do in the viewer */
export type NavAction =
  | { type: 'scrollBy'; delta: number }
  | { type: 'scrollViewport'; dir: 1 | -1 }
  | { type: 'scrollEdge'; edge: 'top' | 'bottom' }
  | { type: 'stepPage'; dir: 1 | -1 }

const TEXT_INPUT_TYPES = new Set(['email', 'password', 'search', 'tel', 'text', 'url'])

function usesNativeTextUndo(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.tagName === 'INPUT') {
    const input = element as HTMLInputElement
    return !input.disabled && !input.readOnly && TEXT_INPUT_TYPES.has(input.type.toLowerCase())
  }
  if (element.tagName === 'TEXTAREA') {
    const textarea = element as HTMLTextAreaElement
    return !textarea.disabled && !textarea.readOnly
  }
  return element.isContentEditable
}

export function shouldHandleDocumentUndo(
  target: EventTarget | null,
  key: string,
  modifier: boolean,
): boolean {
  if (!modifier || key.toLowerCase() !== 'z') return true
  return !usesNativeTextUndo(target)
}

/** Vertical arrows step whole pages while focus sits in the thumbnail sidebar,
    and scroll the document otherwise */
export function navAction(key: string, focusInThumbs: boolean): NavAction | null {
  switch (key) {
    case 'PageDown':
    case ' ':
      return { type: 'scrollViewport', dir: 1 }
    case 'PageUp':
      return { type: 'scrollViewport', dir: -1 }
    case 'Home':
      return { type: 'scrollEdge', edge: 'top' }
    case 'End':
      return { type: 'scrollEdge', edge: 'bottom' }
    case 'ArrowDown':
      return focusInThumbs ? { type: 'stepPage', dir: 1 } : { type: 'scrollBy', delta: 60 }
    case 'ArrowUp':
      return focusInThumbs ? { type: 'stepPage', dir: -1 } : { type: 'scrollBy', delta: -60 }
    case 'ArrowRight':
      return { type: 'stepPage', dir: 1 }
    case 'ArrowLeft':
      return { type: 'stepPage', dir: -1 }
    default:
      return null
  }
}

/**
 * The viewer navigation a keydown asks for: the `nav` rows of the pdf table (Edge PDF: Space,
 * Shift+Space, PageUp/PageDown, Home/End; ours: the arrows). Any Ctrl / Alt / Cmd chord is a
 * shortcut or the browser's (Alt+Left is history back), Shift only reverses Space, and an IME
 * composition never navigates: the matcher refuses all of those.
 */
export function navKeyAction(
  event: Pick<
    KeyboardEvent,
    'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing' | 'keyCode'
  >,
  focusInThumbs: boolean,
  platform: ShortcutPlatform = currentShortcutPlatform(),
): NavAction | null {
  // Win and Mac print the same bare keys, and no `nav` row has a web column of its own
  if (!matchShortcut(event as ShortcutKeyEvent, pdfShortcuts, platform, 'desktop', 'nav')) {
    return null
  }
  if (event.shiftKey) return { type: 'scrollViewport', dir: -1 }
  return navAction(event.key, focusInThumbs)
}
