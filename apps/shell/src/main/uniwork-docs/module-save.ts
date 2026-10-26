import type { WebContents } from 'electron'
import type { TabKind } from '../../shared/tabs-api'

/**
 * The chip Retry and the conflict "save my version" ask the owning module for
 * its real explicit Save, the same call the shell's own File > Save makes for
 * that module, so the save ends in the module's user-save hook (never a
 * bypass). Needs no Electron runtime: index.ts injects the module entry points.
 */

export interface ModuleSaveTarget {
  kind: TabKind
  webContents: WebContents
}

export type UniworkModuleSaveMode = 'save' | 'capture'

export interface ModuleSaveDeps {
  /** the tab or detached window showing the path */
  targetForPath(path: string): ModuleSaveTarget | undefined
  /**
   * The tab path is a converted legacy copy: its own Save is a Save As, so the shell's
   * flush for the UniWork first save asks the module to write it in place instead.
   * Exact path identity only (never a file-name stem).
   */
  isConvertedPath?(path: string): boolean
  /** sheets' menu channel (IPC_CHANNELS.menuAction) */
  sheetsMenuChannel: string
  requestMarkdownSave(contents: WebContents, mode: 'save'): Promise<boolean>
  requestHtmlSave(contents: WebContents, mode: 'save'): Promise<boolean>
  flushPdfSave(contents: WebContents, options?: { explicit?: boolean }): Promise<boolean>
  /** G5-11: optional hook called when a save is triggered in capture mode */
  armCapture?(path: string): void
}

/**
 * false when nothing shows the path (or its view is gone): the caller falls
 * back. `onNotWritten` is called when the module says its Save wrote nothing.
 * `mode === 'capture'` flushes the working copy to disk without firing the
 * user-save hook.
 */
export function createModuleSaveRequester(
  deps: ModuleSaveDeps,
): (path: string, onNotWritten?: () => void, mode?: UniworkModuleSaveMode) => boolean {
  return (path, onNotWritten, mode = 'save') => {
    const target = deps.targetForPath(path)
    if (!target || target.webContents.isDestroyed()) return false
    const wc = target.webContents
    // the module reports its own failures through the user-save hook path; the
    // ones that answer "did not write" also tell the caller, which stops
    // waiting for a hook that will not come (docs, sheets and slides only send)
    const ignore = (run: Promise<boolean>): void =>
      void run.then(
        (wrote) => {
          if (!wrote) onNotWritten?.()
        },
        () => onNotWritten?.(),
      )
    const saveCommand = deps.isConvertedPath?.(path) ? 'save-in-place' : 'save'
    switch (target.kind) {
      case 'docs':
        if (mode === 'capture') deps.armCapture?.(path)
        wc.send('menu:command', saveCommand)
        return true
      case 'sheets':
        if (mode === 'capture') deps.armCapture?.(path)
        wc.send(deps.sheetsMenuChannel, saveCommand)
        return true
      case 'slides':
        if (mode === 'capture') deps.armCapture?.(path)
        wc.send('slides:menu', saveCommand)
        return true
      case 'markdown':
        if (mode === 'capture') deps.armCapture?.(path)
        ignore(deps.requestMarkdownSave(wc, 'save'))
        return true
      case 'html':
        if (mode === 'capture') deps.armCapture?.(path)
        ignore(deps.requestHtmlSave(wc, 'save'))
        return true
      case 'pdf':
        if (mode === 'capture') {
          deps.armCapture?.(path)
          ignore(deps.flushPdfSave(wc, { explicit: false }))
        } else {
          ignore(deps.flushPdfSave(wc))
        }
        return true
      default:
        return false
    }
  }
}
