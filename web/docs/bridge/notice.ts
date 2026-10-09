/**
 * In-frame dialogs the bridge raises on its own (the desktop raises the same ones from the main
 * process, e.g. the "modified by another program" Overwrite/Cancel box in docs-main.ts):
 *   - `ask()`: a choice (save conflict, discard unsaved changes before opening another document),
 *   - `showFatal()`: a blocking notice when the document could not be opened.
 *
 * Built from the renderer's own dialog classes (`.modal-backdrop` / `.modal` / `.modal-actions`
 * / `.btn-primary` in apps/docs/src/renderer/styles.css), so they follow the theme tokens with no
 * CSS of their own. Strings come from the renderer's app i18n shards in the current UI language.
 */
import { createI18n } from '@genoffice/i18n'
import { appStrings } from '../../../apps/docs/src/renderer/i18n/strings-app'
import { webLanguage } from './browser'

type AppKey = keyof (typeof appStrings)['zh']

const translate = createI18n(appStrings)

export function text(key: AppKey): string {
  return translate(webLanguage(), key)
}

export interface Choice<T extends string> {
  id: T
  label: AppKey
  primary?: boolean
  /** destructive (e.g. Overwrite): danger styling, never the initial focus */
  danger?: boolean
}

// ------------------------------------------------------------ open-dialog tracking

type ModalListener = (open: boolean) => void
let modalListener: ModalListener | null = null
let reportedOpen = false

/** the bridge reports open/closed to the host (protocol `modal`) so it can dim its own chrome */
export function onModalChange(listener: ModalListener | null): void {
  modalListener = listener
  reportedOpen = false
  syncModal()
}

/** read from the DOM, so a dialog removed by anyone (or a reset body) still reports closed */
function syncModal(): void {
  if (typeof document === 'undefined') return
  const open = document.querySelector('.docs-web-backdrop') !== null
  if (open === reportedOpen) return
  reportedOpen = open
  modalListener?.(open)
}

let dialogSeq = 0

function dialog(
  title: AppKey,
  body: AppKey,
  marker: string,
): { root: HTMLElement; box: HTMLElement } {
  const id = `docs-web-dialog-${++dialogSeq}`
  const root = document.createElement('div')
  root.className = 'modal-backdrop docs-web-backdrop'
  root.dataset.docsWeb = marker
  const box = document.createElement('div')
  box.className = 'modal gs-form'
  box.setAttribute('role', 'alertdialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-labelledby', `${id}-title`)
  box.setAttribute('aria-describedby', `${id}-desc`)
  const h = document.createElement('h2')
  h.id = `${id}-title`
  h.textContent = text(title)
  const p = document.createElement('p')
  p.className = 'modal-desc'
  p.id = `${id}-desc`
  p.textContent = text(body)
  box.append(h, p)
  root.append(box)
  return { root, box }
}

/**
 * Modal choice; resolves with the chosen id, or `cancelId` on Escape. Initial focus is the
 * cancel choice (the safe one), so a stray Enter never runs a destructive action; Tab stays
 * inside the dialog.
 */
export function ask<T extends string>(opts: {
  title: AppKey
  body: AppKey
  choices: Choice<T>[]
  cancelId: T
  marker: string
}): Promise<T> {
  return new Promise<T>((resolve) => {
    const { root, box } = dialog(opts.title, opts.body, opts.marker)
    const actions = document.createElement('div')
    actions.className = 'modal-actions'
    const buttons: HTMLButtonElement[] = []
    const finish = (id: T): void => {
      document.removeEventListener('keydown', onKey, true)
      root.remove()
      syncModal()
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
      // focus trap: cycle through the dialog's buttons only
      e.preventDefault()
      e.stopPropagation()
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const step = e.shiftKey ? -1 : 1
      const next = at < 0 ? 0 : (at + step + buttons.length) % buttons.length
      buttons[next].focus()
    }
    let focus: HTMLButtonElement | null = null
    for (const c of opts.choices) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.choice = c.id
      b.textContent = text(c.label)
      if (c.danger) b.className = 'danger'
      else if (c.primary) b.className = 'btn-primary'
      if (c.id === opts.cancelId) focus = b
      b.addEventListener('click', () => finish(c.id))
      actions.append(b)
      buttons.push(b)
    }
    box.append(actions)
    document.addEventListener('keydown', onKey, true)
    document.body.append(root)
    syncModal()
    const initial = focus ?? buttons.find((b) => !b.classList.contains('danger'))
    initial?.focus()
  })
}

const FATAL = 'fatal'

/** blocking notice over the editor (no buttons: the host decides what happens next) */
export function showFatal(body: AppKey): void {
  hideFatal()
  const { root } = dialog('appWebFatalTitle', body, FATAL)
  document.body.append(root)
  syncModal()
}

export function hideFatal(): void {
  for (const el of document.querySelectorAll(`[data-docs-web="${FATAL}"]`)) el.remove()
  syncModal()
}
