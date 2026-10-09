/**
 * In-frame dialogs of the Slides web module: what the desktop raises from the main process
 * with dialog.showMessageBox (chart simplification, media warnings: HostIO.confirm) and the
 * bridge's own prompts (save conflict, unsaved changes, fatal open). Built from the Slides
 * renderer's dialog classes (`.modal-backdrop` / `.modal` / `.modal-actions` / `.btn-primary`
 * in apps/slides/src/renderer/styles.css), so they follow the theme tokens with no CSS of their
 * own. Bridge-owned strings come from the renderer's `web` i18n shards in the UI language.
 */
import { createI18n } from '@genoffice/i18n'
import { webStrings } from '../../../apps/slides/src/renderer/i18n/strings-web'
import { webLanguage } from '../../docs/bridge/browser'

export type WebKey = keyof (typeof webStrings)['zh']

const translate = createI18n(webStrings)

export function text(key: WebKey): string {
  return translate(webLanguage(), key)
}

const MARKER = 'data-slides-web'

function frame(
  title: string,
  body: string,
  marker: string,
): { root: HTMLElement; box: HTMLElement } {
  const root = document.createElement('div')
  root.className = 'modal-backdrop'
  root.setAttribute(MARKER, marker)
  const box = document.createElement('div')
  box.className = 'modal'
  box.setAttribute('role', 'alertdialog')
  box.setAttribute('aria-modal', 'true')
  const h = document.createElement('h2')
  h.textContent = title
  box.append(h)
  if (body) {
    const p = document.createElement('p')
    p.className = 'modal-desc'
    p.textContent = body
    box.append(p)
  }
  root.append(box)
  return { root, box }
}

/**
 * Modal choice with literal strings; resolves with the index of the chosen button, `cancelId`
 * on Escape. `defaultId` gets the primary style and the initial focus.
 */
export function choose(opts: {
  title: string
  body: string
  buttons: readonly string[]
  defaultId?: number
  cancelId?: number
  marker: string
}): Promise<number> {
  return new Promise<number>((resolve) => {
    const { root, box } = frame(opts.title, opts.body, opts.marker)
    const actions = document.createElement('div')
    actions.className = 'modal-actions'
    const cancelId = opts.cancelId ?? opts.buttons.length - 1
    const finish = (i: number): void => {
      document.removeEventListener('keydown', onKey, true)
      root.remove()
      resolve(i)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      finish(cancelId)
    }
    let focus: HTMLButtonElement | null = null
    opts.buttons.forEach((label, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.choice = String(i)
      b.textContent = label
      if (i === (opts.defaultId ?? 0)) {
        b.className = 'btn-primary'
        focus = b
      }
      b.addEventListener('click', () => finish(i))
      actions.append(b)
    })
    box.append(actions)
    document.addEventListener('keydown', onKey, true)
    document.body.append(root)
    ;(focus as HTMLButtonElement | null)?.focus()
  })
}

/** choose() over bridge-owned strings; resolves with the chosen id */
export async function ask<T extends string>(opts: {
  title: WebKey
  body: WebKey
  choices: ReadonlyArray<{ id: T; label: WebKey; primary?: boolean }>
  cancelId: T
  marker: string
}): Promise<T> {
  const primary = opts.choices.findIndex((c) => c.primary)
  const i = await choose({
    title: text(opts.title),
    body: text(opts.body),
    buttons: opts.choices.map((c) => text(c.label)),
    defaultId: primary < 0 ? 0 : primary,
    cancelId: opts.choices.findIndex((c) => c.id === opts.cancelId),
    marker: opts.marker,
  })
  return opts.choices[i]?.id ?? opts.cancelId
}

const FATAL = 'fatal'

/** blocking notice over the editor (no buttons: the host decides what happens next) */
export function showFatal(body: WebKey): void {
  hideFatal()
  document.body.append(frame(text('webFatalTitle'), text(body), FATAL).root)
}

export function hideFatal(): void {
  for (const el of document.querySelectorAll(`[${MARKER}="${FATAL}"]`)) el.remove()
}
