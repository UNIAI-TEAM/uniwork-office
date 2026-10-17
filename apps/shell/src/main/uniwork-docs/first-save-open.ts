import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { UNIWORK_DOC_CHANNELS } from '../../shared/home-api'
import { pathKey } from '../../shared/path-key'

/**
 * SAVE-01 r2 (S01-R1-6): File > Save to UniWork on an unbound tab asks the
 * shell renderer to open the SaveDialog (`uniwork-doc:first-save-open`), and
 * this module owns the handshake that tells "the dialog is up" from "nobody
 * heard it": the renderer invokes `uniwork-doc:first-save-open-ack` (the
 * `uniworkFirstSaveOpenAck` preload method) the moment its dialog opens.
 * Without the ack the menu answer `true` was a lie - a missing listener or a
 * destroyed contents looked exactly like a handled save, and the user could
 * retry forever against silence. `requestFirstSaveOpen` waits for the ack and
 * answers false past FIRST_SAVE_OPEN_WAIT_MS (or immediately for a destroyed
 * contents / a send that threw), so the caller falls back to the visible
 * warning.
 *
 * `saveTabToUniWork` is the routing of File > Save to UniWork, lifted out of
 * index.ts so its answers are exercised: it returns true only when someone
 * actually took the save (a bound path whose module Save ran, a bridge
 * session, or an acknowledged dialog), false otherwise - the caller shows the
 * warning.
 */

/** how long main waits for the renderer's open ack before warning (10 s) */
export const FIRST_SAVE_OPEN_WAIT_MS = 10_000

/** `${webContents.id}|${pathKey(path)}` -> `settle(opened)` of that send's waiter */
const pendingAcks = new Map<string, (opened: boolean) => void>()

function ackKey(senderId: number, path: string): string {
  return `${senderId}${pathKey(path)}`
}

/**
 * The renderer's `uniwork-doc:first-save-open-ack` invoke: releases the
 * `requestFirstSaveOpen` waiter of exactly this contents + path. An unknown
 * pair (a stale dialog, a hand-typed invoke) is a no-op.
 */
export function registerFirstSaveOpenAck(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle(UNIWORK_DOC_CHANNELS.firstSaveOpenAck, (event: IpcMainInvokeEvent, raw: unknown) => {
    const path = typeof raw === 'string' ? raw : ''
    if (!path) return
    const key = ackKey(event.sender.id, path)
    const settle = pendingAcks.get(key)
    if (settle) {
      pendingAcks.delete(key)
      settle(true)
    }
  })
}

/** test seam: resolves a waiter directly (the wiring test has no ipcRenderer) */
export function acknowledgeFirstSaveOpen(senderId: number, path: string): void {
  const key = ackKey(senderId, path)
  const settle = pendingAcks.get(key)
  if (settle) {
    pendingAcks.delete(key)
    settle(true)
  }
}

/**
 * Sends the first-save-open push to `wc` and answers true only once the
 * renderer acknowledged the dialog is opening. Destroyed contents, a send
 * that threw, or no ack inside FIRST_SAVE_OPEN_WAIT_MS answer false, so the
 * caller shows the save-failure warning instead of a silent no-op.
 */
export function requestFirstSaveOpen(
  wc: Pick<WebContents, 'id' | 'isDestroyed' | 'send'>,
  path: string,
  timeoutMs = FIRST_SAVE_OPEN_WAIT_MS,
): Promise<boolean> {
  if (wc.isDestroyed()) return Promise.resolve(false)
  // Promise.withResolvers is outside this target's lib; the executor form is
  // required here anyway - the send runs inside the waiter's registration
  return new Promise<boolean>((resolve) => {
    const key = ackKey(wc.id, path)
    // `settle(opened)` finishes this waiter once and drops its slot; an ack
    // settles true, a timeout / supersede / dead send settles false
    const settle = (opened: boolean) => {
      clearTimeout(timer)
      if (pendingAcks.get(key) === settle) pendingAcks.delete(key)
      resolve(opened)
    }
    const timer = setTimeout(() => settle(false), timeoutMs)
    ;(timer as { unref?: () => void }).unref?.()
    // a second request for the same pair supersedes the first: the older
    // waiter resolves false (nothing opened for it) rather than leaking or
    // claiming the newer slot's ack
    pendingAcks.get(key)?.(false)
    pendingAcks.set(key, settle)
    try {
      wc.send(UNIWORK_DOC_CHANNELS.firstSaveOpen, { path })
    } catch {
      settle(false)
    }
  })
}

export interface SaveTabToUniWorkDeps {
  /** the active tab's file, undefined when nothing can be saved */
  activeFilePath(): string | undefined
  /** the path is a bound UniWork working copy (module Save is the answer) */
  isBound(path: string): boolean
  /** the module's own Save; false = no tab shows the path (nothing ran) */
  requestModuleSave(path: string): boolean
  /** a live office-bridge session owns this path (its own save flow runs) */
  liveBridgeSession(path: string): boolean
  /** the shell window's contents (the SaveDialog host); null = no shell */
  shellContents(): Pick<WebContents, 'id' | 'isDestroyed' | 'send'> | null
  /** the user-visible failure (File > Save could not run) */
  warn(): void
  /** the bridge-session save path (unchanged behaviour) */
  saveViaBridge(filePath: string): Promise<boolean>
}

/**
 * File > Save to UniWork for the active tab. True only when the save was
 * handed to someone who will act on it: a bound path runs the module's own
 * Save (its answer is checked - a false return means nobody saved and the
 * caller warns), an unbound path opens the SaveDialog (acknowledged), and a
 * bridge session saves through the bridge.
 */
export async function saveTabToUniWork(deps: SaveTabToUniWorkDeps): Promise<boolean> {
  const filePath = deps.activeFilePath()
  if (!filePath) {
    deps.warn()
    return false
  }
  // a bound UniWork working copy saves through its module hook (the usual
  // Ctrl+S path: write to disk, then the save queue uploads + commits). A
  // false answer means the module could not be reached - nobody handled this
  // save, so it must not report success (S01-R1-6)
  if (deps.isBound(filePath)) {
    if (!deps.requestModuleSave(filePath)) {
      deps.warn()
      return false
    }
    return true
  }
  // SAVE-01: an unbound tab asks the renderer for a name and a destination
  // (default My Folder); the dialog answers through uniwork-doc:first-save.
  // The renderer's open ack is the difference between a dialog and silence:
  // no listener / destroyed contents / a dead renderer warn instead (S01-R1-6)
  if (!deps.liveBridgeSession(filePath)) {
    const shellWc = deps.shellContents()
    if (!shellWc || !(await requestFirstSaveOpen(shellWc, filePath))) {
      deps.warn()
      return false
    }
    return true
  }
  return deps.saveViaBridge(filePath)
}
