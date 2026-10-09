/**
 * In-frame dialogs of the PDF web bridge (GO-B4): the save-conflict choice, the merge "add another
 * PDF?" prompt and the blocking open-failure notice. The desktop raises the same moments from the
 * main process (native dialogs). Built from the PDF renderer's own modal classes
 * (`.pdf-modal-mask` / `.pdf-modal` / `.pdf-modal-btn` in apps/pdf/src/renderer/styles.css), so
 * they follow the theme tokens; strings come from the renderer's web shard in the UI language.
 */
import { createI18n, type Params } from '@genoffice/i18n'
import { webStrings } from '../../../apps/pdf/src/renderer/i18n/strings-web'
import { webLanguage } from '../../docs/bridge/browser'

export type WebKey = keyof (typeof webStrings)['zh']

const translate = createI18n(webStrings)

export function text(key: WebKey, params?: Params): string {
  return translate(webLanguage(), key, params)
}

export interface Choice<T extends string> {
  id: T
  label: WebKey
  primary?: boolean
}

const MARK = 'pdfWeb'

function dialog(title: WebKey, body: string, marker: string) {
  const root = document.createElement('div')
  root.className = 'pdf-modal-mask'
  root.dataset[MARK] = marker
  const box = document.createElement('div')
  box.className = 'pdf-modal'
  box.setAttribute('role', 'alertdialog')
  box.setAttribute('aria-modal', 'true')
  const h = document.createElement('div')
  h.className = 'pdf-modal-title'
  h.id = `pdf-web-${marker}-title`
  h.textContent = text(title)
  const p = document.createElement('div')
  p.className = 'pdf-modal-hint'
  p.id = `pdf-web-${marker}-body`
  p.textContent = body
  box.setAttribute('aria-labelledby', h.id)
  box.setAttribute('aria-describedby', p.id)
  box.append(h, p)
  root.append(box)
  return { root, box }
}

/** modal choice; resolves with the chosen id, or `cancelId` on Escape */
export function ask<T extends string>(opts: {
  title: WebKey
  body: WebKey
  params?: Params
  choices: Choice<T>[]
  cancelId: T
  marker: string
}): Promise<T> {
  return new Promise<T>((resolve) => {
    const { root, box } = dialog(opts.title, text(opts.body, opts.params), opts.marker)
    const actions = document.createElement('div')
    actions.className = 'pdf-modal-actions'
    const finish = (id: T): void => {
      document.removeEventListener('keydown', onKey, true)
      root.remove()
      resolve(id)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      finish(opts.cancelId)
    }
    let focus: HTMLButtonElement | null = null
    for (const c of opts.choices) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.choice = c.id
      b.className = c.primary ? 'pdf-modal-btn primary' : 'pdf-modal-btn'
      b.textContent = text(c.label)
      if (c.primary) focus = b
      b.addEventListener('click', () => finish(c.id))
      actions.append(b)
    }
    box.append(actions)
    document.addEventListener('keydown', onKey, true)
    document.body.append(root)
    focus?.focus()
  })
}

const FATAL = 'fatal'

/** blocking notice over the viewer (no buttons: the host decides what happens next) */
export function showFatal(body: WebKey): void {
  hideFatal()
  document.body.append(dialog('webFatalTitle', text(body), FATAL).root)
}

export function hideFatal(): void {
  for (const el of document.querySelectorAll(`[data-pdf-web="${FATAL}"]`)) el.remove()
}
