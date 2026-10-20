import { isComposingEvent, type ShortcutKeyEvent } from '@genoffice/shortcuts'

export type PdfPasswordKeyAction = 'submit' | 'cancel' | null

/**
 * What a key does in the PDF password prompt: Enter in the field submits, Escape
 * anywhere cancels (shell-dialog-keys). A key pressed while an IME composition is
 * running (isComposing, or keyCode 229 on the confirming Enter) belongs to the
 * composition and does neither.
 */
export function pdfPasswordKeyAction(
  event: Pick<ShortcutKeyEvent, 'key' | 'isComposing' | 'keyCode'>,
  target: 'field' | 'other',
): PdfPasswordKeyAction {
  if (
    isComposingEvent({
      ...event,
      code: '',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    })
  ) {
    return null
  }
  if (event.key === 'Escape') return 'cancel'
  if (event.key === 'Enter' && target === 'field') return 'submit'
  return null
}
