/**
 * The new-version bar (S6, EXPERIENCE.md › Thanh phiên bản mới) of every web frame: one `region`
 * above the editor with a sentence and link actions, never stacked. The sentence in the bar is the
 * visible copy and carries no live attribute: it is written once into the window's fixed live nodes
 * (polite for the new-version bars: information, dirty and AI; alert for the rest) so a screen
 * reader hears it exactly once.
 * An information bar hides itself after 8 s, but never while it has the focus or the pointer.
 */
import './remote-bar.css'
import { webLanguage } from '../../docs/bridge/browser'
import { webText } from './i18n/strings-web'

export type BarTone = 'info' | 'warn' | 'error'

export interface BarAction {
  id: string
  /** already translated */
  label: string
  onClick(): void
}

export interface BarSpec {
  tone: BarTone
  /** `lock` bars (revoke, delete, save blocked, reload failed) are the "document status" region */
  region: 'remote' | 'lock'
  /** already translated */
  text: string
  actions?: readonly BarAction[]
  /** the bar goes away by itself (information bar), unless it has focus or hover */
  autoHideMs?: number
}

export interface RemoteBar {
  show(spec: BarSpec): void
  hide(): void
  current(): BarSpec | null
}

/** how long an information bar stays (OQ-UX2, U-15) */
export const BAR_AUTO_HIDE_MS = 8000
const ALERT_CLEAR_MS = 1000
const ROOT_CLASS = 'uw-remote-bar-on'

function liveNode(doc: Document, role: 'status' | 'alert'): HTMLElement {
  const el = doc.createElement('div')
  el.className = 'uw-live'
  el.setAttribute('role', role)
  el.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite')
  el.setAttribute('aria-atomic', 'true')
  doc.body.append(el)
  return el
}

export function createRemoteBar(doc: Document = document): RemoteBar {
  let el: HTMLElement | null = null
  let spec: BarSpec | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let alertTimer: ReturnType<typeof setTimeout> | null = null
  let polite: HTMLElement | null = null
  let alert: HTMLElement | null = null
  let hovered = false

  function announce(text: string, tone: BarTone): void {
    // a newer version is news, not an emergency: the information bar and the dirty / AI warnings
    // wait for a pause instead of cutting in while the user types; only the error bars interrupt
    if (tone !== 'error') {
      polite ??= liveNode(doc, 'status')
      polite.textContent = ''
      polite.textContent = text
      return
    }
    alert ??= liveNode(doc, 'alert')
    alert.textContent = text
    // written once, then cleared: the bar keeps the visible copy
    if (alertTimer !== null) clearTimeout(alertTimer)
    alertTimer = setTimeout(() => {
      alertTimer = null
      if (alert) alert.textContent = ''
    }, ALERT_CLEAR_MS)
  }

  function clearTimer(): void {
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = null
  }

  function armAutoHide(ms: number): void {
    clearTimer()
    hideTimer = setTimeout(() => {
      hideTimer = null
      // focus or hover keep the bar; it is re-armed when they leave
      if (hovered || (el && el.contains(doc.activeElement))) return
      bar.hide()
    }, ms)
  }

  const bar: RemoteBar = {
    show(next) {
      const same = spec !== null && spec.text === next.text && spec.tone === next.tone
      bar.hide()
      spec = next
      const t = (k: 'uwRemoteRegion' | 'uwLockRegion') => webText(webLanguage(), k)
      const root = doc.createElement('section')
      root.className = `uw-remote-bar uw-remote-bar--${next.tone}`
      root.setAttribute('role', 'region')
      root.setAttribute(
        'aria-label',
        t(next.region === 'remote' ? 'uwRemoteRegion' : 'uwLockRegion'),
      )
      const text = doc.createElement('span')
      text.className = 'uw-remote-bar-text'
      text.textContent = next.text
      root.append(text)
      if (next.actions?.length) {
        const actions = doc.createElement('div')
        actions.className = 'uw-remote-bar-actions'
        for (const action of next.actions) {
          const b = doc.createElement('button')
          b.type = 'button'
          b.className = 'uw-remote-link'
          b.dataset.action = action.id
          b.textContent = action.label
          b.addEventListener('click', () => action.onClick())
          actions.append(b)
        }
        root.append(actions)
      }
      root.addEventListener('mouseenter', () => {
        hovered = true
      })
      root.addEventListener('mouseleave', () => {
        hovered = false
        if (spec?.autoHideMs) armAutoHide(spec.autoHideMs)
      })
      root.addEventListener('focusout', () => {
        if (spec?.autoHideMs) armAutoHide(spec.autoHideMs)
      })
      el = root
      doc.body.prepend(root)
      doc.documentElement.classList.add(ROOT_CLASS)
      // an unchanged sentence (the same bar shown again) is not read twice
      if (!same) announce(next.text, next.tone)
      if (next.autoHideMs) armAutoHide(next.autoHideMs)
    },
    hide() {
      clearTimer()
      hovered = false
      el?.remove()
      el = null
      spec = null
      doc.documentElement.classList.remove(ROOT_CLASS)
    },
    current: () => spec,
  }
  return bar
}
