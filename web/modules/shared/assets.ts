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
 *     cookie-less fetch; anything else (remote URLs) is not fetched,
 *   - WebP and SVG pictures display and read like the raster ones (UNI-1232 A1); uploads take
 *     PNG/JPEG/GIF/WebP only, a pasted SVG stays a data: URI (document_asset purpose is raster),
 *   - a mapped URL the host no longer serves (401/403/404/410: a revoked share, an expired
 *     signature) counts as missing: `verify()` drops it from the map, so the renderer shows its
 *     missing-picture placeholder instead of a broken-image icon.
 */
import { TIMEOUTS, type FramePort } from '../../docs/bridge/frame-port'

export interface ImageBytes {
  base64: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml'
}

const MIME_BY_EXT: Record<string, ImageBytes['mime']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** what api.images.upload accepts (CONTRACT A1: SVG is never uploaded) */
const UPLOAD_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/** a mapped URL answering one of these is gone for this reader: the picture counts as missing */
const GONE_STATUSES = new Set([401, 403, 404, 410])
/** HEAD probes of a freshly opened document run at most this many at a time, for at most this long */
const VERIFY_CONCURRENCY = 6
const VERIFY_BUDGET_MS = 4000
/** a sibling stylesheet or script inlined into the HTML preview: far above any hand-written file */
const MAX_TEXT_BYTES = 2 * 1024 * 1024

/** "./assets/a.png" and "assets/a.png" are the same document path */
export function normalizeAssetPath(src: string): string {
  return src.replace(/^\.\//, '')
}

/** the forms a path as written may be keyed under: exact, without ./, decoded, without ?query/#fragment */
function lookupKeys(src: string): string[] {
  const keys = [src, normalizeAssetPath(src)]
  const bare = normalizeAssetPath(src.split(/[?#]/)[0] ?? '')
  keys.push(bare)
  try {
    keys.push(decodeURI(bare))
  } catch {
    // an invalid escape: the literal forms above are all there is
  }
  return keys
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
  const m =
    /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml))(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(
      src,
    )
  if (m) return { mime: m[1].toLowerCase() as ImageBytes['mime'], base64: m[2].replace(/\s+/g, '') }
  // an SVG data: URI is usually percent-encoded text, not base64
  const svg = /^data:image\/svg\+xml(?:;charset=[^;,]+)?,(.*)$/is.exec(src)
  if (!svg) return null
  try {
    return {
      mime: 'image/svg+xml',
      base64: bytesToBase64(new TextEncoder().encode(decodeURIComponent(svg[1]))),
    }
  } catch {
    return null
  }
}

/** `assets/image-20261009-101530-k3f9.png`: unique per insert, like the desktop's pasted names */
export function newAssetName(ext: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) =>
    b.toString(36).padStart(2, '0'),
  ).join('')
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
    // the authored form wins: unresolve hands the editor back what the document says
    if (!paths.has(url)) paths.set(url, path)
  }

  function find(src: string): { key: string; url: string } | null {
    for (const key of lookupKeys(src)) {
      const url = urls.get(key)
      if (url) return { key, url }
    }
    return null
  }

  /** true when the URL is served to this reader; only an explicit "gone" answer says no */
  async function reachable(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'HEAD', credentials: 'omit' })
      return !GONE_STATUSES.has(res.status)
    } catch {
      return true
    }
  }

  async function upload(bytes: Uint8Array, ext: string): Promise<string | null> {
    const fileId = opts.fileId()
    const mimeType = MIME_BY_EXT[ext]
    if (!fileId || !mimeType || !UPLOAD_EXTS.has(ext) || !opts.canUpload()) return null
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
      for (const [path, url] of Object.entries(assets ?? {})) {
        // keys exactly as written, and the normalised form a differently written src may use
        learn(path, url)
        if (!urls.has(normalizeAssetPath(path))) urls.set(normalizeAssetPath(path), url)
      }
    },

    /**
     * Drop every mapped URL the host answers 401/403/404/410 to (HEAD, same origin, no
     * credentials), so those pictures are missing rather than broken. Bounded: a slow or
     * unreachable host keeps the rest of the map as is.
     */
    async verify(): Promise<string[]> {
      const dropped: string[] = []
      // one probe per distinct URL (the exact and the normalised key share it)
      const queue = [...new Set(urls.values())]
      const probe = async (): Promise<void> => {
        for (let url = queue.shift(); url; url = queue.shift()) {
          if (await reachable(url)) continue
          for (const [key, value] of [...urls]) {
            if (value !== url) continue
            urls.delete(key)
            dropped.push(key)
          }
          paths.delete(url)
        }
      }
      const run = Promise.all(
        Array.from({ length: Math.min(VERIFY_CONCURRENCY, queue.length) }, probe),
      )
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        run,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, VERIFY_BUDGET_MS)
        }),
      ])
      clearTimeout(timer)
      queue.length = 0
      return dropped
    },

    /** display URL of an authored src; null = not a mapped document path */
    resolve(src: string): string | null {
      return find(src)?.url ?? null
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
          MIME_BY_EXT[(src.split(/[?#]/)[0]!.split('.').pop() ?? '').toLowerCase()]
        if (!mime) return null
        return { mime, base64: bytesToBase64(new Uint8Array(await res.arrayBuffer())) }
      } catch {
        return null
      }
    },

    /** text of a mapped sibling file (stylesheet, script) for the HTML preview; null when not reachable */
    async readText(src: string): Promise<string | null> {
      if (typeof src !== 'string' || !src) return null
      const url = this.resolve(src)
      if (!url) return null
      try {
        const res = await fetch(url, { credentials: 'omit' })
        if (!res.ok) return null
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.byteLength > MAX_TEXT_BYTES) return null
        return new TextDecoder('utf-8').decode(bytes)
      } catch {
        return null
      }
    },
  }
}

export type AssetStore = ReturnType<typeof createAssetStore>

export { EXT_BY_MIME, MIME_BY_EXT }
