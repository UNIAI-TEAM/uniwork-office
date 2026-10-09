/**
 * Web implementation of the Slides session HostIO (apps/slides/src/session/host-io.ts), the
 * counterpart of Electron's main/electron-host-io.ts:
 *
 * | HostIO                 | web                                                                  |
 * |------------------------|----------------------------------------------------------------------|
 * | pickImage / pickMedia  | `<input type=file>` (browser.pickFiles); bytes read in the frame     |
 * | imageSize              | createImageBitmap                                                    |
 * | readMediaPoster        | video: first frame drawn on a canvas (blob: URL); 3D: none          |
 * | confirm                | in-frame modal (./dialogs.ts)                                        |
 * | clipboard              | markers kept in memory + a text sentinel on the system clipboard     |
 * | recent                 | api.recents when the host granted `recents`, else []                 |
 * | commentAuthor          | init.user.displayName, else the generic "User" label                 |
 * | saveTarget.untitled    | a `uniwork://new/<name>` placeholder; writeDeck saves it with api.saveAs {silent} |
 * | saveTarget.saveAs      | api.saveAs (the host's name/folder dialog uploads the bytes at once) |
 * | writeDeck              | savePptx -> api.save {fileId, data, etag}; conflict -> Overwrite / Reload / Cancel |
 * | saved                  | `saved` event, dirty, title, rename listeners                        |
 *
 * No autosave (CONTRACT C10): api.save is never sent with `auto`.
 */
import { savePptx, type OpenedPptx } from '@genoffice/pptx-engine'
import type {
  HostIO,
  HostMessageBox,
  ImagePickPurpose,
  MediaPickKind,
  PickedFile,
  SaveEvent,
} from '../../../apps/slides/src/session/host-io'
import { sessions } from '../../../apps/slides/src/session/state'
import type { FileMeta, ProtocolErrorShape, SaveResult } from '../../docs/protocol/types'
import { pickFiles } from '../../docs/bridge/browser'
import { TIMEOUTS, errorCode, type FramePort } from '../../docs/bridge/frame-port'
import { idFromPath, pathFor } from '../../docs/bridge/webapi'
import { tm } from '../../../apps/slides/src/main/i18n-main'
import { ask, choose, text } from './dialogs'

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.bmp,.webp,.tif,.tiff'
const MEDIA_ACCEPT: Record<MediaPickKind, string> = {
  video: '.mp4,.m4v,.mov,.webm,.avi',
  audio: '.mp3,.wav,.m4a,.aac,.ogg',
  model3d: '.glb,.gltf',
}
const NEW_PREFIX = 'uniwork://new/'

/** markers written next to the in-app slide/element clipboards */
const SENTINEL_PREFIX = '⁣uniwork-slides:'

/** the save/conflict state the host IO shares with the slidesApi bridge */
export interface WebDocState {
  /** fileId -> latest server metadata (etag = If-Match base of the next save) */
  files: Map<string, FileMeta>
  /** set while the document could not be opened: every save is refused */
  fatal: ProtocolErrorShape | null
  /** a host `save` / `saveAs` request runs the editor's flow: it owns the conflict UI */
  hostSaving: boolean
  remember(file: FileMeta): void
}

export function createDocState(): WebDocState {
  const files = new Map<string, FileMeta>()
  return {
    files,
    fatal: null,
    hostSaving: false,
    remember(file) {
      files.set(file.fileId, { ...files.get(file.fileId), ...file })
    },
  }
}

/** a failed save the session reports as {ok:false, error}; `reason` lets the bridge tell kinds apart */
export class WebSaveError extends Error {
  constructor(
    message: string,
    readonly reason: 'conflict' | 'cancelled' | 'fatal' | 'failed',
  ) {
    super(message)
  }
}

export interface WebHostDeps {
  port: Pick<FramePort, 'request' | 'reportSaved' | 'reportError'>
  clientId: number
  state: WebDocState
  /** host grants in force (capability object) */
  capabilities: Record<string, unknown>
  /** init.user.displayName, when the host sent it */
  userName(): string | undefined
  /** a deck replaced by "Reload latest" after a conflict */
  reload(fileId: string): Promise<void>
  /** after every landed save (dirty, title, rename listeners) */
  onSaved(event: { file: FileMeta; previousPath: string; kind: SaveEvent['kind'] }): void
  /** test seams */
  pickFiles?: (accept: string, multiple: boolean) => Promise<File[]>
  clipboard?: Pick<Clipboard, 'writeText' | 'readText'>
}

function extOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

/** "Deck" / "Deck.pptx" -> "Deck.pptx" */
export function pptxName(name: string): string {
  return `${(name || 'Untitled').replace(/\.pptx$/i, '')}.pptx`
}

