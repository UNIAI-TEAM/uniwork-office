/**
 * In-frame choices the Sheets bridge raises itself (UNI-1016): the save conflict
 * (Overwrite / Reload latest / Cancel, like the Docs bridge and the desktop's "modified by another
 * program" box) and "discard unsaved changes?" before another workbook replaces this one.
 *
 * Built from the Sheets renderer's own dialog classes (`.dialog-backdrop`, `.format-cells-dialog`,
 * `.dialog-body`, `.dialog-actions`, `button.secondary` / `button.primary-action` in
 * apps/sheets/src/renderer/styles.css, as RecoveryDialog.tsx), so they follow the theme tokens
 * with no CSS of their own. Strings come from the Sheets app i18n shards (`appWeb*`) in the
 * current UI language.
 */
import { createI18n } from '@genoffice/i18n'
import { appStrings } from '../../../apps/sheets/src/renderer/i18n/strings-app'
import { showToast } from '../../../apps/sheets/src/renderer/toast-bus'
import { webLanguage } from '../../docs/bridge/browser'

export type SheetsAppKey = keyof (typeof appStrings)['zh']

const translate = createI18n(appStrings)

export function text(key: SheetsAppKey): string {
  return translate(webLanguage(), key)
}

export interface Choice<T extends string> {
  id: T
  label: SheetsAppKey
  primary?: boolean
}

export interface AskOptions<T extends string> {
  title: SheetsAppKey
  body: SheetsAppKey
  choices: Choice<T>[]
  cancelId: T
  /** `data-sheets-web` marker, for tests and e2e */
  marker: string
}

export type AskFn = <T extends string>(opts: AskOptions<T>) => Promise<T>

/** modal choice; resolves with the chosen id, or `cancelId` on Escape */
export const ask: AskFn = <T extends string>(opts: AskOptions<T>) =>
  new Promise<T>((resolve) => {
    const root = document.createElement('div')
    root.className = 'dialog-backdrop'
    root.dataset.sheetsWeb = opts.marker
    const box = document.createElement('div')
    box.className = 'format-cells-dialog recovery-dialog'
    box.setAttribute('role', 'alertdialog')
    box.setAttribute('aria-modal', 'true')
    const body = document.createElement('section')
    body.className = 'dialog-body'
    const h = document.createElement('h2')
    h.textContent = text(opts.title)
    const p = document.createElement('p')
    p.className = 'recovery-body'
    p.textContent = text(opts.body)
    body.append(h, p)
    const actions = document.createElement('div')
    actions.className = 'dialog-actions'
    let primary: HTMLButtonElement | null = null
    const finish = (id: T) => {
      window.removeEventListener('keydown', onKey, true)
      root.remove()
      resolve(id)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      finish(opts.cancelId)
    }
    for (const choice of opts.choices) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = choice.primary ? 'primary-action' : 'secondary'
      b.textContent = text(choice.label)
      b.dataset.choice = choice.id
      b.addEventListener('click', () => finish(choice.id))
      if (choice.primary) primary = b
      actions.append(b)
    }
    box.append(body, actions)
    root.append(box)
    window.addEventListener('keydown', onKey, true)
    document.body.append(root)
    ;(primary ?? actions.querySelector('button'))?.focus()
  })

/**
 * The engine stopped and was restarted (a Rust panic aborts the wasm instance, SH3): the open
 * workbook was reopened from its last saved bytes, so the user hears about it as a toast in the
 * Sheets renderer's own toast host. Nothing is said when no workbook was open.
 */
export function notifyEngineRecovered(recovery: { sessions: number }): void {
  if (recovery.sessions === 0) return
  showToast(text('appWebEngineRestarted'), 'error')
}
