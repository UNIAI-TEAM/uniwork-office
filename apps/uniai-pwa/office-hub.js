/**
 * uniAI Office Hub — Bridge launch + on-device preview (local-only blobs).
 * Loaded before app.js; exposes window.UniAIOffice.
 */
;(() => {
  const DOCS_KEY = 'uniai.officeDocs.v1'
  const MEDIA_DB = 'uniai.office.media'
  const MEDIA_STORE = 'blobs'

  /** @typedef {'docs'|'sheets'|'slides'|'pdf'|'markdown'|'html'|'other'} OfficeKind */
  /**
   * @typedef {{
   *   id: string
   *   name: string
   *   kind: OfficeKind
   *   color: string
   *   workProductId?: string
   *   localBlobId?: string
   *   mime?: string
   *   size?: number
   *   source?: 'seed'|'upload'|'cloud'
   *   addedAt?: string
   * }} OfficeDoc
   */

  const KIND_COLOR = {
    docs: '#2b579a',
    sheets: '#217346',
    slides: '#b7472a',
    pdf: '#c43e1c',
    markdown: '#6b7280',
    html: '#e34f26',
    other: '#64748b',
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  /** @param {string} name */
  function kindFromFileName(name) {
    const lower = name.toLowerCase()
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docs'
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'sheets'
    if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'slides'
    if (lower.endsWith('.pdf')) return 'pdf'
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
    return 'other'
  }

  /** @param {OfficeKind|string} kind */
  function officeAppUrl(kind) {
    const k = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html'].includes(kind)
      ? kind
      : 'docs'
    return `uniwork://office/app?kind=${k}`
  }

  /**
   * Launch a custom-protocol URL. Prefer <a> click (keeps user gesture);
   * iframe is a fallback for browsers that ignore programmatic <a> on custom schemes.
   * Avoid assigning window.location — that unloads the PWA.
   */
  function openDeepLink(url) {
    if (!url || typeof url !== 'string') return
    try {
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      /* ignore */
    }
    try {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'display:none;width:0;height:0;border:0'
      iframe.src = url
      document.body.appendChild(iframe)
      window.setTimeout(() => iframe.remove(), 2500)
    } catch {
      /* ignore */
    }
  }

  function openMediaDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(MEDIA_DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('office_media_open_failed'))
    })
  }

  /** @param {string} id @param {Blob} blob */
  async function putBlob(id, blob) {
    const db = await openMediaDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite')
      tx.objectStore(MEDIA_STORE).put(blob, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('office_media_put_failed'))
    })
    db.close()
  }

  /** @param {string} id @returns {Promise<Blob|null>} */
  async function getBlob(id) {
    const db = await openMediaDb()
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly')
      const req = tx.objectStore(MEDIA_STORE).get(id)
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null)
      req.onerror = () => reject(req.error || new Error('office_media_get_failed'))
    })
    db.close()
    return value
  }

  /** @param {string} id */
  async function deleteBlob(id) {
    const db = await openMediaDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite')
      tx.objectStore(MEDIA_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('office_media_delete_failed'))
    })
    db.close()
  }

  function seedDocs() {
    return [
      {
        id: 'd1',
        name: 'Báo cáo tuần.docx',
        kind: 'docs',
        color: KIND_COLOR.docs,
        source: 'seed',
      },
      {
        id: 'd2',
        name: 'Ngân sách Q2.xlsx',
        kind: 'sheets',
        color: KIND_COLOR.sheets,
        source: 'seed',
      },
      {
        id: 'd3',
        name: 'Pitch sản phẩm.pptx',
        kind: 'slides',
        color: KIND_COLOR.slides,
        source: 'seed',
      },
      {
        id: 'd4',
        name: 'Hợp đồng mẫu.pdf',
        kind: 'pdf',
        color: KIND_COLOR.pdf,
        source: 'seed',
      },
      {
        id: 'd5',
        name: 'Ghi chú họp.md',
        kind: 'markdown',
        color: KIND_COLOR.markdown,
        source: 'seed',
      },
    ]
  }

  function loadDocs() {
    try {
      const raw = localStorage.getItem(DOCS_KEY)
      if (!raw) {
        const seed = seedDocs()
        localStorage.setItem(DOCS_KEY, JSON.stringify(seed))
        return seed
      }
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : seedDocs()
    } catch {
      return seedDocs()
    }
  }

  /** @param {OfficeDoc[]} docs */
  function saveDocs(docs) {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs))
  }

  /**
   * Create Bridge session and return launchUrl.
   * @param {{ apiBase: string, accessToken: string, documentId: string }} opts
   */
  async function createOfficeSession(opts) {
    const base = String(opts.apiBase || '').replace(/\/+$/, '')
    if (!base) throw new Error('missing_api_base')
    if (!/^https:\/\//i.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base)) {
      throw new Error('unsafe_api_origin')
    }
    const res = await fetch(`${base}/api/office/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.accessToken || ''}`,
      },
      body: JSON.stringify({ documentId: opts.documentId }),
    })
    if (!res.ok) {
      const err = new Error(`session_${res.status}`)
      err.status = res.status
      throw err
    }
    const body = await res.json()
    const launchUrl = body.launchUrl || body.launch_url
    if (!launchUrl || typeof launchUrl !== 'string' || !launchUrl.startsWith('uniwork://')) {
      throw new Error('bad_launch_url')
    }
    return { launchUrl, sessionId: body.sessionId, expiresAt: body.expiresAt }
  }

  /**
   * Hybrid open: Bridge when cloud id + API configured; else open UniOffice app tab.
   * @param {OfficeDoc} doc
   * @param {{ apiBase?: string, accessToken?: string, onStatus?: (s: string) => void, onFallback?: () => void }} prefs
   */
  async function openInUniWorkOffice(doc, prefs) {
    const onStatus = prefs.onStatus || (() => {})
    const apiBase = (prefs.apiBase || '').trim()
    const token = (prefs.accessToken || '').trim()
    const docId = (doc.workProductId || '').trim()

    if (docId && apiBase && token) {
      onStatus('opening')
      try {
        const { launchUrl } = await createOfficeSession({
          apiBase,
          accessToken: token,
          documentId: docId,
        })
        openDeepLink(launchUrl)
        window.setTimeout(() => {
          onStatus('fallback')
          prefs.onFallback?.()
        }, 2500)
        return { mode: 'bridge' }
      } catch (e) {
        onStatus('failed')
        throw e
      }
    }

    onStatus('app')
    openDeepLink(officeAppUrl(doc.kind))
    // Compat second shot: agent/intent?tab=docs|sheets|… (shell maps to editor)
    window.setTimeout(() => {
      const k = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html'].includes(doc.kind)
        ? doc.kind
        : 'docs'
      openDeepLink(
        `uniwork://agent/intent?tab=${encodeURIComponent(k)}&action=open&source=pwa&summary=${encodeURIComponent(`Open ${k}`)}`,
      )
    }, 350)
    window.setTimeout(() => {
      onStatus('fallback')
      prefs.onFallback?.()
    }, 2500)
    return { mode: 'app' }
  }

  /**
   * @param {File} file
   * @returns {Promise<OfficeDoc>}
   */
  async function ingestLocalFile(file) {
    const kind = kindFromFileName(file.name)
    const localBlobId = uid()
    await putBlob(localBlobId, file)
    return {
      id: uid(),
      name: file.name,
      kind,
      color: KIND_COLOR[kind] || KIND_COLOR.other,
      localBlobId,
      mime: file.type || undefined,
      size: file.size,
      source: 'upload',
      addedAt: new Date().toISOString(),
    }
  }

  /** Previewability for in-PWA read-only view. */
  function canPreviewInPwa(doc) {
    if (!doc.localBlobId) return false
    return (
      doc.kind === 'pdf' ||
      doc.kind === 'markdown' ||
      doc.kind === 'html' ||
      (doc.mime && doc.mime.startsWith('image/')) ||
      /\.(txt|csv|md|markdown|html?)$/i.test(doc.name)
    )
  }

  /**
   * @param {OfficeDoc} doc
   * @returns {Promise<{ type: string, url?: string, text?: string, revoke?: () => void }|null>}
   */
  async function loadPreview(doc) {
    if (!doc.localBlobId) return null
    const blob = await getBlob(doc.localBlobId)
    if (!blob) return null
    if (doc.kind === 'pdf' || doc.mime === 'application/pdf') {
      const url = URL.createObjectURL(blob)
      return { type: 'pdf', url, revoke: () => URL.revokeObjectURL(url) }
    }
    if (doc.mime && doc.mime.startsWith('image/')) {
      const url = URL.createObjectURL(blob)
      return { type: 'image', url, revoke: () => URL.revokeObjectURL(url) }
    }
    if (
      doc.kind === 'markdown' ||
      doc.kind === 'html' ||
      /\.(txt|csv|md|markdown|html?)$/i.test(doc.name)
    ) {
      const text = await blob.text()
      return { type: doc.kind === 'html' ? 'html' : 'text', text }
    }
    return { type: 'binary' }
  }

  window.UniAIOffice = {
    KIND_COLOR,
    uid,
    kindFromFileName,
    officeAppUrl,
    openDeepLink,
    loadDocs,
    saveDocs,
    seedDocs,
    putBlob,
    getBlob,
    deleteBlob,
    createOfficeSession,
    openInUniWorkOffice,
    ingestLocalFile,
    canPreviewInPwa,
    loadPreview,
  }
})()
