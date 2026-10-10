// Usage: /test-host/?open=<docx url>[&frame=/office-frame/docs/<v>/index.html][&lang=en][&theme=dark]
//        /test-host/?module=<pdf|markdown|html|slides|sheets>[&open=<url>][&version=<v>][&readonly=1] (GO-B4/B5/B6)
//        e.g. ?module=pdf&open=/fixtures/sample.pdf (web/fixtures: sample.pdf, sample.md, sample.html)
//        &recovery=1: draft recovery on (CONTRACT C18 / C18a): `init.recovery` carries a non-extractable
//        AES-GCM key and the scope "test-user:<documentId>". Like the real host, the key is persisted
//        (structured clone, never exported) in IndexedDB "uniwork-office-frame-drafts", store "keys",
//        key "test-user": a frame reload, a host page reload and a second tab all get the same key
//        &ai=1 grants `ai` + webSearch/imageSearch/imageGeneration (fake AI routes, web/server/fake-ai.mjs)
//        &images=1 grants `images`: api.images.upload keeps the bytes (__host.uploads()) and answers
//        {imageId, url: /e2e-assets/<name>}; the spec serves that URL with page.route (UNI-1232 A1)
//        &assets=<json> puts {path as written: same-origin URL} into api.open's OpenPayload.assets
//        &desktopOpen=1 grants `desktopOpen`: app.open requests are kept (__host.appOpens()) and answered with
//        &appOpen=<launched|installer|unavailable> (default launched) (UNI-1232 A7)
//
// module (default docs): the frame defaults to /office-frame/<module>/<version|latest>/index.html (docs keeps
// the site root, as before), `init.module` names the module, and the host refuses a frame whose
// `ready.module` (absent = docs) differs, like createDocsFrameHost({ module }) (status "module mismatch").
// Module runs also send `init.user` ({displayName: 'Test User'}); readonly=1 withholds the `save` grant
// (view-only, protocol README "Read-only documents"). No autosave is ever requested (CONTRACT C10).
//
// Test host for the Docs frame (GO-B3 e2e): a minimal, dependency-free
// implementation of the host side of the W2 protocol (web/docs/protocol/types.ts)
// over an in-memory file store. Not the UniWork host (that is W5, packages/views/office).
//
// window.__host (driven by web/e2e):
//   lastSaved()      -> {fileId, name, versionId, bytes: number[]} | null
//   events           -> frame events received ({type, payload})
//   files()          -> [{fileId, name, versionId, size}]
//   request(type, p) -> send a host->frame request (open/save/saveAs/print), resolves with the response
//   send(type, p)    -> send a host->frame event (theme / language / ...)
//   bumpRemote(id)   -> simulate a concurrent server-side save (next frame save conflicts)
//   lastExport()     -> {fileId, name, dataBytes: number[] | null} of the last api.export | null
//   uploads()        -> the api.images.upload requests so far ({fileId, name, mimeType, bytes: number[]})
//   appOpens()       -> the app.open requests so far ({feature})
//   addFile(url)     -> fetch a fixture into the store, resolves with its meta (GO-B4)
//   queuePick(id)    -> the next file.pick answers this file (nothing queued = the user cancelled);
//                       file.pick is granted with ?pick=1
//   newSessionKey()  -> replace the persisted recovery key by a new one (the old drafts stay but cannot be
//                       read any more); the next init carries it
//   signOut()        -> delete the whole frame-drafts database (what the real host does on sign-out)
//   documentId       -> the init document's file id

const NS = 'uniwork.office.docs'
const V = 1
const ORIGIN = location.origin
const frame = document.getElementById('frame')
const statusEl = document.getElementById('status')

const files = new Map() // fileId -> {meta, bytes: Uint8Array}
let seq = 0
let lastSaved = null
let lastExport = null
const events = []
const uploads = [] // api.images.upload requests: {fileId, name, mimeType, bytes}
const appOpens = [] // app.open requests: {feature}
const picks = [] // fileIds the next file.pick requests answer, in order
const pending = new Map() // id -> {resolve, reject}
let reqSeq = 0

function put(name, bytes, fileId = `f${++seq}`) {
  const prev = files.get(fileId)
  const n = prev ? Number(prev.meta.versionId.slice(1)) + 1 : 1
  const meta = {
    fileId,
    name,
    versionId: `v${n}`,
    etag: `"${fileId}-v${n}"`,
    sizeBytes: bytes.byteLength,
  }
  files.set(fileId, { meta, bytes: bytes.slice() })
  return meta
}

function post(msg) {
  frame.contentWindow.postMessage({ ns: NS, v: V, ...msg }, ORIGIN)
}

