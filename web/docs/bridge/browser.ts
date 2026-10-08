/**
 * BROWSER class shim (W4 - UNI-1011): DesktopApi methods that map onto plain
 * browser features. Merged last into `window.desktop` (see ./install.ts), so
 * only methods that truly belong to this class are exported here.
 *
 * method               | browser implementation                         | deviation from desktop
 * ---------------------|------------------------------------------------|------------------------------------------------
 * getTheme             | localStorage `genoffice.web.theme`, else       | desktop reads shell app-settings.json; web is
 *                      | 'system'                                       | per-origin. data-theme is applied at bridge load
 *                      |                                                | (main.tsx re-applies it identically).
 * onThemeChanged       | in-tab setWebTheme() + `storage` event         | desktop pushes from the shell home page; web
 *                      | (other tabs)                                   | changes come from setWebTheme() / other tabs.
 * getLanguage          | ?lang= URL param > localStorage                | desktop reads app-settings.json. Returns the
 *                      | `genoffice.web.lang` > navigator.languages,    | full 21-locale Lang like getUiLang() does — the
 *                      | via @genoffice/i18n normalizeLang              | DesktopApi type only lists 11 (stale type).
 * onLanguageChanged    | in-tab setWebLanguage() + `storage` event      | same as onThemeChanged.
 * print                | window.print() with a temporary                | no scale (scaleFactor) support: the print-zoom
 *                      | `@page { margin: 0 }` sheet                    | arg is ignored. window.print() gives no
 *                      |                                                | cancel/failure signal → always { ok: true }.
 * pickImage            | <input type=file accept=png/jpeg/gif>          | same shape ({ base64, mime, name }); cancel is
 *                      |                                                | detected via the `cancel` event (+ focus fallback).
 * pickAttachments      | <input type=file multiple>                     | paths are in-memory ids `web-file://<n>/<name>`
 *                      |                                                | backed by the picked File (lost on reload).
 * getPathForFile       | registers the File, returns its web-file:// id | desktop returns a real absolute path (or '' for
 *                      |                                                | pasted bitmaps); web always returns an id.
 * addAttachmentPaths   | validates registered ids (ext/size rules       | unknown / non-web-file paths are rejected;
 *                      | copied from docs-main.ts)                      | messages are English, not tm() translated.
 * addPastedImage       | wraps bytes in a File and registers it         | no temp file on disk.
 * readAttachment       | File.text() for plain-text extensions          | doc/docx/pdf/pptx/xlsx text extraction
 *                      |                                                | (@genoffice/file-parse, Node-only) is not
 *                      |                                                | available → { ok: false, error }.
 * readAttachmentImage  | FileReader → base64 (5 MB cap)                 | none.
 * copyImageToClipboard | navigator.clipboard.write(ClipboardItem        | browsers only accept image/png: non-PNG data
 *                      | image/png + text/html)                         | URLs are re-encoded through a canvas. Needs a
 *                      |                                                | secure context + user activation, else false.
 * fontMetrics          | null                                           | desktop parses installed font files; the web
 *                      |                                                | cannot read font tables → callers use their
 *                      |                                                | documented "family missing" fallback.
 *
 * Not here (decided from the main handlers):
 * - exportPdf / printPdfBuffer / saveMergedPdf use webContents.printToPDF (page
 *   size + PDF bytes), not window.print(): W5. exportHtml is a pure blob
 *   download (W5 may reuse `downloadBlob` below).
 * - System font listing: no DesktopApi method; the renderer already calls
 *   queryLocalFonts() itself (apps/docs/src/renderer/system-fonts.ts).
 * - openExternal / zoom / fullscreen: not part of the Docs DesktopApi.
 */
import { isLang, normalizeLang, type Lang } from '@genoffice/i18n'
import type {
  AttachmentAddResult,
  AttachmentImageResult,
  AttachmentMeta,
  AttachmentReadResult,
  DesktopApi,
  PickImageResult,
  UiTheme,
} from '../../../apps/docs/src/shared/ipc'

type DesktopLang = Awaited<ReturnType<DesktopApi['getLanguage']>>

// ---- shared storage helpers ----

const THEME_KEY = 'genoffice.web.theme'
const LANG_KEY = 'genoffice.web.lang'

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // private mode / blocked storage: the in-tab change still applies
  }
}

/** subscribe to in-tab changes (custom event) and other-tab changes (storage event) */
function subscribe<T>(key: string, read: () => T, handler: (value: T) => void): () => void {
  const onLocal = () => handler(read())
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) handler(read())
  }
  window.addEventListener(`${key}:changed`, onLocal)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(`${key}:changed`, onLocal)
    window.removeEventListener('storage', onStorage)
  }
}

// ---- theme ----

