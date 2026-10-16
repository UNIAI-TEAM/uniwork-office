// The shared frame dialog (every web module): action order, tones, safe first focus, Escape, Tab
// trap, focus return, marker attribute, blocking notice.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  frameAsk,
  hideFrameNotices,
  openFrameDialog,
  showFrameNotice,
  toneOf,
} from './frame-dialog'

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

  it('first focus is Cancel when the caller names no primary: Enter never discards edits', async () => {
    const done = conflict()
    // Reload latest is lifted to the filled primary for looks, yet Enter must not trigger it
    expect(btn('reload').className).toBe('ow-dlg-btn primary')
    expect(document.activeElement).toBe(btn('cancel'))
    expect(document.activeElement).not.toBe(btn('reload'))
    expect(document.activeElement).not.toBe(btn('overwrite'))
    btn('overwrite').click()
    expect(await done).toBe('overwrite')
  })

  it('a named safe primary keeps the first focus (leave and draft dialogs)', () => {
    void frameAsk({
      title: 't',
      body: 'b',
      choices: [
        { id: 'discard', label: 'Discard', danger: true },
        { id: 'restore', label: 'Restore', primary: true },
      ],
      cancelId: 'dismiss',
      marker: 'draft',
    })
    expect(document.activeElement).toBe(btn('restore'))
  })

  it('a dialog with no primary lifts its first neutral choice to the filled primary', () => {
    void conflict()
    expect(order()).toEqual(['Reload latest', 'Overwrite', 'Cancel'])
    expect(btn('reload').className).toBe('ow-dlg-btn primary')
    expect(btn('overwrite').className).toBe('ow-dlg-btn danger')
    expect(btn('cancel').className).toBe('ow-dlg-btn ghost')
  })

  it('an explicit primary is never replaced by the lifted one', () => {
    void frameAsk({
      title: 't',
      body: 'b',
      choices: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'reload', label: 'Reload' },
        { id: 'keep', label: 'Keep both', primary: true },
      ],
      cancelId: 'cancel',
      marker: 'x',
    })
    expect(btn('keep').className).toBe('ow-dlg-btn primary')
    expect(btn('reload').className).toBe('ow-dlg-btn')
    expect(document.activeElement).toBe(btn('keep'))
  })

  it('every dialog has a close X (labelled) that answers like Escape', async () => {
    const done = conflict()
    const x = document.querySelector<HTMLButtonElement>('.ow-dlg-close')!
    expect(x).not.toBeNull()
    expect(x.getAttribute('aria-label')).toBe('Close')
    expect(x.hasAttribute('data-choice')).toBe(false)
    x.click()
    expect(await done).toBe('cancel')
    expect(document.querySelector('.ow-dlg-mask')).toBeNull()
  })

  it('the close X joins the Tab loop after the choices, and a custom label wins', () => {
    void frameAsk({
      title: 't',
      body: 'b',
      choices: [{ id: 'ok', label: 'OK', primary: true }],
      cancelId: 'ok',
      closeLabel: 'Đóng',
      marker: 'x',
    })
    const x = document.querySelector<HTMLButtonElement>('.ow-dlg-close')!
    expect(x.getAttribute('aria-label')).toBe('Đóng')
    keydown('Tab')
    expect(document.activeElement).toBe(x)
    keydown('Tab')
    expect(document.activeElement).toBe(btn('ok'))
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
    document.querySelector<HTMLButtonElement>('.ow-dlg-close')!.click()
    expect(await done).toBe('dismiss')
  })

  it('Escape on the draft prompt answers the dismiss id too', async () => {
    const done = frameAsk({
      title: 'Restore?',
      body: 'b',
      choices: [{ id: 'restore', label: 'Restore', primary: true }],
      cancelId: 'dismiss',
      marker: 'draft-recovery',
    })
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
    // order: Reload latest, Overwrite, Cancel, then the close X; the focus starts on Cancel and
    // the loop wraps both ways
    expect(document.activeElement).toBe(btn('cancel'))
    keydown('Tab')
    expect(document.activeElement).toBe(document.querySelector('.ow-dlg-close'))
    keydown('Tab')
    expect(document.activeElement).toBe(btn('reload'))
    keydown('Tab')
    expect(document.activeElement).toBe(btn('overwrite'))
    keydown('Tab', true)
    expect(document.activeElement).toBe(btn('reload'))
    keydown('Tab', true)
    expect(document.activeElement).toBe(document.querySelector('.ow-dlg-close'))
    keydown('Escape')
    expect(await done).toBe('cancel')
    expect(document.activeElement).toBe(opener)
  })

  it('when opened with focus on body, Escape or Close returns focus to the module canvas/editor root', async () => {
    for (const cls of ['stage-wrap', 'pdf-scroll']) {
      document.body.innerHTML = ''
      const root = document.createElement('div')
      root.className = cls
      document.body.append(root)
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      expect(document.activeElement).toBe(document.body)

      const done = conflict()
      keydown('Escape')
      expect(await done).toBe('cancel')
      expect(document.activeElement).toBe(root)
    }
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

describe('open dialog reflow and focus (S5)', () => {
  it('the first focus never scrolls the card: the title and description stay in view', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    void conflict()
    const cancel = btn('cancel')
    const call = focus.mock.calls.find((_, i) => focus.mock.contexts[i] === cancel)
    expect(call?.[0]).toMatchObject({ preventScroll: true })
    focus.mockRestore()
  })

  it('every step starts scrolled to the top of the dialog', async () => {
    const scrollTop = vi.spyOn(Element.prototype, 'scrollTop', 'set')
    const handle = openFrameDialog<string>({ marker: 'steps' })
    const mask = document.querySelector('.ow-dlg-mask')!
    void handle.step({
      title: 'One',
      body: 'First',
      choices: [{ id: 'cancel', label: 'Cancel' }],
      cancelId: 'cancel',
    })
    const topped = () =>
      scrollTop.mock.contexts.filter((c, i) => c === mask && scrollTop.mock.calls[i]?.[0] === 0)
    expect(topped().length).toBe(1)
    void handle.step({
      title: 'Two',
      body: 'Second',
      choices: [{ id: 'back', label: 'Back' }],
      cancelId: 'back',
    })
    expect(topped().length).toBe(2)
    handle.close()
    scrollTop.mockRestore()
  })

  it('two disabled choices with the same reason show it once, both described by it', () => {
    void frameAsk({
      title: 't',
      body: 'b',
      choices: [
        { id: 'reload', label: 'Reload', disabled: true, reason: 'You are offline.' },
        {
          id: 'overwrite',
          label: 'Overwrite',
          danger: true,
          disabled: true,
          reason: 'You are offline.',
        },
        { id: 'cancel', label: 'Cancel' },
      ],
      cancelId: 'cancel',
      marker: 'offline',
    })
    const lines = [...document.querySelectorAll('.ow-dlg-reason')]
    expect(lines.map((l) => l.textContent)).toEqual(['You are offline.'])
    expect(btn('reload').getAttribute('aria-describedby')).toBe(lines[0]!.id)
    expect(btn('overwrite').getAttribute('aria-describedby')).toBe(lines[0]!.id)
  })

  it('different reasons keep one line each', () => {
    void frameAsk({
      title: 't',
      body: 'b',
      choices: [
        { id: 'a', label: 'A', disabled: true, reason: 'Reason A.' },
        { id: 'b', label: 'B', disabled: true, reason: 'Reason B.' },
        { id: 'cancel', label: 'Cancel' },
      ],
      cancelId: 'cancel',
      marker: 'two',
    })
    expect([...document.querySelectorAll('.ow-dlg-reason')].map((l) => l.textContent)).toEqual([
      'Reason A.',
      'Reason B.',
    ])
  })

  it('setChoiceDisabled flips a choice live and keeps the reason lines in step', () => {
    const handle = openFrameDialog<string>({ marker: 'live' })
    void handle.step({
      title: 't',
      body: 'b',
      choices: [
        { id: 'reload', label: 'Reload', primary: true },
        { id: 'overwrite', label: 'Overwrite', danger: true },
        { id: 'cancel', label: 'Cancel' },
      ],
      cancelId: 'cancel',
    })
    expect(document.querySelectorAll('.ow-dlg-reason').length).toBe(0)
    handle.setChoiceDisabled('reload', 'Offline.')
    handle.setChoiceDisabled('overwrite', 'Offline.')
    expect(btn('reload').getAttribute('aria-disabled')).toBe('true')
    expect(btn('overwrite').getAttribute('aria-disabled')).toBe('true')
    expect([...document.querySelectorAll('.ow-dlg-reason')].map((l) => l.textContent)).toEqual([
      'Offline.',
    ])
    expect(btn('reload').getAttribute('aria-describedby')).toBe(
      document.querySelector('.ow-dlg-reason')!.id,
    )
    handle.setChoiceDisabled('reload', null)
    handle.setChoiceDisabled('overwrite', null)
    expect(btn('reload').hasAttribute('aria-disabled')).toBe(false)
    expect(btn('reload').hasAttribute('aria-describedby')).toBe(false)
    expect(document.querySelectorAll('.ow-dlg-reason').length).toBe(0)
    handle.close()
  })

  it('focus that falls out of the dialog (backdrop click) returns to the last control', async () => {
    void conflict()
    expect(document.activeElement).toBe(btn('cancel'))
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement).toBe(btn('cancel'))
    // the last focused control, not always Cancel
    keydown('Tab')
    const x = document.querySelector<HTMLElement>('.ow-dlg-close')!
    expect(document.activeElement).toBe(x)
    x.blur()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement).toBe(x)
  })

  it('a step change that replaces the focused button does not fight the new first focus', async () => {
    const handle = openFrameDialog<string>({ marker: 'steps2' })
    void handle.step({
      title: 'One',
      body: 'b',
      choices: [{ id: 'cancel', label: 'Cancel' }],
      cancelId: 'cancel',
    })
    void handle.step({
      title: 'Two',
      body: 'b',
      choices: [
        { id: 'go', label: 'Go', primary: true },
        { id: 'back', label: 'Back' },
      ],
      cancelId: 'back',
      focusId: 'back',
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement).toBe(btn('back'))
    handle.close()
  })

  it('once closed the dialog no longer pulls the focus back', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const done = conflict()
    keydown('Escape')
    await done
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement).toBe(opener)
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
    expect(mask.querySelector('.ow-dlg-close')).toBeNull()
    expect(mask.querySelector('[role="alertdialog"]')).not.toBeNull()
    hideFrameNotices('fatal')
    expect(document.querySelector('[data-office-web="fatal"]')).toBeNull()
  })
})
