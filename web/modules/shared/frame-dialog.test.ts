// The shared frame dialog (every web module): action order, tones, safe first focus, Escape, Tab
// trap, focus return, marker attribute, blocking notice.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { frameAsk, hideFrameNotices, showFrameNotice, toneOf } from './frame-dialog'

const keydown = (key: string, shiftKey = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))

const btn = (id: string) => document.querySelector<HTMLButtonElement>(`[data-choice="${id}"]`)!
const order = () => [...document.querySelectorAll('[data-choice]')].map((b) => b.textContent)

afterEach(() => {
  document.body.replaceChildren()
})

const conflict = () =>
  frameAsk({
    title: 'Changed elsewhere',
    body: 'Someone saved a newer version.',
    choices: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'reload', label: 'Reload latest' },
      { id: 'overwrite', label: 'Overwrite', danger: true },
    ],
    cancelId: 'cancel',
    marker: 'conflict',
  })

describe('frameAsk', () => {
  it('orders primary, neutral, destructive, then the way out, whatever the caller lists', async () => {
    const done = frameAsk({
      title: 't',
      body: 'b',
      choices: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'discard', label: 'Discard', danger: true },
        { id: 'keep', label: 'Keep' },
        { id: 'save', label: 'Save', primary: true },
      ],
      cancelId: 'cancel',
      marker: 'leave',
    })
    expect(order()).toEqual(['Save', 'Keep', 'Discard', 'Cancel'])
    expect(btn('save').className).toBe('ow-dlg-btn primary')
    expect(btn('keep').className).toBe('ow-dlg-btn')
    expect(btn('discard').className).toBe('ow-dlg-btn danger')
    expect(btn('cancel').className).toBe('ow-dlg-btn ghost')
    btn('save').click()
    expect(await done).toBe('save')
    expect(document.querySelector('.ow-dlg-mask')).toBeNull()
  })

  it('first focus is the safe way out, never the destructive choice', async () => {
    const done = conflict()
    expect(document.activeElement).toBe(btn('cancel'))
    btn('overwrite').click()
    expect(await done).toBe('overwrite')
  })

  it('without a cancel button the primary takes the focus (draft prompt), danger never', async () => {
    const done = frameAsk({
      title: 'Restore?',
      body: 'b',
      choices: [
        { id: 'discard', label: 'Discard', danger: true },
        { id: 'restore', label: 'Restore', primary: true },
      ],
      cancelId: 'dismiss',
      marker: 'draft-recovery',
    })
    expect(order()).toEqual(['Restore', 'Discard'])
    expect(document.activeElement).toBe(btn('restore'))
    keydown('Escape')
    expect(await done).toBe('dismiss')
  })

  it('a cancel that is also primary stays primary and focused', () => {
    void frameAsk({
      title: 't',
      body: 'b',
      choices: [
        { id: 'cancel', label: 'Cancel', primary: true },
        { id: 'discard', label: 'Discard', danger: true },
      ],
      cancelId: 'cancel',
      marker: 'discard',
    })
    expect(order()).toEqual(['Cancel', 'Discard'])
    expect(btn('cancel').className).toBe('ow-dlg-btn primary')
    expect(document.activeElement).toBe(btn('cancel'))
  })

  it('focusId overrides the first focus', () => {
    void frameAsk({
      title: 't',
      body: 'b',
      choices: [
        { id: '0', label: 'Continue', primary: true },
        { id: '1', label: 'Cancel' },
      ],
      cancelId: '1',
      focusId: '0',
      marker: 'confirm',
    })
    expect(document.activeElement).toBe(btn('0'))
  })

  it('Escape answers cancelId, Tab wraps inside, focus returns to where it was', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const done = conflict()
    keydown('Tab')
    expect(document.activeElement).toBe(btn('reload'))
    keydown('Tab')
    expect(document.activeElement).toBe(btn('overwrite'))
    keydown('Tab')
    expect(document.activeElement).toBe(btn('cancel'))
    keydown('Tab', true)
    expect(document.activeElement).toBe(btn('overwrite'))
    keydown('Escape')
    expect(await done).toBe('cancel')
    expect(document.activeElement).toBe(opener)
  })

  it('labels the dialog, carries the marker attribute and the extra lines', () => {
    const onChange = vi.fn()
    void frameAsk({
      title: 'Restore unsaved changes?',
      body: 'A copy was kept.',
      details: ['Saved 10:30', 'Based on an older version'],
      choices: [{ id: 'ok', label: 'OK', primary: true }],
      cancelId: 'ok',
      marker: 'draft',
      markerAttr: 'data-pdf-web',
      maskClass: 'extra',
      onChange,
    })
    const mask = document.querySelector('[data-pdf-web="draft"]')!
    expect(mask.className).toBe('ow-dlg-mask extra')
    const box = mask.querySelector('[role="alertdialog"]')!
    expect(box.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Restore unsaved changes?',
    )
    expect(document.getElementById(box.getAttribute('aria-describedby')!)!.textContent).toBe(
      'A copy was kept.',
    )
    expect([...mask.querySelectorAll('.ow-dlg-detail')].map((d) => d.textContent)).toEqual([
      'Saved 10:30',
      'Based on an older version',
    ])
    expect(onChange).toHaveBeenCalledTimes(1)
    btn('ok').click()
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('toneOf', () => {
  it('danger beats primary beats cancel', () => {
    expect(toneOf({ id: 'a', label: 'A', danger: true, primary: true }, 'a')).toBe('danger')
    expect(toneOf({ id: 'a', label: 'A', primary: true }, 'a')).toBe('primary')
    expect(toneOf({ id: 'a', label: 'A' }, 'a')).toBe('ghost')
    expect(toneOf({ id: 'b', label: 'B' }, 'a')).toBe('neutral')
  })
})

describe('blocking notice', () => {
  it('shows a buttonless dialog and removes it by marker', () => {
    showFrameNotice({ title: 'Could not open', body: 'Try again.', marker: 'fatal' })
    const mask = document.querySelector('[data-office-web="fatal"]')!
    expect(mask.querySelector('button')).toBeNull()
    expect(mask.querySelector('[role="alertdialog"]')).not.toBeNull()
    hideFrameNotices('fatal')
    expect(document.querySelector('[data-office-web="fatal"]')).toBeNull()
  })
})
