/**
 * Fake in-memory UniWork file backend (W5 - UNI-1011 spike).
 *
 * Everything the Docs renderer used to get from the local filesystem through
 * the Electron main process goes through `FakeBackend`. GO-B3 replaces
 * `createFakeBackend()` with an HTTP client against the UniWork FileService;
 * each method documents the endpoint it maps to. The interface is async on
 * purpose so the swap does not change any call site.
 *
 * Paths: the renderer treats a document's identity as an opaque "path" string
 * and only ever derives a display name with `path.split(/[\\/]/).pop()`. Web
 * paths are therefore `uniwork://files/<id>/<name>` (see `pathFor` / `idFromPath`).
 *
 * Storage: file bytes live in memory only (lost on reload). The recents list
 * is persisted to localStorage best-effort; a recent entry remembers the URL a
 * file was fetched from (`sourceUrl`) so it can be re-fetched after a reload.
 * Entries with neither bytes nor a sourceUrl are dropped from `recent()`,
 * mirroring the desktop's `existsSync` filter on `docs:recent`.
 */

export interface FileEntry {
  id: string
  name: string
  bytes: Uint8Array
  /** epoch ms of the last write */
  mtime: number
  /** where the bytes came from when opened by URL (re-fetchable) */
  sourceUrl?: string
}

export interface FileStat {
  id: string
  name: string
  size: number
  mtime: number
}

export interface RecentEntry {
  path: string
  sourceUrl?: string
}

export interface FakeBackend {
  /** create a file. Future: `POST /api/files` multipart {name, content} -> {id, name, size, mtime} */
  create(name: string, bytes: Uint8Array, sourceUrl?: string): Promise<FileEntry>
  /** overwrite content. Future: `PUT /api/files/:id/content` (body = bytes, If-Match: mtime/etag) -> {mtime} */
  write(id: string, bytes: Uint8Array): Promise<FileEntry | null>
  /** read content. Future: `GET /api/files/:id` (meta) + `GET /api/files/:id/content` (bytes) */
  read(id: string): Promise<FileEntry | null>
  /** metadata only. Future: `GET /api/files/:id` -> {id, name, size, mtime}; 404 = missing */
  stat(id: string): Promise<FileStat | null>
  /** Future: `HEAD /api/files/:id` */
  exists(id: string): Promise<boolean>
  /** Future: `GET /api/files` -> FileStat[] */
  list(): Promise<FileStat[]>
  /** newest first. Future: `GET /api/files/recent` -> {path, sourceUrl?}[] */
  recent(): Promise<RecentEntry[]>
  /** move to the front of recents. Future: `POST /api/files/recent` {fileId} */
  addRecent(entry: RecentEntry): Promise<void>
  /** Future: `DELETE /api/files/recent` */
  clearRecents(): Promise<void>
}

const PATH_PREFIX = 'uniwork://files/'
const RECENTS_KEY = 'docsWeb.recents'
const RECENTS_MAX = 20

export function pathFor(entry: { id: string; name: string }): string {
  return `${PATH_PREFIX}${entry.id}/${entry.name}`
}

/** id of a backend path, null for anything else (URLs, desktop paths) */
export function idFromPath(path: string): string | null {
  if (!path.startsWith(PATH_PREFIX)) return null
  const rest = path.slice(PATH_PREFIX.length)
  const slash = rest.indexOf('/')
  return slash > 0 ? rest.slice(0, slash) : null
}

function loadRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((e): e is RecentEntry => typeof e?.path === 'string')
      : []
  } catch {
    return []
  }
}

function saveRecents(list: RecentEntry[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list))
  } catch {
    // private window / blocked storage: recents stay in memory only
  }
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

export function createFakeBackend(): FakeBackend {
  const files = new Map<string, FileEntry>()
  let recents = loadRecents()

  const statOf = (e: FileEntry): FileStat => ({
    id: e.id,
    name: e.name,
    size: e.bytes.byteLength,
    mtime: e.mtime,
  })

  return {
    async create(name, bytes, sourceUrl) {
      const entry: FileEntry = { id: newId(), name, bytes: bytes.slice(), mtime: Date.now(), sourceUrl }
      files.set(entry.id, entry)
      return entry
    },
    async write(id, bytes) {
      const entry = files.get(id)
      if (!entry) return null
      entry.bytes = bytes.slice()
      entry.mtime = Date.now()
      return entry
    },
    async read(id) {
      return files.get(id) ?? null
    },
    async stat(id) {
      const entry = files.get(id)
      return entry ? statOf(entry) : null
    },
    async exists(id) {
      return files.has(id)
    },
    async list() {
      return [...files.values()].map(statOf)
    },
    async recent() {
      return recents.filter((r) => {
        const id = idFromPath(r.path)
        return (id !== null && files.has(id)) || !!r.sourceUrl
      })
    },
    async addRecent(entry) {
      // a URL-backed file reopened after a reload gets a new id: dedupe by URL too
      const same = (r: RecentEntry) =>
        r.path === entry.path || (!!entry.sourceUrl && r.sourceUrl === entry.sourceUrl)
      recents = [entry, ...recents.filter((r) => !same(r))].slice(0, RECENTS_MAX)
      saveRecents(recents)
    },
    async clearRecents() {
      recents = []
      saveRecents(recents)
    },
  }
}
