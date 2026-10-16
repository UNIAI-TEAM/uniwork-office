// G6-09 visual r1 F8: the page is locked while an AI run is open; a user who clicks or types
// into it gets the reason (as in the pdf app) instead of silence, and the note leaves with the run.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { t } from '../src/renderer/i18n/locale'
import { mountDocsAiPanel, type DocsAiHarness } from './helpers/docs-ai-run-harness'

const BOLD = {
  name: 'apply_ops',
  input: { ops: [{ op: 'setFont', target: { blockIndexes: [0] }, bold: true }] },
}

let h: DocsAiHarness | null = null
beforeEach(() => localStorage.removeItem('ai-docs-track-changes'))
afterEach(() => {
  h?.cleanup()
  h = null
})

const notice = () => h!.container.querySelector('.ai-edits-paused')
/**
 * The event reaches the page's listeners up to the panel's (registered at mount) and stops
 * there: ProseMirror's own mousedown handling reads the layout under the pointer, which jsdom
 * does not have.
 */
const attempt = async (event: Event) => {
  const dom = h!.editor.view.dom
  const stop = (e: Event) => e.stopImmediatePropagation()
  dom.addEventListener(event.type, stop, true)
  try {
    await act(async () => {
      dom.dispatchEvent(event)
    })
  } finally {
    dom.removeEventListener(event.type, stop, true)
  }
}

describe('edits paused during an AI run (docs)', () => {
  it('no note until the user tries the page; a click shows it, the run end removes it', async () => {
    h = await mountDocsAiPanel(['first block'])
    await h.send('bold it')
    await h.toolTurn([BOLD])
    expect(notice()).toBeNull()
    await attempt(new MouseEvent('mousedown', { bubbles: true }))
    const el = notice()
    expect(el, 'paused note').not.toBeNull()
    expect(el!.getAttribute('role')).toBe('status')
    expect(el!.textContent).toBe(t('aiEditsPaused'))
    await h.textTurn('Done.')
    expect(notice()).toBeNull()
  })

  it('typing on the page shows it too', async () => {
    h = await mountDocsAiPanel(['first block'])
    await h.send('what does it say?')
    await attempt(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    expect(notice()).not.toBeNull()
  })

  it('outside a run the page is editable and no note shows', async () => {
    h = await mountDocsAiPanel(['first block'])
    await attempt(new MouseEvent('mousedown', { bubbles: true }))
    expect(notice()).toBeNull()
  })
})