function request(type, payload) {
  const id = `h${++reqSeq}`
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    post({ id, kind: 'request', type, payload })
  })
}

const apiError = (code, message, status) => ({ code, message, ...(status ? { status } : {}) })

const handlers = {
  'token.refresh': () => ({ token: `t-${Date.now()}`, tokenExpiresAt: Date.now() + 3_600_000 }),
  'api.open': ({ fileId }) => {
    const f = files.get(fileId)
    if (!f) throw apiError('not_found', `no file ${fileId}`, 404)
    return {
      file: { ...f.meta },
      source: { kind: 'bytes', data: f.bytes.slice().buffer },
      ...(ASSETS ? { assets: ASSETS } : {}),
    }
  },
  'api.save': ({ fileId, data, etag }) => {
    const f = files.get(fileId)
    if (!f) throw apiError('not_found', `no file ${fileId}`, 404)
    if (etag !== undefined && etag !== f.meta.etag) {
      return { ok: false, error: apiError('conflict', 'document changed on the server', 412) }
    }
    const meta = put(f.meta.name, new Uint8Array(data), fileId)
    lastSaved = { ...meta, bytes: new Uint8Array(data) }
    return { ok: true, file: meta, versionId: meta.versionId }
  },
  'api.saveAs': ({ name, data }) => {
    const meta = put(name, new Uint8Array(data))
    lastSaved = { ...meta, bytes: new Uint8Array(data) }
    return { ok: true, file: meta, versionId: meta.versionId }
  },
  'api.recents': ({ limit }) => ({
    files: [...files.values()]
      .map((f) => f.meta)
      .reverse()
      .slice(0, limit ?? 20),
  }),
  'file.pick': () => {
    const f = files.get(picks.shift())
    return {
      file: f
        ? { file: { ...f.meta }, source: { kind: 'bytes', data: f.bytes.slice().buffer } }
        : null,
    }
  },
  'api.images.upload': ({ fileId, name, mimeType, data }) => {
    uploads.push({ fileId, name, mimeType, bytes: Array.from(new Uint8Array(data)) })
    return { imageId: `img-${uploads.length}`, url: `/e2e-assets/${name}` }
  },
  'app.open': (payload) => {
    appOpens.push({ feature: payload?.feature })
    return { outcome: params.get('appOpen') || 'launched' }
  },
  // no server render in the harness: record what the frame sent, answer a stub PDF
  'api.export': ({ fileId, name, data }) => {
    lastExport = {
      fileId: fileId ?? null,
      name,
      dataBytes: data ? Array.from(new Uint8Array(data)) : null,
    }
    return {
      data: new TextEncoder().encode('%PDF-1.4 test-host stub').buffer,
      mimeType: 'application/pdf',
      name,
    }
  },
}

window.addEventListener('message', async (e) => {
  if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return
  const m = e.data
  if (!m || m.ns !== NS || m.v !== V) return
  if (m.kind === 'event') {
    events.push({ type: m.type, payload: m.payload })
    if (m.type === 'ready') {
      const frameModule = m.payload?.module ?? 'docs'
      if (frameModule !== MODULE) {
        statusEl.textContent = `module mismatch: frame ${frameModule}, document ${MODULE}`
        return
      }
      statusEl.textContent = 'frame ready, sending init'
      try {
        await request('init', initPayload)
        statusEl.textContent = `initialised (${initPayload.documentId})`
      } catch (err) {
        statusEl.textContent = `init failed: ${err.message}`
      }
    }
    return
  }
  if (m.kind === 'response') {
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(Object.assign(new Error(m.error.message), m.error))
    else p.resolve(m.payload)
    return
  }
  if (m.kind === 'request') {
    const handler = handlers[m.type]
    try {
      if (!handler) throw apiError('unknown_type', `no handler for ${m.type}`)
      post({ id: m.id, kind: 'response', type: m.type, payload: await handler(m.payload) })
    } catch (err) {
      const error = err && err.code ? err : apiError('internal', String(err?.message ?? err))
      post({ id: m.id, kind: 'response', type: m.type, error })
    }
  }
})

