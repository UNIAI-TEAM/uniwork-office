/**
 * HostIO: everything a session handler needs from the environment it runs in — file
 * pickers, message boxes, the system clipboard, recent files and the save target.
 *
 * Electron main implements it with dialog/clipboard/nativeImage (main/electron-host-io.ts);
 * the web frame implements it with file inputs, the Clipboard API, in-frame dialogs and the
 * host's save requests. MemoryHostIO (memory-host-io.ts) is the scripted test double.
 */
import type { OpenedPptx } from '@genoffice/pptx-engine'
import type { Session } from './state'

/** A file the user picked. `path` is set only where the host has a file system path. */
export interface PickedFile {
  bytes: Uint8Array
  /** File name as shown to the user (media elements keep it as their name) */
  name: string
  /** Lower-case extension without the dot */
  ext: string
  path?: string
}

/** 'insert' = Insert Picture / picture fill / background image; 'replace' = Change Picture. */
export type ImagePickPurpose = 'insert' | 'replace'
export type MediaPickKind = 'video' | 'audio' | 'model3d'

/** A modal message box; the host answers with the index of the chosen button. */
export interface HostMessageBox {
  type: 'warning' | 'question' | 'info'
  message: string
  detail: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
}

export interface HostClipboard {
  /** Write an app marker format (optionally carrying `value`, e.g. the copy's token): an
   *  external copy overwrites it, so paste can tell which copy is newer */
  writeMarker(format: string, value?: string): void
  /** Our marker format is still on the system clipboard (and carries `value`, when given) */
  hasMarker(format: string, value?: string): boolean
  /** Clipboard image as PNG bytes, or null when the clipboard holds no image */
  readImagePng(): Uint8Array | null
  /** Cheap probe: an image is on the clipboard (no decode) */
  hasImage(): boolean
  readText(): string
}

export interface HostIO {
  pickImage(purpose: ImagePickPurpose): Promise<PickedFile | null>
  pickMedia(kind: MediaPickKind): Promise<PickedFile | null>
  /** Bytes of a file the renderer named by path (a file dropped on the canvas) */
  readPath(path: string): Promise<Uint8Array>
  /** Natural pixel size of a picked image (null when the host cannot decode it) */
  imageSize(file: PickedFile): Promise<{ width: number; height: number } | null>
  /** Poster frame for a picked video / 3D model; undefined = the element draws a solid placeholder */
  readMediaPoster(
    file: PickedFile,
    kind: 'video' | 'model3d',
  ): Promise<{ bytes: Uint8Array; ext: string } | undefined>
  confirm(box: HostMessageBox): Promise<number>
  clipboard: HostClipboard
  recent(): Promise<string[]>
  /** Author name written into new comments */
  commentAuthor(): string
  saveTarget: {
    /** Target for the first save of an untitled deck (the desktop lands it in the drafts folder) */
    untitled(): string
    /** Save As target; null = the user canceled */
    saveAs(currentPath: string, defaultName: string): Promise<string | null>
  }
  /** Serialize the deck to `target` (throws on failure; the handler reports it) */
  writeDeck(opened: OpenedPptx, target: string): Promise<void>
  /**
   * Bookkeeping when the deck gets a path: 'untitled' right after the untitled target was
   * assigned (before the write), 'save' / 'saveAs' after a successful write (recent list,
   * recovery copies, attached windows).
   */
  saved(event: SaveEvent): Promise<void>
}

export interface SaveEvent {
  kind: 'untitled' | 'save' | 'saveAs'
  session: Session
  path: string
}

/** What every session handler receives: the calling client and its host. */
export interface HandlerContext {
  clientId: number
  host: HostIO
}
