/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'

import { pdfPasswordKeyAction } from '../src/renderer/src/pdf-password-keys'

describe('PDF password prompt keys (shell-dialog-keys)', () => {
  it('Enter in the field submits, Escape cancels', () => {
    expect(pdfPasswordKeyAction({ key: 'Enter' }, 'field')).toBe('submit')
    expect(pdfPasswordKeyAction({ key: 'Escape' }, 'field')).toBe('cancel')
    expect(pdfPasswordKeyAction({ key: 'Escape' }, 'other')).toBe('cancel')
  })

  it('Enter outside the field and other keys do nothing', () => {
    expect(pdfPasswordKeyAction({ key: 'Enter' }, 'other')).toBeNull()
    expect(pdfPasswordKeyAction({ key: 'a' }, 'field')).toBeNull()
  })

  it('the Enter that confirms an IME composition does not submit', () => {
    expect(pdfPasswordKeyAction({ key: 'Enter', isComposing: true }, 'field')).toBeNull()
    expect(pdfPasswordKeyAction({ key: 'Enter', keyCode: 229 }, 'field')).toBeNull()
  })

  it('the Escape that cancels an IME composition does not close the prompt', () => {
    expect(pdfPasswordKeyAction({ key: 'Escape', isComposing: true }, 'other')).toBeNull()
    expect(pdfPasswordKeyAction({ key: 'Escape', keyCode: 229 }, 'field')).toBeNull()
  })

  it('reads the composition fields of a real KeyboardEvent (accessors, not own properties)', () => {
    const real = (key: string, init: KeyboardEventInit) =>
      new KeyboardEvent('keydown', { key, ...init })
    expect(pdfPasswordKeyAction(real('Enter', { isComposing: true }), 'field')).toBeNull()
    expect(pdfPasswordKeyAction(real('Escape', { isComposing: true }), 'other')).toBeNull()
    expect(pdfPasswordKeyAction(real('Enter', { keyCode: 229 }), 'field')).toBeNull()
    expect(pdfPasswordKeyAction(real('Enter', {}), 'field')).toBe('submit')
    expect(pdfPasswordKeyAction(real('Escape', {}), 'other')).toBe('cancel')
  })
})
