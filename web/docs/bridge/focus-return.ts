/**
 * Keyboard focus hand-back (UNI-1232 DP, visual r2 F-12 / N-06).
 *
 * The host dialog that opens over the frame ("Leave this document?") takes keyboard focus. When it
 * closes (Stay, Escape, the close button) the host focuses the iframe and its window. If the editor
 * was not the document's active element at that moment (a click on a ribbon button or on the page
 * margin leaves <body> active) the caret is gone: typing and Ctrl+S do nothing until a click.
 *
 * This listens for the frame window regaining focus with nothing focused and puts the focus back in
 * the last editing surface the user was in (else the first editable one). A focus that came from a
 * pointer press is left alone: the click decides where the focus goes, the editor must not steal it.
 */

/** the editing surfaces of the Docs page: the main editor and the header/footer/textbox sub-editors */
const EDITOR_SELECTOR = '.ProseMirror[contenteditable="true"], td[contenteditable="true"]'

/** how long after a pointer press a window focus still counts as "the click did it" */
const POINTER_GRACE_MS = 250

export interface FocusReturnOptions {
  window?: Window
  /** overrides the editing-surface lookup (tests) */
  findEditor?: (doc: Document) => HTMLElement | null
}

export function installFocusReturn(options: FocusReturnOptions = {}): () => void {
  const win = options.window ?? window
  const doc = win.document
  let lastEditor: HTMLElement | null = null
  let lastPointerAt = -Infinity

  const inEditor = (el: EventTarget | null): HTMLElement | null =>
    el instanceof win.HTMLElement ? (el.closest(EDITOR_SELECTOR) as HTMLElement | null) : null

  const onFocusIn = (e: FocusEvent) => {
    const editor = inEditor(e.target)
    if (editor) lastEditor = editor
  }
  const onPointer = () => {
    lastPointerAt = win.performance.now()
  }
  // a press inside the frame that is followed by the window losing focus was not what refocuses it
  const onWindowBlur = () => {
    lastPointerAt = -Infinity
  }
  const onWindowFocus = () => {
    // the browser settles the focused element after the window event: look one task later
    win.setTimeout(() => {
      const active = doc.activeElement
      if (active && active !== doc.body && active !== doc.documentElement) return
      if (win.performance.now() - lastPointerAt < POINTER_GRACE_MS) return
      // a modal (frame dialog, in-app dialog) owns the focus while it is up
      if (doc.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return
      const target =
        (lastEditor?.isConnected ? lastEditor : null) ??
        (options.findEditor
          ? options.findEditor(doc)
          : (doc.querySelector(EDITOR_SELECTOR) as HTMLElement | null))
      target?.focus({ preventScroll: true })
    }, 0)
  }

  doc.addEventListener('focusin', onFocusIn)
  doc.addEventListener('pointerdown', onPointer, true)
  doc.addEventListener('mousedown', onPointer, true)
  win.addEventListener('focus', onWindowFocus)
  win.addEventListener('blur', onWindowBlur)
  return () => {
    doc.removeEventListener('focusin', onFocusIn)
    doc.removeEventListener('pointerdown', onPointer, true)
    doc.removeEventListener('mousedown', onPointer, true)
    win.removeEventListener('focus', onWindowFocus)
    win.removeEventListener('blur', onWindowBlur)
  }
}
