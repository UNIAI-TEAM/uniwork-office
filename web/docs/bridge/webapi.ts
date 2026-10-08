/**
 * WEB-API class shim (W5 - UNI-1011 spike).
 *
 * The part of DesktopApi that needs a UniWork server in production, faked in
 * the browser with `FakeBackend` (./fake-backend.ts) plus `window.projectApi`
 * backed by an in-memory project/chat store. Desktop source of truth:
 * apps/docs/src/main/docs-main.ts (`docs:*` handlers, compiled into the shell)
 * and apps/docs/src/preload/index.ts.
 *
 * | method                 | fake behaviour (this spike)                                   | future UniWork endpoint + payload                                   |
 * |------------------------|---------------------------------------------------------------|---------------------------------------------------------------------|
 * | openDocx               | <input type=file accept=.docx> -> backend.create -> OpenFileResult; cancel -> null | POST /api/files (multipart name+bytes) -> {id,name,size,mtime}; then GET /api/files/:id/content |
 * | openDocxPath(path)     | backend.read(id); recent with sourceUrl or URL-ish path -> fetch | GET /api/files/:id + GET /api/files/:id/content (bytes, ETag)     |
 * | consumePendingOpenDocx | resolves the `?open=<url>` fetch (or a queued __docsWeb open)  | none: the URL becomes /docs?file=<id> -> GET /api/files/:id/content |
 * | onOpenDocx             | listeners fed by __docsWeb.openUrl/openBytes after boot        | none (client-side); later: push channel for "open in Docs"          |
 * | saveDocx(path,data,auto)| backend.write + browser download (skipped when auto=true)     | PUT /api/files/:id/content (body bytes, If-Match: etag) -> {mtime,etag}; 412 -> reason 'external-modified' |
 * | saveDocxAs(name,data)  | backend.create(name) + download; never cancels (no dialog)     | POST /api/files {name, folderId?} + content -> {id}                 |
 * | saveDocxNew(name,data) | same as saveDocxAs (desktop: silent write to default folder)  | POST /api/files {name} (server picks default folder, unique name)    |
 * | getRecentFiles         | backend.recent() paths (localStorage-persisted, existence-filtered) | GET /api/files/recent -> [{id,name,path}]                     |
 * | exportHtml(name,html)  | renderer built the HTML: Blob download `<name>.html`           | optional POST /api/files {name:.html} (export into the drive)       |
 * | exportPdf              | main used webContents.printToPDF: falls back to window.print() | POST /api/export/pdf {fileId | html, pageWidthTwips, pageHeightTwips, scale} -> PDF bytes (headless Chromium server-side) |
 * | printPdfBuffer         | returns a marker part (no bytes); the real print happens in saveMergedPdf | same /api/export/pdf, one call per paper-size group         |
 * | saveMergedPdf          | all parts are markers -> window.print() of the whole preview   | POST /api/export/pdf/merge {parts[]} -> PDF bytes (pdf-lib server-side) |
 * | projectApi.*           | in-memory projects / chats / fileMap (lost on reload)          | see PROJECT_ENDPOINTS below                                         |
 *
 * Not here on purpose: openDocxDecrypt / setDocPassword / writeRecoveryCopy /
 * openNewTab / onRenamedDocx (HIDE class, W6 or install.ts fallback),
 * createDocument / AI (W6), print / pickImage / clipboard (BROWSER, W4).
 * Encrypted (CFB) docx is passed through as-is: parseDocx fails and the
 * renderer falls back to a blank document (no needsPassword prompt on web).
 *
 * Startup-open hook: App.tsx boot effect
 * (apps/docs/src/renderer/App.tsx:1729-1730) calls
 * `window.desktop.consumePendingOpenDocx()` exactly once after the editor
 * mounts and passes the result to loadFile; the `?open=` fetch is returned
 * from there. Opens after boot go through the `onOpenDocx` subscription
 * (App.tsx:1722), the same path Finder/Explorer "open with" uses on desktop.
 *
 * Test hook: `window.__docsWeb = { openUrl, openBytes, lastSaved, files, clearRecents }`.
 */
import type {
  DesktopApi,
  OpenDocxResult,
  OpenFileResult,
} from '../../../apps/docs/src/shared/ipc'
import type {
  ChatMessage,
  ProjectApi,
  ProjectSummary,
  ResolveChatResult,
  TimelineEntry,
} from '@genoffice/project-store'
import { createFakeBackend, idFromPath, pathFor, type FileEntry, type FileStat } from './fake-backend'

const backend = createFakeBackend()

// ---------------------------------------------------------------- helpers

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** "Report.docx" / "Report" -> "Report.<ext>" */
function withExt(name: string, ext: string): string {
  return name.replace(/\.(docx|pdf|html?)$/i, '') + ext
}

