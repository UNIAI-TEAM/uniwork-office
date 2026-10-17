import { describe, expect, it } from 'vitest'
import { clickMarkupTool, navAction, shouldHandleDocumentUndo } from '../src/renderer/keyNav'

describe('navAction', () => {
  it('steps a whole page on ArrowDown/ArrowUp when focus is in the thumbnail sidebar', () => {
    expect(navAction('ArrowDown', true)).toEqual({ type: 'stepPage', dir: 1 })
    expect(navAction('ArrowUp', true)).toEqual({ type: 'stepPage', dir: -1 })
  })

  it('scrolls by 60px on ArrowDown/ArrowUp when focus is outside the sidebar', () => {
    expect(navAction('ArrowDown', false)).toEqual({ type: 'scrollBy', delta: 60 })
    expect(navAction('ArrowUp', false)).toEqual({ type: 'scrollBy', delta: -60 })
  })

  it('steps a whole page on ArrowRight/ArrowLeft regardless of focus', () => {
    expect(navAction('ArrowRight', false)).toEqual({ type: 'stepPage', dir: 1 })
    expect(navAction('ArrowLeft', false)).toEqual({ type: 'stepPage', dir: -1 })
    expect(navAction('ArrowRight', true)).toEqual({ type: 'stepPage', dir: 1 })
    expect(navAction('ArrowLeft', true)).toEqual({ type: 'stepPage', dir: -1 })
  })

  it('scrolls a viewport on PageDown/Space/PageUp', () => {
    expect(navAction('PageDown', false)).toEqual({ type: 'scrollViewport', dir: 1 })
    expect(navAction(' ', false)).toEqual({ type: 'scrollViewport', dir: 1 })
    expect(navAction('PageUp', false)).toEqual({ type: 'scrollViewport', dir: -1 })
  })

  it('jumps to the edges on Home/End', () => {
    expect(navAction('Home', false)).toEqual({ type: 'scrollEdge', edge: 'top' })
    expect(navAction('End', false)).toEqual({ type: 'scrollEdge', edge: 'bottom' })
  })

  it('returns null for keys it does not handle', () => {
    expect(navAction('a', false)).toBeNull()
    expect(navAction('Enter', true)).toBeNull()
    expect(navAction('Tab', false)).toBeNull()
  })
})

describe('shouldHandleDocumentUndo', () => {
  it('leaves native undo alone in text-entry controls', () => {
    for (const type of ['email', 'password', 'search', 'tel', 'text', 'url']) {
      const input = document.createElement('input')
      input.type = type
      expect(shouldHandleDocumentUndo(input, 'z', true), type).toBe(false)
    }
    expect(shouldHandleDocumentUndo(document.createElement('textarea'), 'Z', true)).toBe(false)
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(shouldHandleDocumentUndo(editable, 'z', true)).toBe(false)
  })

  it('keeps document undo for choice, non-text, and read-only controls', () => {
    for (const type of ['checkbox', 'number', 'radio', 'range']) {
      const input = document.createElement('input')
      input.type = type
      expect(shouldHandleDocumentUndo(input, 'z', true), type).toBe(true)
    }
    expect(shouldHandleDocumentUndo(document.createElement('select'), 'z', true)).toBe(true)
    const readOnly = document.createElement('input')
    readOnly.readOnly = true
    expect(shouldHandleDocumentUndo(readOnly, 'z', true)).toBe(true)
  })

  it('keeps document undo for non-editable targets and other shortcuts', () => {
    const target = document.createElement('div')
    expect(shouldHandleDocumentUndo(target, 'z', true)).toBe(true)
    expect(shouldHandleDocumentUndo(target, 'y', true)).toBe(true)
    expect(shouldHandleDocumentUndo(document.createElement('input'), 'z', false)).toBe(true)
  })
})

describe('armed markup tool and Escape (UNI-1876 SVF-3)', () => {
  it('arms Highlight / Underline / Strikeout when clicked without a selection and toggles off on repeat click', () => {
    expect(clickMarkupTool(null, 'highlight', false)).toEqual({
      kind: 'arm',
      nextTool: 'highlight',
    })
    expect(clickMarkupTool('highlight', 'highlight', false)).toEqual({
      kind: 'arm',
      nextTool: null,
    })
    expect(clickMarkupTool('highlight', 'underline', false)).toEqual({
      kind: 'arm',
      nextTool: 'underline',
    })
  })

  it('applies immediately when text is already selected instead of leaving the tool armed', () => {
    expect(clickMarkupTool(null, 'highlight', true)).toEqual({
      kind: 'apply',
      nextTool: null,
    })
    expect(clickMarkupTool('highlight', 'highlight', true)).toEqual({
      kind: 'apply',
      nextTool: null,
    })
  })
})
