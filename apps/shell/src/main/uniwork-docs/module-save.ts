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

export interface ModuleSaveDeps {
  /** the tab or detached window showing the path */
  targetForPath(path: string): ModuleSaveTarget | undefined
  /** sheets' menu channel (IPC_CHANNELS.menuAction) */
  sheetsMenuChannel: string
  requestMarkdownSave(contents: WebContents, mode: 'save'): Promise<boolean>
  requestHtmlSave(contents: WebContents, mode: 'save'): Promise<boolean>
  flushPdfSave(contents: WebContents): Promise<boolean>
}

/** false when nothing shows the path (or its view is gone): the caller falls back */
export function createModuleSaveRequester(deps: ModuleSaveDeps): (path: string) => boolean {
  return (path) => {
    const target = deps.targetForPath(path)
    if (!target || target.webContents.isDestroyed()) return false
    const wc = target.webContents
    // the module reports its own failures through the user-save hook path
    const ignore = (run: Promise<boolean>): void => void run.catch(() => undefined)
    switch (target.kind) {
      case 'docs':
        wc.send('menu:command', 'save')
        return true
      case 'sheets':
        wc.send(deps.sheetsMenuChannel, 'save')
        return true
      case 'slides':
        wc.send('slides:menu', 'save')
        return true
      case 'markdown':
        ignore(deps.requestMarkdownSave(wc, 'save'))
        return true
      case 'html':
        ignore(deps.requestHtmlSave(wc, 'save'))
        return true
      case 'pdf':
        ignore(deps.flushPdfSave(wc))
        return true
      default:
        return false
    }
  }
}
