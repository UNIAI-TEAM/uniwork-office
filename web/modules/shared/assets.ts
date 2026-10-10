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
 *     missing-picture placeholder instead of a broken-image icon,
 *   - fresh URLs (CONTRACT A1b, `api.assets.resolve`): the URLs of the open answer live an hour and
 *     a path typed after the open has none, so the store asks the host again with paths as written:
 *     (a) for a picture/sibling path it meets that the map does not name once the user edited the
 *     document, (b) for every mapped path shortly before the URLs expire, (c) when a mapped URL
 *     answers 401/403 mid-session (one retry, else the picture shows as missing). An old host
 *     answers `unsupported`: the store keeps what it has and stops asking. `onChange` tells the
 *     renderer to redraw its pictures.
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
/** paths the store asks the host about: something a document can show or inline, never a bare word */
const RESOLVABLE_PATH = /\.(?:png|jpe?g|gif|webp|svg|css|m?js)(?:[?#].*)?$/i
const MAX_RESOLVE_PATHS = 50
const MAX_PATH_BYTES = 512
/** a document can ask about this many distinct typed paths in all (a runaway editor must not flood the host) */
const MAX_ASKED_PATHS = 200
/** typing settles for this long before the typed paths are sent */
const ASK_DELAY_MS = 600
/** the open answer's URLs live 1 h: ask again at about 50 min, retry a failed refresh after 5 */
const REFRESH_AFTER_MS = 50 * 60 * 1000
const REFRESH_RETRY_MS = 5 * 60 * 1000
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
  /** the map changed under the renderer (fresh URLs, a picture now missing): redraw the pictures */
  onChange?: () => void
  /** URL lifetime guard of the open answer, ms (default 50 min); tests shorten it */
  refreshAfterMs?: number
}

/** a relative document path the host could serve (not a URL, not absolute, a picture/css/js name) */
function isAskablePath(src: string): boolean {
  if (!src || src.length > 2048 || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return false
  if (new TextEncoder().encode(src).byteLength > MAX_PATH_BYTES) return false
  return RESOLVABLE_PATH.test(src)
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).href
  } catch {
    return url
  }
}