const params = new URLSearchParams(location.search)
const MODULE = params.get('module') || 'docs'
const DEFAULT_NAME = {
  docs: 'Untitled.docx',
  pdf: 'Untitled.pdf',
  markdown: 'Untitled.md',
  html: 'Untitled.html',
  slides: 'Untitled.pptx',
  sheets: 'Untitled.xlsx',
}
const initPayload = {
  protocolVersion: V,
  token: 'test-token',
  tokenExpiresAt: Date.now() + 3_600_000,
  documentId: '',
  workspaceId: 'ws-test',
  apiBase: `${ORIGIN}/api`,
  apiMode: 'host-proxy',
  locale: params.get('lang') || 'zh',
  theme: params.get('theme') === 'dark' ? 'dark' : 'light',
  capabilities: {
    save: true,
    saveAs: true,
    recents: true,
    print: true,
    exportPdf: true,
    exportHtml: true,
  },
  // absent = docs: a docs run sends exactly the pre-module init
  ...(MODULE !== 'docs' ? { module: MODULE, user: { displayName: 'Test User' } } : {}),
}
if (params.get('readonly') === '1') delete initPayload.capabilities.save
// ai=1: grant the web AI (CONTRACT C16) and its cloud tools; the frame then calls the fake
// frame-token AI routes of web/server/fake-ai.mjs. Absent = no AI grant (AI hidden, as before).
if (params.get('ai') === '1') {
  Object.assign(initPayload.capabilities, {
    ai: true,
    webSearch: true,
    imageSearch: true,
    imageGeneration: true,
  })
}
if (params.get('pick') === '1') initPayload.capabilities.filePick = true
if (params.get('images') === '1') initPayload.capabilities.images = true
if (params.get('desktopOpen') === '1') initPayload.capabilities.desktopOpen = true
const ASSETS = params.get('assets') ? JSON.parse(params.get('assets')) : null

const KEY_DB = 'uniwork-office-frame-drafts'
const KEY_USER = 'test-user'

/** the shared frame database, as the real host opens it: version 1, both stores created if absent */
function openKeyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB, 1)
    req.onupgradeneeded = () => {
      for (const name of ['drafts', 'keys']) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name)
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}

async function keyStore(mode, run) {
  const db = await openKeyDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('keys', mode)
      const result = run(tx.objectStore('keys'))
      tx.oncomplete = () => resolve(result.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

function newKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** the persisted per-user key, created on first need (what the real host does) */
async function persistedKey(replace) {
  const existing = replace ? undefined : await keyStore('readonly', (s) => s.get(KEY_USER))
  if (existing) return existing
  const key = await newKey()
  await keyStore('readwrite', (s) => s.put(key, KEY_USER))
  return key
}

async function useKey(replace) {
  const key = await persistedKey(replace)
  initPayload.recovery = { key, scope: `${KEY_USER}:${initPayload.documentId}` }
}

const newSessionKey = () => useKey(true)

function signOut() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(KEY_DB)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}

async function boot() {
  const url = params.get('open')
  if (url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
    const name = decodeURIComponent(
      new URL(url, location.href).pathname.split('/').pop() || 'document.docx',
    )
    initPayload.documentId = put(name, new Uint8Array(await res.arrayBuffer())).fileId
  } else {
    initPayload.documentId = put(DEFAULT_NAME[MODULE] ?? 'Untitled', new Uint8Array()).fileId
  }
  if (params.get('recovery') === '1') await useKey(false)
  window.__host = {
    module: MODULE,
    documentId: initPayload.documentId,
    newSessionKey,
    signOut,
    lastSaved: () => (lastSaved ? { ...lastSaved, bytes: Array.from(lastSaved.bytes) } : null),
    lastExport: () => lastExport,
    uploads: () => uploads.map((u) => ({ ...u })),
    appOpens: () => appOpens.map((a) => ({ ...a })),
    events,
    files: () => [...files.values()].map((f) => ({ ...f.meta, size: f.bytes.byteLength })),
    request,
    // host -> frame event, e.g. send('theme', {theme: 'dark'}), send('language', {locale: 'vi'})
    send: (type, payload) => post({ id: `h${++reqSeq}`, kind: 'event', type, payload }),
    addFile: async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
      const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop())
      return put(name, new Uint8Array(await res.arrayBuffer()))
    },
    queuePick: (fileId) => picks.push(fileId),
    bumpRemote: (fileId) => {
      const f = files.get(fileId)
      return f ? put(f.meta.name, f.bytes, fileId) : null
    },
  }
  // docs: the web/docs build at the site root by default; other modules: their /office-frame/ path.
  // ?frame=<path> overrides (MOUNT prefix, a pinned version dir)
  const defaultFrame =
    MODULE === 'docs'
      ? '/index.html'
      : `/office-frame/${MODULE}/${params.get('version') || 'latest'}/index.html`
  frame.src = new URL(params.get('frame') || defaultFrame, location.origin).pathname
}

boot().catch((err) => {
  statusEl.textContent = `boot failed: ${err.message}`
})
