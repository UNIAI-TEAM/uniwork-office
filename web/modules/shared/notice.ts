/**
 * In-frame dialogs of the text-module bridges (Markdown, HTML), the counterpart of the Docs
 * frame's web/docs/bridge/notice.ts:
 *   - `ask()`: a choice (save conflict: Cancel / Reload latest / Overwrite),
 *   - `showFatal()`: a blocking notice when the document could not be opened.
 *
 * Built from the shared picture-dialog chrome of @genoffice/ui (`.gs-imgdlg-*` in
 * image-dialogs.css: theme tokens, no CSS of its own here), so the box looks like the rest of
 * the editors' dialogs in both themes. Strings: ./i18n/strings-web.ts in the UI language.
 */
import '@genoffice/ui/image-dialogs.css'
import { webLanguage } from '../../docs/bridge/browser'
import { webText, type WebStringKey } from './i18n/strings-web'

export function text(key: WebStringKey): string {
  return webText(webLanguage(), key)
}

export interface Choice<T extends string> {
  id: T
  label: WebStringKey
  primary?: boolean
}

const MARKER = 'data-office-web'

function dialog(
  title: WebStringKey,
  body: WebStringKey,
  marker: string,
  details: readonly string[] = [],
): { root: HTMLElement; box: HTMLElement } {
  const root = document.createElement('div')
  root.className = 'gs-imgdlg-mask'
  root.setAttribute(MARKER, marker)
  const box = document.createElement('div')
  box.className = 'gs-imgdlg'
  box.setAttribute('role', 'alertdialog')
  box.setAttribute('aria-modal', 'true')
  box.style.maxWidth = 'min(440px, calc(100vw - 32px))'
  const h = document.createElement('div')
  h.className = 'gs-imgdlg-title'
  h.id = `${marker}-title`
  h.textContent = text(title)
  const p = document.createElement('div')
  p.className = 'gs-imgdlg-hint'
  p.id = `${marker}-body`
  p.textContent = text(body)
  box.setAttribute('aria-labelledby', h.id)
  box.setAttribute('aria-describedby', p.id)
  box.append(h, p)
  for (const line of details) {
    const d = document.createElement('div')
    d.className = 'gs-imgdlg-hint'
    d.textContent = line
    box.append(d)
  }
  root.append(box)
  return { root, box }
}

/** modal choice; resolves with the chosen id, or `cancelId` on Escape */
export function ask<T extends string>(opts: {
  title: WebStringKey
  body: WebStringKey
  choices: Choice<T>[]
  cancelId: T
  marker: string
  /** extra lines under the body (already translated: names, times) */
  details?: readonly string[]
}): Promise<T> {
  return new Promise<T>((resolve) => {
    const { root, box } = dialog(opts.title, opts.body, opts.marker, opts.details)
    const actions = document.createElement('div')
    actions.className = 'gs-imgdlg-actions'
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
      b.className = c.primary ? 'gs-imgdlg-btn primary' : 'gs-imgdlg-btn'
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

/** blocking notice over the editor (no buttons: the host decides what happens next) */
export function showFatal(body: WebStringKey): void {
  hideFatal()
  const { root } = dialog('webFatalTitle', body, FATAL)
  document.body.append(root)
}

export function hideFatal(): void {
  for (const el of document.querySelectorAll(`[${MARKER}="${FATAL}"]`)) el.remove()
}
