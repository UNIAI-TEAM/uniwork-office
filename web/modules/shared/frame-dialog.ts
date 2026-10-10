/**
 * The one in-frame dialog of every web editor (Docs, PDF, Markdown, HTML, Slides, Sheets): save
 * conflict, discard unsaved changes, draft recovery, merge prompt, blocking open failure. Each
 * module's notice file only translates its own strings and calls this, so the dialogs look and
 * behave like the UniWork host's leave dialog in every module:
 *
 * - layout: centred card, stacked full-width actions (./frame-dialog.css, theme tokens only);
 * - action order: primary, neutral, destructive, then the way out (Cancel / Stay) last, whatever
 *   order the caller lists them in;
 * - styles: the brand-blue primary (the caller's `primary`; without one the first neutral choice,
 *   so no dialog is a row of outlined buttons), a soft destructive style (`danger`, never the
 *   first focus), a quiet style for the way out;
 * - close X: top right of every choice dialog, answers like Escape (`cancelId`), last in the Tab loop;
 * - focus: the safe primary first (never a destructive one; without a primary the cancel choice),
 *   Tab stays inside, Escape = `cancelId`, focus returns to where it was when it closes.
 */
import { webLanguage } from '../../docs/bridge/browser'
import './frame-dialog.css'
import { webText } from './i18n/strings-web'

export interface FrameChoice<T extends string> {
  id: T
  /** already translated */
  label: string
  /** the recommended action: brand fill */
  primary?: boolean
  /** destructive (Overwrite, Discard): soft red, never the initial focus */
  danger?: boolean
}

export interface FrameDialogOptions<T extends string> {
  title: string
  body: string
  /** extra muted lines under the body (names, times) */
  details?: readonly string[]
  choices: readonly FrameChoice<T>[]
  /** resolved on Escape; when it names one of `choices`, that button is the quiet way out */
  cancelId: T
  /** the button that takes the first focus (default: the safe primary, else the cancel choice) */
  focusId?: T
  /** accessible name of the close X (already translated; default: the shared "Close") */
  closeLabel?: string
  /** the dialog's marker value (tests and e2e) */
  marker: string
  /** attribute that carries the marker (default `data-office-web`) */
  markerAttr?: string
  /** extra class on the backdrop (Docs uses it to report open dialogs to the host) */
  maskClass?: string
  /** called after the dialog was added and after it was removed */
  onChange?: () => void
}

export const FRAME_DIALOG_MARKER_ATTR = 'data-office-web'

let seq = 0

function build(opts: {
  title: string
  body: string
  details?: readonly string[]
  marker: string
  markerAttr?: string
  maskClass?: string
}): { mask: HTMLElement; card: HTMLElement } {
  const id = `ow-dlg-${++seq}`
  const mask = document.createElement('div')
  mask.className = opts.maskClass ? `ow-dlg-mask ${opts.maskClass}` : 'ow-dlg-mask'
  mask.setAttribute(opts.markerAttr ?? FRAME_DIALOG_MARKER_ATTR, opts.marker)
  const card = document.createElement('div')
  card.className = 'ow-dlg'
  card.setAttribute('role', 'alertdialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-labelledby', `${id}-title`)
  card.setAttribute('aria-describedby', `${id}-body`)
  const head = document.createElement('div')
  head.className = 'ow-dlg-head'
  const title = document.createElement('h2')
  title.className = 'ow-dlg-title'
  title.id = `${id}-title`
  title.textContent = opts.title
  const body = document.createElement('p')
  body.className = 'ow-dlg-body'
  body.id = `${id}-body`
  body.textContent = opts.body
  head.append(title, body)
  for (const line of opts.details ?? []) {
    const d = document.createElement('p')
    d.className = 'ow-dlg-detail'
    d.textContent = line
    head.append(d)
  }
  card.append(head)
  mask.append(card)
  return { mask, card }
}

type Tone = 'primary' | 'neutral' | 'danger' | 'ghost'