function currentTheme(): UiTheme {
  const saved = readStorage(THEME_KEY)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** same mapping as apps/docs/src/renderer/main.tsx applyTheme */
function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

/** web replacement for the shell home page's theme switch */
export function setWebTheme(theme: UiTheme): void {
  writeStorage(THEME_KEY, theme === 'system' ? null : theme)
  applyTheme(theme)
  window.dispatchEvent(new Event(`${THEME_KEY}:changed`))
}

// ---- language ----

function currentLanguage(): Lang {
  const param = new URLSearchParams(window.location.search).get('lang')
  if (param) return isLang(param) ? param : normalizeLang(param)
  const saved = readStorage(LANG_KEY)
  if (isLang(saved)) return saved
  for (const raw of navigator.languages ?? [navigator.language]) {
    const lang = normalizeLang(raw)
    // normalizeLang falls back to 'en'; only accept 'en' when it was asked for
    if (lang !== 'en' || /^en\b/i.test(raw)) return lang
  }
  return 'en'
}

/** web replacement for the shell home page's language switch */
export function setWebLanguage(lang: Lang | null): void {
  writeStorage(LANG_KEY, lang)
  window.dispatchEvent(new Event(`${LANG_KEY}:changed`))
}

// ---- downloads ----

/** save a Blob through <a download> (pure browser "save to disk") */
export function downloadBlob(name: string, data: Blob): void {
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // revoke after the download has been handed to the browser
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ---- file pickers ----

/** <input type=file>; resolves [] on cancel */
function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(files)
    }
    // browsers without the `cancel` event: the window regains focus after the
    // dialog closes; give `change` a moment to fire first
    const onFocus = () => window.setTimeout(() => finish(Array.from(input.files ?? [])), 500)
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => finish([]))
    window.addEventListener('focus', onFocus, { once: true })
    document.body.appendChild(input)
    input.click()
  })
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

const IMAGE_MIME: Record<string, PickImageResult['mime']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
}

// ---- attachments (rules mirror apps/docs/src/main/docs-main.ts) ----

const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'log',
  'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'go', 'rs', 'rb', 'sh', 'sql', 'css',
])
const ATTACHMENT_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}
const ATTACHMENT_EXTS = new Set([
  ...TEXT_EXTS,
  'doc', 'docx', 'pdf', 'pptx', 'ppt', 'xlsx', 'xlsm', 'xls',
  ...Object.keys(ATTACHMENT_IMAGE_MIME),
])
const READ_MAX_CHARS = 48_000

/** in-memory stand-in for local paths: `web-file://<n>/<name>` → File */
const WEB_FILE_PREFIX = 'web-file://'
const webFiles = new Map<string, File>()
let webFileSeq = 0

function registerFile(file: File): string {
  for (const [path, known] of webFiles) if (known === file) return path
  const path = `${WEB_FILE_PREFIX}${++webFileSeq}/${file.name}`
  webFiles.set(path, file)
  return path
}

function statAttachment(path: string): { meta?: AttachmentMeta; error?: string } {
  const file = webFiles.get(path)
  const name = file?.name ?? path.split('/').pop() ?? path
  if (!file) return { error: `${name}: file is not available in this browser session` }
  const ext = extOf(name)
  if (!ATTACHMENT_EXTS.has(ext)) return { error: `${name}: unsupported file type .${ext}` }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return { error: `${name}: file is larger than ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB` }
  }
  if (ext in ATTACHMENT_IMAGE_MIME && file.size > ATTACHMENT_IMAGE_MAX_BYTES) {
    return { error: `${name}: image is larger than 5 MB` }
  }
  return { meta: { path, name, ext, sizeBytes: file.size } }
}

function collectAttachments(paths: string[]): AttachmentAddResult {
  const accepted: AttachmentMeta[] = []
  const rejected: string[] = []
  for (const p of paths) {
    const { meta, error } = statAttachment(p)
    if (meta) accepted.push(meta)
    else if (error) rejected.push(error)
  }
  return { accepted, rejected }
}

// ---- clipboard ----

// Decoded by hand: the page CSP's connect-src has no `data:`, so fetch(dataUrl) is refused.
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const header = dataUrl.slice(5, comma)
  const body = dataUrl.slice(comma + 1)
  const type = header.split(';')[0] || 'application/octet-stream'
  if (!header.endsWith(';base64')) return new Blob([decodeURIComponent(body)], { type })
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

