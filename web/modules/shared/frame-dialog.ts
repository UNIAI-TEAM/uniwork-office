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
 * - focus: the safe primary the caller named first (never a destructive one; without one, e.g. the
 *   save conflict, the cancel choice, so Enter never discards edits),
 *   Tab stays inside, Escape = `cancelId`, focus returns to where it was when it closes. The
 *   first focus never scrolls (the title and description stay in view when the card is taller
 *   than a zoomed frame), a step starts at the top, and focus that falls out of the card (a click
 *   on the backdrop) goes back to the last control it held.
 *
 * `openFrameDialog` is the multi-step form (the save conflict, ./conflict-dialog.ts): a later step
 * replaces the card's content in place (never a second dialog), a `content` slot sits between the
 * body and the actions (comparison table, notes), choices may be `aria-disabled` with a reason and
 * stay in the Tab loop (every focusable element of the card, in DOM order; one shared reason is
 * shown once and can change live with `setChoiceDisabled`), the card keeps one
 * fixed role=alert line (collapsed when empty, never display:none) and an `h2[tabindex=-1]` title
 * that takes the focus when a variant changes in place. While a dialog is open the rest of the
 * frame is `inert` and `onFrameModal` listeners hear open / closed (the protocol `modal` event).
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
  /**
   * shown and kept in the Tab order but not runnable (`aria-disabled`, never the native
   * `disabled`, so keyboard and screen-reader users still reach it and hear why)
   */
  disabled?: boolean
  /** already translated: why a disabled choice cannot run (its `aria-describedby`) */
  reason?: string
}

/** the first-focus target that is the dialog's own title (a variant changed in place) */
export const FOCUS_TITLE = '@title'

/** one step of a dialog: a later step replaces the content of the same card (no stacking) */
export interface FrameDialogStep<T extends string> {
  title: string
  body: string
  /** extra muted lines under the body (names, times) */
  details?: readonly string[]
  /** DOM slot between the body and the actions (comparison table, radio group) */
  content?: HTMLElement
  choices: readonly FrameChoice<T>[]
  /** resolved on Escape; when it names one of `choices`, that button is the quiet way out */
  cancelId: T
  /** what the close X answers (default: `cancelId`) */
  closeId?: T
  /**
   * the first focus (default: the named safe primary, else the cancel choice); `FOCUS_TITLE`
   * focuses the title, for a variant that changed in place
   */
  focusId?: T | typeof FOCUS_TITLE
  /** the dialog's own alert line (role=alert, always in the tree; empty = collapsed) */
  alert?: string
}

/** where the dialog lives: one card, marker and backdrop, whatever step it shows */
export interface FrameDialogFrame {
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

export interface FrameDialogOptions<T extends string> extends FrameDialogStep<T>, FrameDialogFrame {
  focusId?: T
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
}): { mask: HTMLElement; card: HTMLElement; head: HTMLElement; id: string } {
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
  return { mask, card, head, id }
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

const FOCUSABLE =
  'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'

/** every element of the card the Tab key reaches, in DOM order (aria-disabled ones included) */
function tabStops(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && !el.closest('[hidden]'),
  )
}

// ------------------------------------------------------------ open-dialog tracking

type ModalListener = (open: boolean) => void
const modalListeners = new Set<ModalListener>()
let reportedOpen = false
const MODAL_ATTR = 'data-ow-modal'

/** read from the DOM, so a dialog removed by anyone (or a reset body) still reports closed */
function syncModal(): void {
  if (typeof document === 'undefined') return
  const open = document.querySelector(`[${MODAL_ATTR}]`) !== null
  if (open === reportedOpen) return
  reportedOpen = open
  for (const l of modalListeners) l(open)
}

/**
 * Hear when the first frame dialog opens and the last one closes (the bridge forwards it as the
 * protocol `modal` event, so the host inerts its own page and pauses its save watchdog).
 */
export function onFrameModal(listener: ModalListener): () => void {
  modalListeners.add(listener)
  reportedOpen =
    typeof document !== 'undefined' && document.querySelector(`[${MODAL_ATTR}]`) !== null
  return () => modalListeners.delete(listener)
}

/** the rest of the frame leaves the tree while a dialog is open (screen-reader browse mode too) */
function inertSiblings(mask: HTMLElement): () => void {
  const changed: Element[] = []
  for (const el of document.body.children) {
    if (el === mask || el.hasAttribute('inert')) continue
    el.setAttribute('inert', '')
    changed.push(el)
  }
  return () => {
    for (const el of changed) el.removeAttribute('inert')
  }
}