/** video poster: the first decodable frame, PNG bytes; undefined when the browser cannot decode it */
async function videoPoster(file: File): Promise<{ bytes: Uint8Array; ext: string } | undefined> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  try {
    const ready = new Promise<void>((resolve, reject) => {
      video.addEventListener('seeked', () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error('undecodable video')), { once: true })
      video.addEventListener(
        'loadeddata',
        () => {
          video.currentTime = Math.min(0.1, video.duration || 0)
        },
        { once: true },
      )
    })
    video.src = url
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const g = canvas.getContext('2d')
    if (!g || !canvas.width || !canvas.height) return undefined
    g.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' } : undefined
  } catch {
    return undefined
  } finally {
    video.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}

export function createWebHostIO(deps: WebHostDeps): HostIO {
  const pick = deps.pickFiles ?? pickFiles
  const origin = new WeakMap<PickedFile, File>()
  const markers = new Set<string>()
  const clip = (): Pick<Clipboard, 'writeText' | 'readText'> | null =>
    deps.clipboard ?? (typeof navigator !== 'undefined' ? (navigator.clipboard ?? null) : null)
  /** the path api.saveAs just created: writeDeck must not upload the same bytes again */
  let justSavedAs: string | null = null

  async function pickOne(accept: string): Promise<PickedFile | null> {
    const [file] = await pick(accept, false)
    if (!file) return null
    const picked: PickedFile = {
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      ext: extOf(file.name),
    }
    origin.set(picked, file)
    return picked
  }

  function saveFailure(result: Extract<SaveResult, { ok: false }>): WebSaveError {
    const code = result.error.code
    return new WebSaveError(
      code === 'timeout' ? 'save timed out' : result.error.message,
      code === 'conflict' ? 'conflict' : code === 'cancelled' ? 'cancelled' : 'failed',
    )
  }

  async function send(
    type: 'api.save' | 'api.saveAs',
    run: () => Promise<SaveResult>,
  ): Promise<SaveResult> {
    try {
      const res = await run()
      if (res?.ok === true && res.file) return res
      if (res?.ok === false) return res
      return { ok: false, error: { code: 'malformed', message: `${type}: unexpected result` } }
    } catch (err) {
      return {
        ok: false,
        error: { code: errorCode(err), message: err instanceof Error ? err.message : String(err) },
      }
    }
  }

  function landed(
    res: Extract<SaveResult, { ok: true }>,
    previousPath: string,
    kind: SaveEvent['kind'],
  ): FileMeta {
    const file = { ...res.file }
    if (res.versionId && !file.versionId) file.versionId = res.versionId
    deps.state.remember(file)
    const meta = deps.state.files.get(file.fileId)!
    deps.port.reportSaved({
      file: meta,
      ...(res.versionId ? { versionId: res.versionId } : {}),
      initiatedByFrame: !deps.state.hostSaving,
    })
    deps.onSaved({ file: meta, previousPath, kind })
    return meta
  }

  async function headMeta(fileId: string): Promise<FileMeta | null> {
    try {
      const open = await deps.port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.short })
      return open?.file?.fileId === fileId ? open.file : null
    } catch {
      return null
    }
  }

  /** api.save of the current bytes; a conflict asks Overwrite / Reload latest / Cancel */
  async function saveExisting(fileId: string, path: string, bytes: Uint8Array): Promise<void> {
    const etag = deps.state.files.get(fileId)?.etag
    const payload = { fileId, data: copyBuffer(bytes), ...(etag ? { etag } : {}) }
    const res = await send('api.save', () =>
      deps.port.request('api.save', payload, {
        timeoutMs: TIMEOUTS.transfer,
        transfer: [payload.data],
      }),
    )
    if (res.ok) {
      landed(res, path, 'save')
      return
    }
    if (res.error.code !== 'conflict') {
      if (res.error.code === 'timeout' || res.error.code === 'network') {
        // the write may have landed: adopt the head when it looks like our own bytes
        const head = await headMeta(fileId)
        const before = deps.state.files.get(fileId)
        if (
          head &&
          before?.etag &&
          head.etag !== before.etag &&
          head.sizeBytes === bytes.byteLength
        )
          deps.state.remember(head)
      }
      throw saveFailure(res)
    }
    // a host `save` request gets the conflict in its result and owns the UI
    if (deps.state.hostSaving) throw saveFailure(res)
    deps.port.reportError(res.error, false)
    const choice = await ask({
      title: 'webConflictTitle',
      body: 'webConflictBody',
      choices: [
        { id: 'cancel', label: 'webCancel' },
        { id: 'reload', label: 'webConflictReload' },
        { id: 'overwrite', label: 'webConflictOverwrite', primary: true },
      ],
      cancelId: 'cancel',
      marker: 'conflict',
    })
    if (choice === 'overwrite') {
      const head = await headMeta(fileId)
      if (head) {
        deps.state.remember(head)
        return saveExisting(fileId, path, bytes)
      }
    } else if (choice === 'reload') {
      await deps.reload(fileId)
    }
    throw new WebSaveError(text('webConflictNotSaved'), 'conflict')
  }

  /** api.saveAs; null = the user cancelled the host dialog */
  async function saveAsNew(
    name: string,
    bytes: Uint8Array,
    extra: { silent?: boolean; sourceFileId?: string },
    previousPath: string,
    kind: SaveEvent['kind'],
  ): Promise<FileMeta | null> {
    const payload = { name: pptxName(name), data: copyBuffer(bytes), ...extra }
    const res = await send('api.saveAs', () =>
      deps.port.request('api.saveAs', payload, {
        timeoutMs: extra.silent ? TIMEOUTS.transfer : TIMEOUTS.dialog,
        transfer: [payload.data],
      }),
    )
    if (res.ok) return landed(res, previousPath, kind)
    if (res.error.code === 'cancelled') return null
    throw saveFailure(res)
  }

  function refuseWhenFatal(): void {
    if (deps.state.fatal) throw new WebSaveError(text('webFatalTitle'), 'fatal')
  }

  return {
    pickImage: (_purpose: ImagePickPurpose) => pickOne(IMAGE_ACCEPT),
    pickMedia: (kind: MediaPickKind) => pickOne(MEDIA_ACCEPT[kind]),

    async imageSize(file) {
      const source = origin.get(file) ?? new Blob([copyBuffer(file.bytes)])
      try {
        const bitmap = await createImageBitmap(source)
        const size = { width: bitmap.width, height: bitmap.height }
        bitmap.close()
        return size.width > 0 && size.height > 0 ? size : null
      } catch {
        return null
      }
    },

    async readMediaPoster(file, kind) {
      const source = origin.get(file)
      return kind === 'video' && source ? videoPoster(source) : undefined
    },

    confirm: (box: HostMessageBox) =>
      choose({
        title: box.message,
        body: box.detail,
        buttons: box.buttons,
        ...(box.defaultId !== undefined ? { defaultId: box.defaultId } : {}),
        ...(box.cancelId !== undefined ? { cancelId: box.cancelId } : {}),
        marker: 'confirm',
      }),

    clipboard: {
      writeMarker(format) {
        markers.clear()
        markers.add(format)
        void clip()
          ?.writeText(SENTINEL_PREFIX + format)
          .catch(() => {})
      },
      hasMarker: (format) => markers.has(format),
      // the async Clipboard API cannot answer synchronously: the slidesApi bridge answers
      // clipboardExternal / clipboardProbe itself; these keep the registry handlers total
      readImagePng: () => null,
      hasImage: () => false,
      readText: () => '',
    },

    async recent() {
      if (deps.capabilities.recents !== true) return []
      try {
        const res = await deps.port.request(
          'api.recents',
          { limit: 20 },
          { timeoutMs: TIMEOUTS.short },
        )
        return Array.isArray(res?.files)
          ? res.files
              .filter((f) => typeof f?.fileId === 'string' && typeof f.name === 'string')
              .map(pathFor)
          : []
      } catch {
        return []
      }
    },

    commentAuthor: () => deps.userName() || text('webCommentAuthor'),

    saveTarget: {
      untitled: () => NEW_PREFIX + pptxName(tm('untitledDeck')),
      async saveAs(currentPath, defaultName) {
        refuseWhenFatal()
        const session = sessions.get(deps.clientId)
        if (!session) return null
        const bytes = await savePptx(session.opened)
        const sourceFileId = idFromPath(currentPath)
        const file = await saveAsNew(
          defaultName || currentPath.split('/').pop() || 'Untitled',
          bytes,
          sourceFileId ? { sourceFileId } : {},
          currentPath,
          'saveAs',
        )
        if (!file) return null
        justSavedAs = pathFor(file)
        return justSavedAs
      },
    },

    async writeDeck(opened: OpenedPptx, target: string) {
      refuseWhenFatal()
      if (target === justSavedAs) {
        justSavedAs = null
        return
      }
      const bytes = await savePptx(opened)
      if (target.startsWith(NEW_PREFIX)) {
        const file = await saveAsNew(
          target.slice(NEW_PREFIX.length),
          bytes,
          { silent: true },
          target,
          'save',
        )
        if (!file) throw new WebSaveError('save cancelled', 'cancelled')
        const session = sessions.get(deps.clientId)
        if (session?.path === target) session.path = pathFor(file)
        return
      }
      const fileId = idFromPath(target)
      if (!fileId) throw new WebSaveError(`not a UniWork document: ${target}`, 'failed')
      await saveExisting(fileId, target, bytes)
    },

    async saved() {
      // landed() already reported the save to the host and the bridge
    },
  }
}

export { SENTINEL_PREFIX }
