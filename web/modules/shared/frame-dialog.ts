/**
 * The one in-frame dialog of every web editor (Docs, PDF, Markdown, HTML, Slides, Sheets): save
 * conflict, discard unsaved changes, draft recovery, merge prompt, blocking open failure. Each
 * module's notice file only translates its own strings and calls this, so the dialogs look and
 * behave like the UniWork host's leave dialog in every module:
 *
 * - layout: centred card, stacked full-width actions (./frame-dialog.css, theme tokens only);
 * - action order: primary, neutral, destructive, then the way out (Cancel / Stay) last, whatever
 *   order the caller lists them in;
 * - styles: the brand-blue primary, a soft destructive style (`danger`, never the first focus),
 *   a quiet style for the way out;
 * - focus: the safe action first (the cancel choice; without one, the primary; never a destructive
 *   one), Tab stays inside, Escape = `cancelId`, focus returns to where it was when it closes.
 */
import './frame-dialog.css'

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
  /** the button that takes the first focus (default: the cancel choice, else the primary) */
  focusId?: T
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
    const ordered = opts.choices
      .map((c, i) => ({ c, i, tone: toneOf(c, opts.cancelId) }))
      .sort((a, b) => RANK[a.tone] - RANK[b.tone] || a.i - b.i)
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
      if (c.id === (opts.focusId ?? opts.cancelId)) initial = b
      else if (!fallback && tone !== 'danger') fallback = b
    }
    card.append(actions)
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
