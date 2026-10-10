/**
 * Full screen for the slide show on the web. The browser only grants it to a request made while the
 * click or key that started the show is still fresh; when that activation is gone (the request is
 * refused) the show would silently stay in the frame. The hint tells the viewer how to get full
 * screen and keeps the request for their next click or key press, which is a real gesture.
 * Escape is never taken as that gesture (it is the way out of the show).
 */
import './fullscreen-hint.css'

const HINT_CLASS = 'ow-fs-hint'

export interface FullscreenControl {
  /** enter full screen; a refused request shows the hint instead of failing */
  enter(): Promise<void>
  /** leave full screen and drop the hint (the show ended) */
  leave(): Promise<void>
}

export function createFullscreenControl(label: () => string): FullscreenControl {
  let stop: (() => void) | null = null

  function hide(): void {
    stop?.()
    stop = null
  }

  function show(): void {
    if (stop) return
    const el = document.createElement('div')
    el.className = HINT_CLASS
    el.setAttribute('role', 'status')
    el.textContent = label()
    const request = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') return
      hide()
      // inside the click / key handler: this is the user gesture the browser wants
      void document.documentElement.requestFullscreen().catch(() => {})
    }
    const onChange = (): void => {
      if (document.fullscreenElement) hide()
    }
    document.addEventListener('pointerdown', request, true)
    document.addEventListener('keydown', request, true)
    document.addEventListener('fullscreenchange', onChange)
    document.body.append(el)
    stop = () => {
      document.removeEventListener('pointerdown', request, true)
      document.removeEventListener('keydown', request, true)
      document.removeEventListener('fullscreenchange', onChange)
      el.remove()
    }
  }

  return {
    async enter() {
      if (document.fullscreenElement) return
      try {
        await document.documentElement.requestFullscreen()
      } catch {
        show()
      }
    },
    async leave() {
      hide()
      try {
        if (document.fullscreenElement) await document.exitFullscreen()
      } catch {
        /* already out */
      }
    },
  }
}