const RANK: Record<Tone, number> = { primary: 0, neutral: 1, danger: 2, ghost: 3 }

/** the order and look of a choice, from what the caller says about it (pure, for tests) */
export function toneOf<T extends string>(choice: FrameChoice<T>, cancelId: T): Tone {
  if (choice.danger) return 'danger'
  if (choice.primary) return 'primary'
  return choice.id === cancelId ? 'ghost' : 'neutral'
}

/**
 * The tone of every choice. A dialog whose caller names no primary (the save conflict lists Reload
 * latest, Overwrite, Cancel) gets its first neutral choice lifted to the filled primary, so the
 * recommended action reads the same as in the host's leave dialog.
 */
export function tonesOf<T extends string>(choices: readonly FrameChoice<T>[], cancelId: T): Tone[] {
  const tones = choices.map((c) => toneOf(c, cancelId))
  if (!tones.includes('primary')) {
    const first = tones.indexOf('neutral')
    if (first >= 0) tones[first] = 'primary'
  }
  return tones
}

const CLOSE_ICON =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">' +
  '<path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round"/></svg>'

function closeButton(label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'ow-dlg-close'
  b.setAttribute('aria-label', label)
  b.innerHTML = CLOSE_ICON
  return b
}

/** modal choice; resolves with the chosen id, or `cancelId` on Escape */
export function frameAsk<T extends string>(opts: FrameDialogOptions<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const { mask, card } = build(opts)
    const returnTo = document.activeElement as HTMLElement | null
    const actions = document.createElement('div')
    actions.className = 'ow-dlg-actions'
    const buttons: HTMLButtonElement[] = []
    const finish = (id: T): void => {
      document.removeEventListener('keydown', onKey, true)
      mask.remove()
      opts.onChange?.()
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true })
      resolve(id)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(opts.cancelId)
        return
      }
      if (e.key !== 'Tab' || buttons.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const step = e.shiftKey ? -1 : 1
      buttons[at < 0 ? 0 : (at + step + buttons.length) % buttons.length]!.focus()
    }
    const tones = tonesOf(opts.choices, opts.cancelId)
    const ordered = opts.choices
      .map((c, i) => ({ c, i, tone: tones[i]! }))
      .sort((a, b) => RANK[a.tone] - RANK[b.tone] || a.i - b.i)
    // the first focus: the caller's pick, else the safe primary, else the way out, else any
    // non-destructive button
    const safeId =
      opts.focusId ??
      ordered.find(({ c, tone }) => tone === 'primary' && !c.danger)?.c.id ??
      opts.cancelId
    let initial: HTMLButtonElement | null = null
    let fallback: HTMLButtonElement | null = null
    for (const { c, tone } of ordered) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.choice = c.id
      b.className = tone === 'neutral' ? 'ow-dlg-btn' : `ow-dlg-btn ${tone}`
      b.textContent = c.label
      b.addEventListener('click', () => finish(c.id))
      actions.append(b)
      buttons.push(b)
      if (c.id === safeId) initial = b
      else if (!fallback && tone !== 'danger') fallback = b
    }
    const x = closeButton(opts.closeLabel ?? webText(webLanguage(), 'webClose'))
    x.addEventListener('click', () => finish(opts.cancelId))
    buttons.push(x)
    card.append(actions, x)
    document.addEventListener('keydown', onKey, true)
    document.body.append(mask)
    opts.onChange?.()
    ;(initial ?? fallback ?? buttons[0])?.focus()
  })
}

/** blocking notice without buttons (the host decides what happens next); returns its backdrop */
export function showFrameNotice(opts: {
  title: string
  body: string
  marker: string
  markerAttr?: string
  maskClass?: string
}): HTMLElement {
  const { mask } = build(opts)
  document.body.append(mask)
  return mask
}

export function hideFrameNotices(marker: string, markerAttr = FRAME_DIALOG_MARKER_ATTR): void {
  for (const el of document.querySelectorAll(`[${markerAttr}="${marker}"]`)) el.remove()
}