export interface FrameDialogHandle<T extends string> {
  /** shows a step in the same card; resolves with the chosen id (Escape: `cancelId`) */
  step(step: FrameDialogStep<T>, opts?: { closeOnAnswer?: boolean }): Promise<T>
  /** writes the dialog's own alert line (empty clears it) */
  setAlert(text: string): void
  /**
   * turns a choice of the shown step `aria-disabled` with its reason (a string), or enabled
   * (`null`), without re-rendering the step: the focus stays where it is
   */
  setChoiceDisabled(id: T, reason: string | null): void
  /** removes the dialog and returns the focus to where it was when it opened */
  close(): void
  readonly card: HTMLElement
}

/**
 * A modal dialog that can change its content in place (a confirmation step, a variant after a
 * failure) without stacking a second dialog. `frameAsk` is the one-step use.
 */
export function openFrameDialog<T extends string>(
  frame: FrameDialogFrame & { title?: string; body?: string },
): FrameDialogHandle<T> {
  const { mask, card, head, id } = build({
    title: frame.title ?? '',
    body: frame.body ?? '',
    marker: frame.marker,
    ...(frame.markerAttr ? { markerAttr: frame.markerAttr } : {}),
    ...(frame.maskClass ? { maskClass: frame.maskClass } : {}),
  })
  const title = head.querySelector<HTMLElement>('.ow-dlg-title')!
  title.tabIndex = -1
  const body = head.querySelector<HTMLElement>('.ow-dlg-body')!
  const details = document.createElement('div')
  details.className = 'ow-dlg-details'
  const slot = document.createElement('div')
  slot.className = 'ow-dlg-content'
  // the dialog's own alert node: fixed from the start, never display:none, collapsed when empty
  const alert = document.createElement('div')
  alert.className = 'ow-dlg-alert'
  alert.setAttribute('role', 'alert')
  const reasons = document.createElement('div')
  reasons.className = 'ow-dlg-reasons'
  head.append(details, slot, alert, reasons)
  const actions = document.createElement('div')
  actions.className = 'ow-dlg-actions'
  const x = closeButton(frame.closeLabel ?? webText(webLanguage(), 'webClose'))
  card.append(actions, x)

  const returnTo = document.activeElement as HTMLElement | null
  /** the last control of the card that held the focus (where a lost focus returns to) */
  let lastFocus: HTMLElement | null = null
  /** the shown step's buttons and whether each is runnable (`reason` = the line that explains) */
  const buttons = new Map<T, { el: HTMLButtonElement; disabled: boolean; reason?: string }>()
  let current: {
    step: FrameDialogStep<T>
    resolve: (id: T) => void
    closeOnAnswer: boolean
  } | null = null
  let closed = false

  const answer = (choice: T): void => {
    const pending = current
    current = null
    // a one-step dialog is gone before its caller hears the answer (frameAsk)
    if (pending?.closeOnAnswer) handle.close()
    pending?.resolve(choice)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (current) answer(current.step.cancelId)
      return
    }
    if (e.key !== 'Tab') return
    e.preventDefault()
    e.stopPropagation()
    const stops = tabStops(card)
    if (stops.length === 0) return
    const at = stops.indexOf(document.activeElement as HTMLElement)
    const step = e.shiftKey ? -1 : 1
    const next =
      at < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (at + step + stops.length) % stops.length
    stops[next]!.focus()
  }
  x.addEventListener('click', () => {
    if (current) answer(current.step.closeId ?? current.step.cancelId)
  })

  card.addEventListener('focusin', (e) => {
    lastFocus = e.target as HTMLElement
  })
  // a click on the backdrop or on inert page chrome drops the focus to the body: put it back
  card.addEventListener('focusout', (e) => {
    const to = e.relatedTarget
    if (to instanceof Node && mask.contains(to)) return
    // after the browser settled the new focus: a step that replaced the button has refocused
    setTimeout(() => {
      if (closed) return
      const at = document.activeElement
      if (at && at !== document.body && at !== document.documentElement) return
      const target = lastFocus?.isConnected && card.contains(lastFocus) ? lastFocus : null
      ;(target ?? tabStops(card)[0] ?? x).focus({ preventScroll: true })
    }, 0)
  })

  mask.setAttribute(MODAL_ATTR, '')
  document.addEventListener('keydown', onKey, true)
  document.body.append(mask)
  const restore = inertSiblings(mask)
  syncModal()
  frame.onChange?.()

  /**
   * The reason lines of the disabled choices, one per distinct sentence (two choices that are
   * blocked for the same reason, e.g. offline, share one line), each button described by its own.
   */
  function paintReasons(): void {
    reasons.replaceChildren()
    const lines = new Map<string, HTMLElement>()
    for (const [choiceId, b] of buttons) {
      if (!b.disabled) {
        b.el.removeAttribute('aria-disabled')
        b.el.removeAttribute('aria-describedby')
        continue
      }
      b.el.setAttribute('aria-disabled', 'true')
      if (!b.reason) {
        b.el.removeAttribute('aria-describedby')
        continue
      }
      let line = lines.get(b.reason)
      if (!line) {
        line = document.createElement('p')
        line.className = 'ow-dlg-reason'
        line.id = `${id}-why-${choiceId}`
        line.textContent = b.reason
        lines.set(b.reason, line)
        reasons.append(line)
      }
      b.el.setAttribute('aria-describedby', line.id)
    }
  }

  function render(step: FrameDialogStep<T>): void {
    // every step starts at the top: the title is the first thing in view
    mask.scrollTop = 0
    head.scrollTop = 0
    title.textContent = step.title
    body.textContent = step.body
    details.replaceChildren(
      ...(step.details ?? []).map((line) => {
        const d = document.createElement('p')
        d.className = 'ow-dlg-detail'
        d.textContent = line
        return d
      }),
    )
    slot.replaceChildren(...(step.content ? [step.content] : []))
    alert.textContent = step.alert ?? ''
    buttons.clear()
    actions.replaceChildren()
    const tones = tonesOf(step.choices, step.cancelId)
    const ordered = step.choices
      .map((c, i) => ({ c, i, tone: tones[i]! }))
      .sort((a, b) => RANK[a.tone] - RANK[b.tone] || a.i - b.i)
    // the first focus: the caller's pick, else the primary the caller named (never destructive),
    // else the way out. A primary that was only lifted for looks never takes the focus: Enter
    // on it could discard edits, so the non-destructive way out is the default there.
    const safeId =
      step.focusId ?? step.choices.find((c) => c.primary && !c.danger)?.id ?? step.cancelId
    let initial: HTMLElement | null = safeId === FOCUS_TITLE ? title : null
    let fallback: HTMLElement | null = null
    for (const { c, tone } of ordered) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.choice = c.id
      b.className = tone === 'neutral' ? 'ow-dlg-btn' : `ow-dlg-btn ${tone}`
      b.textContent = c.label
      buttons.set(c.id, {
        el: b,
        disabled: c.disabled === true,
        ...(c.reason ? { reason: c.reason } : {}),
      })
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') === 'true') return
        answer(c.id)
      })
      actions.append(b)
      if (c.id === safeId) initial = b
      else if (!fallback && tone !== 'danger') fallback = b
    }
    paintReasons()
    // preventScroll: the focused button may sit below the fold of a zoomed frame, the title not
    ;(initial ?? fallback ?? actions.querySelector('button') ?? x).focus({ preventScroll: true })
  }

  const handle: FrameDialogHandle<T> = {
    card,
    step(step, opts) {
      if (closed) return Promise.resolve(step.cancelId)
      const prior = current
      return new Promise<T>((resolve) => {
        current = { step, resolve, closeOnAnswer: opts?.closeOnAnswer === true }
        // a caller that replaces an unanswered step gets that step's way out
        prior?.resolve(prior.step.cancelId)
        render(step)
      })
    },
    setAlert(text) {
      alert.textContent = text
    },
    setChoiceDisabled(choiceId, reason) {
      const b = buttons.get(choiceId)
      if (!b) return
      b.disabled = reason !== null
      if (reason !== null) b.reason = reason
      else delete b.reason
      paintReasons()
    },
    close() {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', onKey, true)
      if (current) answer(current.step.cancelId)
      mask.remove()
      restore()
      syncModal()
      frame.onChange?.()
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true })
    },
  }
  return handle
}

/** modal choice; resolves with the chosen id, or `cancelId` on Escape */
export function frameAsk<T extends string>(opts: FrameDialogOptions<T>): Promise<T> {
  return openFrameDialog<T>(opts).step(opts, { closeOnAnswer: true })
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
