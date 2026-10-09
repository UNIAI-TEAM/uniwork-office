/**
 * Document images of the text modules on the web (GO-B4 M-2 / H-2).
 *
 * Desktop authors a RELATIVE path (`assets/<name>`) after copying the picture next to the file and
 * shows it through a custom scheme. The web has no sibling directory, so:
 *   - open: the host's `OpenPayload.assets` maps each relative path as written in the document to a
 *     same-origin URL; the renderer asks `resolve(src)` for the URL to display,
 *   - insert / paste with the host's `images` grant: `api.images.upload` stores the bytes in the
 *     document's asset store, the document gets `assets/<name>` and the map learns the URL,
 *   - without the grant (or when the upload fails): the picture is embedded as a data: URI, so
 *     nothing is lost and the document stays self-contained,
 *   - `readImage(src)` (DOCX export) reads data: URIs locally and mapped URLs with a same-origin,
 *     cookie-less fetch; anything else (remote URLs) is not fetched.
 */
import { TIMEOUTS, type FramePort } from '../../docs/bridge/frame-port'

export interface ImageBytes {
  base64: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif'
}

const MIME_BY_EXT: Record<string, ImageBytes['mime']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
}

/** "./assets/a.png" and "assets/a.png" are the same document path */
export function normalizeAssetPath(src: string): string {
  return src.replace(/^\.\//, '')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const out = new ArrayBuffer(binary.length)
  const view = new Uint8Array(out)
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i)
  return out
}

function decodeDataImage(src: string): ImageBytes | null {
  const m = /^data:(image\/(?:png|jpeg|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(src)
  if (!m) return null
  return { mime: m[1].toLowerCase() as ImageBytes['mime'], base64: m[2].replace(/\s+/g, '') }
}

/** `assets/image-20261009-101530-k3f9.png`: unique per insert, like the desktop's pasted names */
export function newAssetName(ext: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const rand = Math.random().toString(36).slice(2, 6)
  return `image-${stamp}-${rand}.${ext}`
}

export interface AssetStoreOptions {
  /** the open document (upload target); null before the first open */
  fileId: () => string | null
  /** the host granted `images` (api.images.upload exists) */
  canUpload: () => boolean
}

export function createAssetStore(port: Pick<FramePort, 'request'>, opts: AssetStoreOptions) {
  /** document path -> URL */
  const urls = new Map<string, string>()
  /** URL -> document path (copy/paste inside the editor must not bake URLs into the file) */
  const paths = new Map<string, string>()

  function learn(path: string, url: string): void {
    urls.set(path, url)
    paths.set(url, path)
  }

  async function upload(bytes: Uint8Array, ext: string): Promise<string | null> {
    const fileId = opts.fileId()
    const mimeType = MIME_BY_EXT[ext]
    if (!fileId || !mimeType || !opts.canUpload()) return null
    const name = newAssetName(ext === 'jpeg' ? 'jpg' : ext)
    const data = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(data).set(bytes)
    try {
      const res = await port.request(
        'api.images.upload',
        { fileId, name, mimeType, data },
        { timeoutMs: TIMEOUTS.transfer, transfer: [data] },
      )
      if (!res?.url) return null
      const path = `assets/${name}`
      learn(path, res.url)
      return path
    } catch (err) {
      console.warn('[office-web] image upload failed, embedding the picture instead:', err)
      return null
    }
  }

  return {
    /** replace the map with the one of a newly opened document */
    reset(assets: Record<string, string> | undefined): void {
      urls.clear()
      paths.clear()
      for (const [path, url] of Object.entries(assets ?? {})) learn(normalizeAssetPath(path), url)
    },

    /** display URL of an authored src; null = not a mapped document path */
    resolve(src: string): string | null {
      return urls.get(normalizeAssetPath(src)) ?? null
    },

    /** authored path of a display URL; null = not one of ours */
    unresolve(url: string): string | null {
      return paths.get(url) ?? null
    },

    /**
     * Store picture bytes for the document; returns the src to author: `assets/<name>` after an
     * upload, else a data: URI. Null only for an unsupported picture type.
     */
    async store(bytes: Uint8Array, ext: string): Promise<string | null> {
      const clean = ext.toLowerCase().replace(/^\./, '')
      const mime = MIME_BY_EXT[clean]
      if (!mime || bytes.byteLength === 0) return null
      return (await upload(bytes, clean)) ?? `data:${mime};base64,${bytesToBase64(bytes)}`
    },

    async storeBase64(base64: string, ext: string): Promise<string | null> {
      return this.store(new Uint8Array(base64ToBuffer(base64)), ext)
    },

    /** bytes of a document picture (DOCX export, single-file HTML); null when not reachable */
    async read(src: string): Promise<ImageBytes | null> {
      if (typeof src !== 'string' || !src) return null
      if (src.startsWith('data:')) return decodeDataImage(src)
      const url = this.resolve(src) ?? (paths.has(src) ? src : null)
      if (!url) return null
      try {
        const res = await fetch(url, { credentials: 'omit' })
        if (!res.ok) return null
        const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
        const mime =
          (EXT_BY_MIME[type] ? (type as ImageBytes['mime']) : null) ??
          MIME_BY_EXT[(src.split('.').pop() ?? '').toLowerCase()]
        if (!mime) return null
        return { mime, base64: bytesToBase64(new Uint8Array(await res.arrayBuffer())) }
      } catch {
        return null
      }
    },
  }
}

export type AssetStore = ReturnType<typeof createAssetStore>

export { EXT_BY_MIME, MIME_BY_EXT }