async function toPngBlob(dataUrl: string): Promise<Blob | null> {
  const blob = dataUrl.startsWith('data:') ? dataUrlToBlob(dataUrl) : await (await fetch(dataUrl)).blob()
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// ---- print ----

const PRINT_PAGE_STYLE_ID = 'web-bridge-print-page'

const browser = {
  getTheme: () => Promise.resolve(currentTheme()),
  onThemeChanged: (handler) => subscribe(THEME_KEY, currentTheme, handler),

  getLanguage: () => Promise.resolve(currentLanguage() as DesktopLang),
  onLanguageChanged: (handler) =>
    subscribe(LANG_KEY, currentLanguage, (lang) => handler(lang as DesktopLang)),

  // scale (print-zoom inverse) has no window.print() equivalent and is ignored
  print: async (_scale?: number) => {
    // desktop prints with marginType 'none' — the docx page padding provides margins
    let style = document.getElementById(PRINT_PAGE_STYLE_ID)
    if (!style) {
      style = document.createElement('style')
      style.id = PRINT_PAGE_STYLE_ID
      style.textContent = '@media print { @page { margin: 0; } }'
      document.head.appendChild(style)
    }
    // Chromium blocks inside print(), Firefox does not: drop the sheet on afterprint
    const sheet = style
    window.addEventListener('afterprint', () => sheet.remove(), { once: true })
    try {
      window.print()
      return { ok: true }
    } catch (err) {
      sheet.remove()
      return { ok: false, error: String(err) }
    }
  },

  pickImage: async () => {
    const [file] = await pickFiles('image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif', false)
    if (!file) return null
    const mime = IMAGE_MIME[extOf(file.name)]
    if (!mime) return null
    return { base64: await readAsBase64(file), mime, name: file.name }
  },

  pickAttachments: async () => {
    const files = await pickFiles([...ATTACHMENT_EXTS].map((e) => `.${e}`).join(','), true)
    if (files.length === 0) return null
    return collectAttachments(files.map(registerFile))
  },

  getPathForFile: (file) => registerFile(file),

  addAttachmentPaths: (paths) => Promise.resolve(collectAttachments(paths)),

  addPastedImage: (data, ext) => {
    const cleanExt = typeof ext === 'string' ? ext.toLowerCase() : ''
    const mime = ATTACHMENT_IMAGE_MIME[cleanExt]
    if (!mime || !data || data.byteLength === 0) {
      return Promise.resolve({ accepted: [], rejected: ['pasted content is not an image'] })
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
    const file = new File([data], `pasted-${stamp}-${webFileSeq + 1}.${cleanExt}`, { type: mime })
    return Promise.resolve(collectAttachments([registerFile(file)]))
  },

  readAttachment: async (path, offset, maxChars): Promise<AttachmentReadResult> => {
    const file = webFiles.get(path)
    const name = file?.name ?? path.split('/').pop() ?? path
    const ext = extOf(name)
    if (!ATTACHMENT_EXTS.has(ext)) return { ok: false, error: `unsupported file type .${ext}` }
    if (ext in ATTACHMENT_IMAGE_MIME) {
      return { ok: false, error: 'images have no text; they are sent to the model as images' }
    }
    if (!file) return { ok: false, error: `${name}: file is not available in this browser session` }
    if (!TEXT_EXTS.has(ext)) {
      return { ok: false, error: `${name}: .${ext} text extraction is not available on the web` }
    }
    try {
      const text = await file.text()
      const start = Math.max(0, Math.floor(offset) || 0)
      const size = Math.min(Math.max(1, Math.floor(maxChars) || 1), READ_MAX_CHARS)
      return {
        ok: true,
        name,
        totalChars: text.length,
        offset: start,
        text: text.slice(start, start + size),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  readAttachmentImage: async (path): Promise<AttachmentImageResult> => {
    const file = webFiles.get(path)
    const name = file?.name ?? path.split('/').pop() ?? path
    const mime = ATTACHMENT_IMAGE_MIME[extOf(name)]
    if (!mime) return { ok: false, error: `${name}: not an image` }
    if (!file) return { ok: false, error: `${name}: file is not available in this browser session` }
    if (file.size > ATTACHMENT_IMAGE_MAX_BYTES) {
      return { ok: false, error: `${name}: image is larger than 5 MB` }
    }
    try {
      return { ok: true, base64: await readAsBase64(file), mime }
    } catch {
      return { ok: false, error: `${name}: unreadable` }
    }
  },

  copyImageToClipboard: async (dataUrl, metaJson) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
    try {
      const png = await toPngBlob(dataUrl)
      if (!png) return false
      // html flavor carries the display size + layout meta (see docs-main.ts r136)
      let size = ''
      let metaAttr = ''
      if (typeof metaJson === 'string' && metaJson.length <= 2048) {
        try {
          const parsed = JSON.parse(metaJson) as Record<string, unknown>
          const w = parsed.imageWidthPx
          const h = parsed.imageHeightPx
          if (typeof w === 'number' && w > 0) size += ` width="${Math.round(w)}"`
          if (typeof h === 'number' && h > 0) size += ` height="${Math.round(h)}"`
          metaAttr = ` data-image-meta="${escapeAttr(metaJson)}"`
        } catch {
          /* malformed payload: plain img */
        }
      }
      const html = `<img src="${dataUrl}"${size}${metaAttr}>`
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': png,
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
      return true
    } catch {
      return false
    }
  },

  fontMetrics: () => Promise.resolve(null),
} satisfies Partial<DesktopApi>

// apply the stored theme before the renderer mounts (main.tsx re-applies it identically)
applyTheme(currentTheme())

export default browser