/** detached copy: the renderer may transfer/detach what it receives */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // crypto.subtle needs a secure context (https / localhost)
    return ''
  }
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let settled = false
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    // Chromium 113+ / Firefox 91+ fire `cancel` when the picker is dismissed
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    input.click()
  })
}

async function toOpenResult(entry: FileEntry): Promise<OpenFileResult> {
  const path = pathFor(entry)
  // desktop loadDocx pushes recents on every successful open
  await backend.addRecent({ path, sourceUrl: entry.sourceUrl })
  return {
    path,
    name: entry.name,
    data: toArrayBuffer(entry.bytes),
    hash: await sha256Hex(entry.bytes),
  }
}

function nameFromUrl(url: string): string {
  try {
    const last = new URL(url, location.href).pathname.split('/').pop() ?? ''
    return decodeURIComponent(last) || 'document.docx'
  } catch {
    return 'document.docx'
  }
}

async function fetchIntoBackend(url: string): Promise<FileEntry> {
  const absolute = new URL(url, location.href).href
  const res = await fetch(absolute)
  if (!res.ok) throw new Error(`GET ${absolute} -> ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return backend.create(nameFromUrl(absolute), bytes, absolute)
}

function looksLikeUrl(path: string): boolean {
  return /^(https?:)?\/\//i.test(path) || path.startsWith('/')
}

// ---------------------------------------------------------------- open plumbing

type OpenHandler = (result: Exclude<OpenDocxResult, null>) => void
const openListeners = new Set<OpenHandler>()
/** true once the renderer consumed the boot open (App.tsx boot effect) */
let booted = false
let pendingOpen: Promise<OpenDocxResult> | null = null

function startupOpenFromQuery(): Promise<OpenDocxResult> | null {
  const url = new URLSearchParams(location.search).get('open')
  if (!url) return null
  return fetchIntoBackend(url)
    .then(toOpenResult)
    .catch((err: unknown) => {
      console.error('[docs-web] ?open= failed:', err)
      return null
    })
}
pendingOpen = startupOpenFromQuery()

/** hand a result to the renderer: boot queue before mount, onOpenDocx after */
function deliver(result: OpenFileResult): void {
  if (booted && openListeners.size > 0) {
    for (const listener of openListeners) listener(result)
  } else {
    pendingOpen = Promise.resolve(result)
  }
}

// ---------------------------------------------------------------- save bookkeeping

let lastSaved: { name: string; bytes: Uint8Array } | null = null

async function persistNew(
  defaultName: string,
  data: ArrayBuffer,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const name = withExt(defaultName || 'Untitled', '.docx')
    const entry = await backend.create(name, new Uint8Array(data))
    const path = pathFor(entry)
    await backend.addRecent({ path })
    lastSaved = { name, bytes: entry.bytes }
    downloadBlob(name, new Blob([toArrayBuffer(entry.bytes)], { type: DOCX_MIME }))
    return { ok: true, path }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** printPdfBuffer has no bytes to return on web; saveMergedPdf recognises this marker */
const WEB_PRINT_PART = 'web-print-deferred'

function printViaBrowser(defaultName: string): { ok: boolean; path?: string } {
  window.print()
  return { ok: true, path: `${withExt(defaultName, '.pdf')} (browser print dialog)` }
}

// ---------------------------------------------------------------- DesktopApi part

const desktopPart = {
  async openDocx(): Promise<OpenDocxResult> {
    const file = await pickFile('.docx,' + DOCX_MIME)
    if (!file) return null
    const entry = await backend.create(file.name, new Uint8Array(await file.arrayBuffer()))
    return toOpenResult(entry)
  },

  async openDocxPath(path: string): Promise<OpenDocxResult> {
    if (typeof path !== 'string' || !path) return null
    const id = idFromPath(path)
    const entry = id ? await backend.read(id) : null
    if (entry) return toOpenResult(entry)
    // bytes gone (page reload) but the recent remembers where they came from
    const recent = (await backend.recent()).find((r) => r.path === path)
    const url = recent?.sourceUrl ?? (looksLikeUrl(path) ? path : null)
    if (!url) return null
    try {
      return await toOpenResult(await fetchIntoBackend(url))
    } catch (err) {
      console.error('[docs-web] openDocxPath failed:', err)
      return null
    }
  },

  async consumePendingOpenDocx(): Promise<OpenDocxResult> {
    booted = true
    const pending = pendingOpen
    pendingOpen = null
    return pending ? await pending : null
  },

  onOpenDocx(handler: OpenHandler): () => void {
    openListeners.add(handler)
    return () => {
      openListeners.delete(handler)
    }
  },

  async saveDocx(path: string, data: ArrayBuffer, auto?: boolean) {
    try {
      const bytes = new Uint8Array(data)
      const id = idFromPath(path)
      const entry =
        (id ? await backend.write(id, bytes) : null) ??
        (await backend.create(basename(path), bytes))
      lastSaved = { name: entry.name, bytes: entry.bytes }
      await backend.addRecent({ path: pathFor(entry), sourceUrl: entry.sourceUrl })
      // autosave must not spam the downloads bar; the backend copy is the "disk"
      if (!auto) downloadBlob(entry.name, new Blob([toArrayBuffer(entry.bytes)], { type: DOCX_MIME }))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },

  saveDocxAs(defaultName: string, data: ArrayBuffer, _sourcePath?: string | null) {
    return persistNew(defaultName, data)
  },

  saveDocxNew(defaultName: string, data: ArrayBuffer) {
    return persistNew(defaultName, data)
  },

  async getRecentFiles(): Promise<string[]> {
    return (await backend.recent()).map((r) => r.path)
  },

  async exportHtml(defaultName: string, html: string, _outPath?: string) {
    if (typeof html !== 'string' || !html) return { ok: false, error: 'empty document' }
    const name = withExt(defaultName, '.html')
    downloadBlob(name, new Blob([html], { type: 'text/html;charset=utf-8' }))
    return { ok: true, path: name }
  },

  async exportPdf(
    defaultName: string,
    _pageWidthTwips: number,
    _pageHeightTwips: number,
    _outPath?: string,
    _scale?: number,
  ) {
    return printViaBrowser(defaultName)
  },

  async printPdfBuffer(_pageWidthTwips: number, _pageHeightTwips: number, _scale?: number) {
    return { ok: true, base64: WEB_PRINT_PART }
  },

  async saveMergedPdf(defaultName: string, base64Parts: string[], _outPath?: string) {
    if (base64Parts.every((p) => p === WEB_PRINT_PART)) return printViaBrowser(defaultName)
    return { ok: false, error: 'merging real PDF parts is not supported on web' }
  },
} satisfies Partial<DesktopApi>

// ---------------------------------------------------------------- projectApi (in-memory)

/**
 * PROJECT_ENDPOINTS (future UniWork API):
 *   resolveChat   POST   /api/chats/resolve      {filePath|fileId, tempChatId?} -> {projectId, chatId}
 *   appendChat    POST   /api/projects/:pid/chats/:cid/messages  {role, text, tools?, attachments?, scope?}
 *   loadChat      GET    /api/projects/:pid/chats/:cid/messages?limit=N -> ChatMessage[]
 *   rebindChat    POST   /api/projects/:pid/chats/:tempCid/rebind {newChatId|fileId} -> {projectId, chatId}
 *   listProjects  GET    /api/projects -> ProjectSummary[]
 *   createProject POST   /api/projects {name} -> ProjectSummary
 *   renameProject PATCH  /api/projects/:id {name}
 *   deleteProject DELETE /api/projects/:id (soft delete)
 *   moveFile      PUT    /api/files/:id/project {projectId}
 *   getTimeline   GET    /api/projects/:id/timeline?limit=N -> TimelineEntry[]
 */
const DEFAULT_PROJECT = 'default'

interface FakeProject {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

const projects = new Map<string, FakeProject>()
const nowIso = () => new Date().toISOString()
projects.set(DEFAULT_PROJECT, {
  id: DEFAULT_PROJECT,
  name: 'Default',
  createdAt: nowIso(),
  updatedAt: nowIso(),
})
/** `${projectId}/${chatId}` -> messages */
const chats = new Map<string, ChatMessage[]>()
/** file path -> projectId */
const fileMap = new Map<string, string>()
/** file path -> stable chatId */
const chatIdByPath = new Map<string, string>()
let chatCounter = 0

const chatKey = (projectId: string, chatId: string) => `${projectId}/${chatId}`

function chatIdFor(filePath: string): string {
  let id = chatIdByPath.get(filePath)
  if (!id) {
    id = `chat-${++chatCounter}`
    chatIdByPath.set(filePath, id)
  }
  return id
}

function filePathOfChat(chatId: string): string {
  for (const [path, id] of chatIdByPath) if (id === chatId) return path
  return ''
}

function summary(p: FakeProject): ProjectSummary {
  let lastActiveAt = p.updatedAt
  for (const [key, msgs] of chats) {
    if (!key.startsWith(`${p.id}/`)) continue
    const ts = msgs[msgs.length - 1]?.ts
    if (ts && ts > lastActiveAt) lastActiveAt = ts
  }
  const fileCount = [...fileMap.values()].filter((pid) => pid === p.id).length
  return { ...p, fileCount, lastActiveAt, isDefault: p.id === DEFAULT_PROJECT }
}

export const projectApi = {
  async resolveChat({ filePath, tempChatId }): Promise<ResolveChatResult> {
    if (!filePath) {
      return { projectId: DEFAULT_PROJECT, chatId: tempChatId ?? `unsaved-${Date.now()}` }
    }
    if (!fileMap.has(filePath)) fileMap.set(filePath, DEFAULT_PROJECT)
    return { projectId: fileMap.get(filePath)!, chatId: chatIdFor(filePath) }
  },

  async appendChat({ projectId, chatId, role, text, tools, attachments, scope }) {
    const key = chatKey(projectId, chatId)
    const list = chats.get(key) ?? []
    const fileRef = filePathOfChat(chatId) || undefined
    list.push({
      seq: (list[list.length - 1]?.seq ?? 0) + 1,
      ts: nowIso(),
      role,
      text,
      ...(fileRef ? { fileRef } : {}),
      ...(tools ? { tools } : {}),
      ...(attachments ? { attachments } : {}),
      ...(scope ? { scope } : {}),
    })
    chats.set(key, list)
  },

  async loadChat({ projectId, chatId, limit }) {
    const list = chats.get(chatKey(projectId, chatId)) ?? []
    return limit && limit > 0 ? list.slice(-limit) : list.slice()
  },

  async rebindChat({ projectId, tempChatId, newChatId, newFilePath }) {
    let chatId = newChatId
    if (!chatId && newFilePath) {
      chatId = chatIdFor(newFilePath)
      if (!fileMap.has(newFilePath)) fileMap.set(newFilePath, projectId)
    }
    // sessionId (Sheets) has nothing to look up here: keep the temp chat
    if (!chatId) return { projectId, chatId: tempChatId }
    const from = chatKey(projectId, tempChatId)
    const moved = chats.get(from)
    if (moved) {
      const to = chatKey(projectId, chatId)
      chats.set(to, [...(chats.get(to) ?? []), ...moved])
      chats.delete(from)
    }
    return { projectId, chatId }
  },

  async listProjects() {
    return [...projects.values()].map(summary)
  },

  async createProject({ name }) {
    const p: FakeProject = {
      id: `p-${Date.now().toString(36)}-${projects.size}`,
      name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    projects.set(p.id, p)
    return summary(p)
  },

  async renameProject({ id, name }) {
    const p = projects.get(id)
    if (!p || id === DEFAULT_PROJECT) return
    p.name = name
    p.updatedAt = nowIso()
  },

  async deleteProject({ id }) {
    if (id === DEFAULT_PROJECT) return
    projects.delete(id)
    for (const [path, pid] of fileMap) if (pid === id) fileMap.set(path, DEFAULT_PROJECT)
  },

  async moveFile({ filePath, projectId }) {
    if (projects.has(projectId)) fileMap.set(filePath, projectId)
  },

  async getTimeline({ projectId, limit }) {
    const out: TimelineEntry[] = []
    for (const [key, msgs] of chats) {
      if (!key.startsWith(`${projectId}/`)) continue
      const chatId = key.slice(projectId.length + 1)
      const filePath = filePathOfChat(chatId)
      for (const m of msgs) {
        out.push({
          filePath,
          fileName: basename(filePath),
          chatId,
          ts: m.ts,
          role: m.role,
          preview: (m.text.split('\n')[0] ?? '').slice(0, 120),
          seq: m.seq,
        })
      }
    }
    out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.seq - a.seq))
    return limit && limit > 0 ? out.slice(0, limit) : out
  },
} satisfies ProjectApi

// ---------------------------------------------------------------- test hook (W7)

async function openBytes(name: string, bytes: Uint8Array | ArrayBuffer) {
  const entry = await backend.create(
    name,
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  )
  const result = await toOpenResult(entry)
  deliver(result)
  return { path: result.path, name: result.name }
}

async function openUrl(url: string) {
  const result = await toOpenResult(await fetchIntoBackend(url))
  deliver(result)
  return { path: result.path, name: result.name }
}

export interface DocsWebHook {
  openUrl(url: string): Promise<{ path: string; name: string }>
  openBytes(name: string, bytes: Uint8Array | ArrayBuffer): Promise<{ path: string; name: string }>
  lastSaved(): { name: string; bytes: Uint8Array } | null
  files(): Promise<FileStat[]>
  clearRecents(): Promise<void>
}

const docsWeb: DocsWebHook = {
  openUrl,
  openBytes,
  lastSaved: () => (lastSaved ? { name: lastSaved.name, bytes: lastSaved.bytes.slice() } : null),
  files: () => backend.list(),
  clearRecents: () => backend.clearRecents(),
}
;(window as unknown as { __docsWeb: DocsWebHook }).__docsWeb = docsWeb

// install.ts merges the default export into window.desktop and assigns
// `.projectApi` to window.projectApi (the extra key leaking onto desktop is harmless)
export default Object.assign(desktopPart, { projectApi })
