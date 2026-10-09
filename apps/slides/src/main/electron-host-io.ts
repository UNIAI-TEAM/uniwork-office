/**
 * Electron implementation of the session HostIO: native file dialogs (with the
 * per-dialog directory memory), message boxes parented to the focused window, the
 * system clipboard, nativeImage sizes/thumbnails and file-system saves. The recent
 * list, drafts folder and recovery-copy bookkeeping stay with slides-main, which
 * passes them in as `files`.
 */
import { clipboard, dialog, nativeImage } from 'electron'
import { readFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { savePptxToFile } from '@genoffice/pptx-engine'
import { showOpenDialogWithMemory } from '@genoffice/electron-utils'
import type {
  HostIO,
  HostMessageBox,
  ImagePickPurpose,
  MediaPickKind,
  PickedFile,
  SaveEvent,
} from '../session'
import { baseName } from '../shared/base-name'
import { AUDIO_EXTS, VIDEO_EXTS } from '../shared/media-kinds'
import { ELEMENT_CLIPBOARD_FORMAT, elementClipboardMarkerMatches } from './element-clipboard'
import { tm } from './i18n-main'
import { dialogParent } from './session-state'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff']

/** The parts of the save path that live with slides-main's recent/drafts/recovery state. */
export interface ElectronFileHooks {
  recent(): Promise<string[]>
  untitledTarget(): string
  saveAsTarget(currentPath: string, defaultName: string): Promise<string | null>
  saved(event: SaveEvent): Promise<void>
}

async function pickFile(options: {
  title: string
  filters: Array<{ name: string; extensions: string[] }>
}): Promise<PickedFile | null> {
  const r = await showOpenDialogWithMemory(dialog, dialogParent(), {
    title: options.title,
    properties: ['openFile' as const],
    filters: options.filters,
  })
  if (r.canceled || !r.filePaths[0]) return null
  const path = r.filePaths[0]
  return {
    bytes: new Uint8Array(await readFile(path)),
    name: baseName(path),
    ext: path.split('.').pop()!.toLowerCase(),
    path,
  }
}

/** Comment author name: system username, falling back to a generic "User" label. */
function commentAuthorName(): string {
  try {
    return userInfo().username || 'User'
  } catch {
    return 'User'
  }
}

export function createElectronHostIO(files: ElectronFileHooks): HostIO {
  return {
    pickImage: (purpose: ImagePickPurpose) =>
      pickFile({
        title: purpose === 'replace' ? tm('dlgReplacePicture') : tm('dlgInsertImage'),
        filters: [{ name: tm('filterImages'), extensions: IMAGE_EXTENSIONS }],
      }),

    pickMedia: (kind: MediaPickKind) =>
      pickFile(
        kind === 'video'
          ? {
              title: tm('dlgInsertVideo'),
              filters: [{ name: tm('filterVideo'), extensions: [...VIDEO_EXTS] }],
            }
          : kind === 'audio'
            ? {
                title: tm('dlgInsertAudio'),
                filters: [{ name: tm('filterAudio'), extensions: [...AUDIO_EXTS] }],
              }
            : {
                title: tm('dlgInsert3d'),
                filters: [{ name: tm('filter3d'), extensions: ['glb', 'gltf'] }],
              },
      ),

    readPath: async (path) => new Uint8Array(await readFile(path)),

    imageSize: async (file) => {
      if (!file.path) return null
      const img = nativeImage.createFromPath(file.path)
      return img.isEmpty() ? null : img.getSize()
    },

    // Video poster frame / 3D placeholder: the system thumbnail (QuickLook on macOS)
    readMediaPoster: async (file, kind) => {
      if (!file.path) return undefined
      try {
        const size = kind === 'video' ? { width: 960, height: 540 } : { width: 640, height: 640 }
        const thumb = await nativeImage.createThumbnailFromPath(file.path, size)
        if (!thumb.isEmpty()) return { bytes: new Uint8Array(thumb.toPNG()), ext: 'png' }
      } catch {
        /* no thumbnail: the element keeps its placeholder fill */
      }
      return undefined
    },

    confirm: async (box: HostMessageBox) => {
      const parent = dialogParent()
      const options = { ...box }
      const r = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      return r.response
    },

    clipboard: {
      writeMarker: (format, value = '1') => clipboard.writeBuffer(format, Buffer.from(value)),
      // Our marker still present = the last copy came from this app -> use internal element paste
      // (on macOS custom formats don't appear in availableFormats, so check via readBuffer).
      // An element copy carries its token, in the marker buffer or the HTML image twin.
      hasMarker: (format, value) => {
        if (value !== undefined && format === ELEMENT_CLIPBOARD_FORMAT)
          return elementClipboardMarkerMatches(value)
        try {
          const buf = clipboard.readBuffer(format)
          return value === undefined ? buf.length > 0 : buf.equals(Buffer.from(value))
        } catch {
          return false
        }
      },
      readImagePng: () => {
        const img = clipboard.readImage()
        return img.isEmpty() ? null : new Uint8Array(img.toPNG())
      },
      hasImage: () => clipboard.availableFormats().some((f) => f.startsWith('image/')),
      readText: () => clipboard.readText(),
    },

    recent: () => files.recent(),
    commentAuthor: commentAuthorName,
    saveTarget: {
      untitled: () => files.untitledTarget(),
      saveAs: (currentPath, defaultName) => files.saveAsTarget(currentPath, defaultName),
    },
    writeDeck: (opened, target) => savePptxToFile(opened, target),
    saved: (event) => files.saved(event),
  }
}
