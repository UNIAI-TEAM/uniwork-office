/**
 * In-memory HostIO for tests and headless use: pickers answer from queues, message
 * boxes from scripted responses, the clipboard and the "disk" are maps, and every
 * call is logged so a test can assert what the session asked the host for.
 */
import { savePptx, type OpenedPptx } from '@genoffice/pptx-engine'
import type {
  HostIO,
  HostMessageBox,
  ImagePickPurpose,
  MediaPickKind,
  PickedFile,
  SaveEvent,
} from './host-io'

export interface MemoryHostCall {
  kind: string
  detail?: unknown
}

export class MemoryHostIO implements HostIO {
  /** Files returned by the next pickImage calls (null = user canceled) */
  readonly imagePicks: Array<PickedFile | null> = []
  /** Files returned by the next pickMedia calls (null = user canceled) */
  readonly mediaPicks: Array<PickedFile | null> = []
  /** Button indexes returned by the next confirm calls (default 0) */
  readonly confirmResponses: number[] = []
  /** Targets returned by the next saveAs calls (null = canceled) */
  readonly saveAsTargets: Array<string | null> = []
  /** Natural size reported for every picked image (null = undecodable) */
  imageSizeResult: { width: number; height: number } | null = { width: 400, height: 300 }
  poster: { bytes: Uint8Array; ext: string } | undefined = undefined
  author = 'User'
  untitledPath = 'Untitled.pptx'
  /** Saved decks by target */
  readonly files = new Map<string, Uint8Array>()
  readonly recentPaths: string[] = []
  readonly calls: MemoryHostCall[] = []

  private readonly markers = new Set<string>()
  clipboardImage: Uint8Array | null = null
  clipboardText = ''

  readonly clipboard = {
    writeMarker: (format: string): void => {
      this.calls.push({ kind: 'clipboard.writeMarker', detail: format })
      this.markers.add(format)
    },
    hasMarker: (format: string): boolean => this.markers.has(format),
    readImagePng: (): Uint8Array | null => this.clipboardImage,
    hasImage: (): boolean => this.clipboardImage !== null,
    readText: (): string => this.clipboardText,
  }

  /** Simulate another application copying: our markers are gone. */
  externalCopy(content: { text?: string; image?: Uint8Array }): void {
    this.markers.clear()
    this.clipboardText = content.text ?? ''
    this.clipboardImage = content.image ?? null
  }

  async pickImage(purpose: ImagePickPurpose): Promise<PickedFile | null> {
    this.calls.push({ kind: 'pickImage', detail: purpose })
    return this.imagePicks.shift() ?? null
  }

  async pickMedia(kind: MediaPickKind): Promise<PickedFile | null> {
    this.calls.push({ kind: 'pickMedia', detail: kind })
    return this.mediaPicks.shift() ?? null
  }

  async imageSize(): Promise<{ width: number; height: number } | null> {
    return this.imageSizeResult
  }

  async readMediaPoster(
    file: PickedFile,
    kind: 'video' | 'model3d',
  ): Promise<{ bytes: Uint8Array; ext: string } | undefined> {
    this.calls.push({ kind: 'readMediaPoster', detail: { name: file.name, kind } })
    return this.poster
  }

  async confirm(box: HostMessageBox): Promise<number> {
    this.calls.push({ kind: 'confirm', detail: box })
    return this.confirmResponses.shift() ?? 0
  }

  async recent(): Promise<string[]> {
    return [...this.recentPaths]
  }

  commentAuthor(): string {
    return this.author
  }

  readonly saveTarget = {
    untitled: (): string => this.untitledPath,
    saveAs: async (currentPath: string, defaultName: string): Promise<string | null> => {
      this.calls.push({ kind: 'saveAs', detail: { currentPath, defaultName } })
      return this.saveAsTargets.shift() ?? null
    },
  }

  async writeDeck(opened: OpenedPptx, target: string): Promise<void> {
    this.files.set(target, await savePptx(opened))
  }

  async saved(event: SaveEvent): Promise<void> {
    this.calls.push({ kind: 'saved', detail: { kind: event.kind, path: event.path } })
    const i = this.recentPaths.indexOf(event.path)
    if (i >= 0) this.recentPaths.splice(i, 1)
    this.recentPaths.unshift(event.path)
  }
}
