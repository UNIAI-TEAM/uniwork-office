/**
 * Editor session hooks the web bridge drives on behalf of the host (GO-B3).
 *
 * The renderer has no "dirty changed" / "title changed" callback and no API to
 * start a save from outside; what it does have are the desktop close guard and
 * the native menu (App.tsx):
 *   - `onCloseCheck` -> the renderer answers synchronously through
 *     `reportCloseCheck({dirty, autoSave, filePath})` (side-effect free),
 *   - `onCloseSaveRequest` -> full save flow -> `reportCloseSaveResult(ok)`,
 *   - `onMenuCommand('save-as')` -> the Save As flow (-> saveDocxAs).
 * This module implements those three against the host:
 *   - host request `doc.closeCheck` -> the guard -> {dirty, autoSave},
 *   - `dirty`: the guard is queried shortly after each edit event and polled, and every
 *     change goes to the host,
 *   - `title`: document.title (App.tsx sets it to the file name),
 *   - `runSave()` / `runMenuCommand()` for the host's `save` / `saveAs` requests.
 */
import type { MenuCommand } from '../../../apps/docs/src/shared/ipc'
import type { FramePort } from './frame-port'

type CloseState = { dirty: boolean; autoSave: boolean; filePath?: string | null }
type MenuHandler = (command: MenuCommand, payload?: string) => void

export interface SessionOptions {
  /** dirty poll interval, ms (0 = no polling) */
  pollMs?: number
  /** how long the renderer's save flow may take before the host gets ok:false */
  saveTimeoutMs?: number
}

export function createSession(
  port: Pick<FramePort, 'setDirty' | 'setTitle' | 'handleCloseCheck'>,
  opts: SessionOptions = {},
) {
  const pollMs = opts.pollMs ?? 1000
  const saveTimeoutMs = opts.saveTimeoutMs ?? 180_000
  const checkHandlers = new Set<() => void>()
  const saveHandlers = new Set<() => void>()
  const menuHandlers = new Set<MenuHandler>()
  let lastReport: CloseState | null = null
  let saveWaiters: Array<(ok: boolean) => void> = []
  let timer: ReturnType<typeof setInterval> | null = null

  /** run the renderer's guard handlers; they answer synchronously via reportCloseCheck */
  function query(): CloseState | null {
    if (checkHandlers.size === 0) return null
    lastReport = null
    for (const h of checkHandlers) h()
    return lastReport
  }

  /** the client dedupes, so pushing an unchanged value is free */
  function pushDirty(): void {
    const state = query()
    if (state) port.setDirty(state.dirty)
  }

  // the poll is the safety net; an edit (typing, paste, a ribbon click) reports within ~150 ms
  // so the host's unsaved indicator and leave guard follow the editor closely
  let soon: ReturnType<typeof setTimeout> | null = null
  function pushDirtySoon(): void {
    if (soon !== null) return
    soon = setTimeout(() => {
      soon = null
      pushDirty()
    }, 150)
  }
  if (typeof document !== 'undefined') {
    for (const type of ['input', 'keyup', 'pointerup', 'paste', 'drop', 'cut']) {
      document.addEventListener(type, pushDirtySoon, true)
    }
  }

  port.handleCloseCheck(() => {
    const state = query()
    return { dirty: state?.dirty ?? false, autoSave: state?.autoSave ?? false }
  })

  let lastTitle: string | null = null
  function pushTitle(): void {
    const title = document.title
    if (title === lastTitle) return
    lastTitle = title
    port.setTitle(title)
  }
  if (typeof MutationObserver !== 'undefined' && document.head) {
    new MutationObserver(pushTitle).observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  return {
    /** the editor's dirty flag right now (false before the editor listens) */
    isDirty: () => query()?.dirty ?? false,
    pushDirty,
    pushTitle,
    /** the renderer's full save flow (close-guard "Save"); false when no editor listens */
    runSave(): Promise<boolean> {
      if (saveHandlers.size === 0) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(t)
          saveWaiters = saveWaiters.filter((w) => w !== finish)
          resolve(ok)
        }
        const t = setTimeout(() => finish(false), saveTimeoutMs)
        saveWaiters.push(finish)
        for (const h of saveHandlers) h()
      }).finally(pushDirty)
    },
    /** dispatch a menu command to the renderer; false when no editor listens */
    runMenuCommand(command: MenuCommand): boolean {
      for (const h of menuHandlers) h(command)
      return menuHandlers.size > 0
    },
    desktop: {
      onCloseCheck(handler: () => void): () => void {
        checkHandlers.add(handler)
        if (timer === null && pollMs > 0) timer = setInterval(pushDirty, pollMs)
        return () => {
          checkHandlers.delete(handler)
          if (checkHandlers.size === 0 && timer !== null) {
            clearInterval(timer)
            timer = null
          }
        }
      },
      reportCloseCheck(state: CloseState): void {
        lastReport = state
      },
      onCloseSaveRequest(handler: () => void): () => void {
        saveHandlers.add(handler)
        return () => {
          saveHandlers.delete(handler)
        }
      },
      reportCloseSaveResult(ok: boolean): void {
        for (const w of saveWaiters.slice()) w(ok)
      },
      onMenuCommand(handler: MenuHandler): () => void {
        menuHandlers.add(handler)
        return () => {
          menuHandlers.delete(handler)
        }
      },
    },
  }
}

export type Session = ReturnType<typeof createSession>
