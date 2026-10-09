// Usage: /test-host/?open=<docx url>[&frame=/office-frame/docs/<v>/index.html][&lang=en][&theme=dark]
//        /test-host/?module=<pdf|markdown|html|slides|sheets>[&open=<url>][&version=<v>][&readonly=1] (GO-B4/B5/B6)
//        e.g. ?module=pdf&open=/fixtures/sample.pdf (web/fixtures: sample.pdf, sample.md, sample.html)
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
//   addFile(url)     -> fetch a fixture into the store, resolves with its meta (GO-B4)
//   queuePick(id)    -> the next file.pick answers this file (nothing queued = the user cancelled);
//                       file.pick is granted with ?pick=1

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
    return { file: { ...f.meta }, source: { kind: 'bytes', data: f.bytes.slice().buffer } }
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
    return { file: f ? { file: { ...f.meta }, source: { kind: 'bytes', data: f.bytes.slice().buffer } } : null }
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
if (params.get('pick') === '1') initPayload.capabilities.filePick = true

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
  window.__host = {
    module: MODULE,
    lastSaved: () => (lastSaved ? { ...lastSaved, bytes: Array.from(lastSaved.bytes) } : null),
    lastExport: () => lastExport,
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