export function createAssetStore(port: Pick<FramePort, 'request'>, opts: AssetStoreOptions) {
  /** document path -> URL */
  const urls = new Map<string, string>()
  /** URL -> document path (copy/paste inside the editor must not bake URLs into the file) */
  const paths = new Map<string, string>()

  /** the host has no `api.assets.resolve` (old host): keep the URLs we have, ask no more */
  let unsupported = false
  /** typed after the open: asked only once the user has edited the document (open-time misses are the host's answer) */
  let armed = false
  const pending = new Set<string>()
  const asked = new Set<string>()
  /** URLs a retry obtained: one that fails again goes to the placeholder */
  const retried = new Set<string>()
  /** URLs no longer mapped (swapped for a fresh one, or dropped) -> authored path: a picture still showing one maps back */
  const former = new Map<string, string>()
  const inflight = new Set<string>()
  let askTimer: ReturnType<typeof setTimeout> | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  /** bumps with every reset: answers of a previous document are dropped */
  let epoch = 0

  function changed(): void {
    try {
      opts.onChange?.()
    } catch (err) {
      console.warn('[office-web] assets change listener failed:', err)
    }
  }

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

  /** every key (path as written, normalised alias) of a URL */
  function keysOf(url: string): string[] {
    return [...urls].filter(([, value]) => value === url).map(([key]) => key)
  }

  /** forget a URL the host no longer serves: the picture is missing from now on */
  function drop(url: string): void {
    const authored = paths.get(url)
    if (authored) former.set(url, authored)
    for (const key of keysOf(url)) urls.delete(key)
    paths.delete(url)
    retried.delete(url)
  }

  /** swap one URL for a fresh one under every key it is known by */
  function swap(oldUrl: string, newUrl: string): void {
    const authored = paths.get(oldUrl)
    if (authored) former.set(oldUrl, authored)
    for (const key of keysOf(oldUrl)) urls.set(key, newUrl)
    paths.delete(oldUrl)
    retried.delete(oldUrl)
    if (authored) paths.set(newUrl, authored)
  }

  /** one api.assets.resolve call; null = nothing came back (old host, a failure, a stale document) */
  async function resolveRemote(list: string[]): Promise<Record<string, string> | null> {
    if (unsupported || list.length === 0) return null
    const mine = epoch
    const fileId = opts.fileId()
    try {
      const res = await port.request(
        'api.assets.resolve',
        { ...(fileId ? { fileId } : {}), paths: list },
        { timeoutMs: TIMEOUTS.short },
      )
      return mine === epoch ? (res?.assets ?? {}) : null
    } catch (err) {
      const code = (err as { code?: string } | null)?.code
      if (code === 'unsupported' || code === 'unknown_type') unsupported = true
      else console.warn('[office-web] api.assets.resolve failed, keeping the current URLs:', err)
      return null
    }
  }

  /** (a) the paths typed after the open */
  async function askTyped(): Promise<void> {
    askTimer = undefined
    const batch = [...pending].slice(0, MAX_RESOLVE_PATHS)
    for (const path of batch) pending.delete(path)
    const got = await resolveRemote(batch)
    let any = false
    for (const [path, url] of Object.entries(got ?? {})) {
      if (!url || find(path)) continue
      learn(path, url)
      if (!urls.has(normalizeAssetPath(path))) urls.set(normalizeAssetPath(path), url)
      any = true
    }
    if (any) changed()
    if (pending.size > 0) scheduleAsk()
  }

  function scheduleAsk(): void {
    if (askTimer !== undefined || unsupported || pending.size === 0) return
    askTimer = setTimeout(() => void askTyped(), ASK_DELAY_MS)
  }

  /** a relative path the renderer asked for and the map does not name */
  function noteMiss(src: string): void {
    if (unsupported || asked.has(src) || pending.has(src) || !isAskablePath(src)) return
    if (asked.size >= MAX_ASKED_PATHS) return
    asked.add(src)
    if (!armed) return
    pending.add(src)
    scheduleAsk()
  }

  /** (b) fresh URLs for every mapped path before the open answer's expire */
  async function refreshAll(): Promise<void> {
    refreshTimer = undefined
    if (unsupported) return
    const mine = epoch
    const authored = [...new Set(paths.values())].filter(
      (p) => new TextEncoder().encode(p).byteLength <= MAX_PATH_BYTES,
    )
    let failed = false
    let any = false
    for (let i = 0; i < authored.length; i += MAX_RESOLVE_PATHS) {
      const chunk = authored.slice(i, i + MAX_RESOLVE_PATHS)
      const got = await resolveRemote(chunk)
      if (mine !== epoch) return
      if (!got) {
        failed = true
        continue
      }
      for (const path of chunk) {
        const before = find(path)
        if (!before) continue
        const url = got[path]
        if (!url) {
          drop(before.url)
          any = true
        } else if (url !== before.url) {
          swap(before.url, url)
          any = true
        }
      }
    }
    if (any) changed()
    scheduleRefresh(failed ? REFRESH_RETRY_MS : (opts.refreshAfterMs ?? REFRESH_AFTER_MS))
  }

  function scheduleRefresh(ms: number): void {
    clearTimeout(refreshTimer)
    refreshTimer =
      unsupported || paths.size === 0 ? undefined : setTimeout(() => void refreshAll(), ms)
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
      epoch++
      urls.clear()
      paths.clear()
      pending.clear()
      asked.clear()
      retried.clear()
      former.clear()
      inflight.clear()
      armed = false
      clearTimeout(askTimer)
      askTimer = undefined
      for (const [path, url] of Object.entries(assets ?? {})) {
        // keys exactly as written, and the normalised form a differently written src may use
        learn(path, url)
        if (!urls.has(normalizeAssetPath(path))) urls.set(normalizeAssetPath(path), url)
      }
      scheduleRefresh(opts.refreshAfterMs ?? REFRESH_AFTER_MS)
    },

    /** the user edited the document: pictures it names from now on are "typed after the open" */
    arm(): void {
      armed = true
    },

    /**
     * (c) a picture of ours failed to load. When the host really refuses its URL (401/403/404/410),
     * ask for a fresh one once; a second refusal, an absent answer or an old host makes it missing.
     */
    async imageFailed(src: string): Promise<void> {
      const url = [...paths.keys()].find((u) => u === src || absoluteUrl(u) === absoluteUrl(src))
      const authored = url ? paths.get(url) : undefined
      if (!url || !authored || inflight.has(url)) return
      inflight.add(url)
      try {
        if (await reachable(url)) return
        let fresh: string | undefined
        if (!retried.has(url)) {
          const got = await resolveRemote([authored])
          // an old host or a failed call: keep what we have
          if (!got) return
          fresh = got[authored]
        }
        if (!paths.has(url)) return
        if (fresh && fresh !== url) {
          swap(url, fresh)
          retried.add(fresh)
        } else drop(url)
        changed()
      } finally {
        inflight.delete(url)
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
          const authored = paths.get(url)
          if (authored) former.set(url, authored)
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
      const hit = find(src)
      if (!hit) noteMiss(src)
      return hit?.url ?? null
    },

    /** authored path of a display URL; null = not one of ours */
    unresolve(url: string): string | null {
      return paths.get(url) ?? former.get(url) ?? null
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
