/**
 * Export and print in the Slides web frame, all client-side (B5 decision 6, inventory-b5 3.4):
 * the renderer already rasterises every slide to PNG (export-render.tsx), so
 *   - images: one .zip of `<base>-NN.png` (jszip, an engine dependency) as a download,
 *   - PDF: an image-per-page PDF (vector SVG pages are rasterised first, links are not kept), each page the slide as a JPEG (DCTDecode pass-through, no
 *     re-encoding inside the PDF), page 7.5in tall and as wide as the slide ratio, the same
 *     geometry as the desktop's printToPDF export (main/pdf-export.ts exportPageWidthIn),
 *   - print: a hidden `<iframe srcdoc>` with the desktop's print document
 *     (shared/print-html.ts) and `contentWindow.print()`; settles on `afterprint`.
 */
import JSZip from 'jszip'
import { buildPrintDocumentHtml } from '../../../apps/slides/src/shared/print-html'
import type { ExportPdfPage, PrintSlidesOp } from '../../../apps/slides/src/shared/ipc'
import { base64ToBytes } from '../../../apps/slides/src/session/bytes'

export const PDF_PAGE_HEIGHT_IN = 7.5

/** desktop exportPageWidthIn: width by the slide ratio, clamped to [0.2, 5], 16:9 fallback */
export function pageWidthIn(widthPx: number, heightPx: number): number {
  const ratio =
    Number.isFinite(widthPx) && Number.isFinite(heightPx) && heightPx > 0
      ? widthPx / heightPx
      : 16 / 9
  const safe = Number.isFinite(ratio) && ratio > 0 ? Math.min(Math.max(ratio, 0.2), 5) : 16 / 9
  return Math.round(safe * PDF_PAGE_HEIGHT_IN * 1000) / 1000
}

/** `<base>-01.png` ... (3 digits from 100 pages on, like the desktop) */
export function imageFileNames(baseName: string, count: number): string[] {
  const pad = count >= 100 ? 3 : 2
  return Array.from(
    { length: count },
    (_, i) => `${baseName}-${String(i + 1).padStart(pad, '0')}.png`,
  )
}

export async function zipImages(
  baseName: string,
  pngsBase64: readonly string[],
): Promise<Uint8Array> {
  const zip = new JSZip()
  const names = imageFileNames(baseName, pngsBase64.length)
  pngsBase64.forEach((b64, i) => zip.file(names[i]!, base64ToBytes(b64)))
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
}

export interface JpegPage {
  /** baseline or progressive JPEG bytes */
  jpeg: Uint8Array
  /** pixel size of the image */
  width: number
  height: number
}

const enc = new TextEncoder()

/**
 * A minimal PDF 1.4: one page per image, the image scaled to the full page. Every object is
 * written with its byte offset recorded for the xref table.
 */
export function pdfFromJpegs(
  pages: readonly JpegPage[],
  widthIn: number,
  heightIn: number,
): Uint8Array {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (part: string | Uint8Array): void => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part
    chunks.push(bytes)
    size += bytes.length
  }
  const pt = (inches: number): string => (Math.round(inches * 72 * 1000) / 1000).toString()
  const w = pt(widthIn)
  const h = pt(heightIn)
  // objects: 1 catalog, 2 pages, then per page: page, content, image
  const pageObj = (i: number): number => 3 + i * 3
  const object = (n: number, body: string | Uint8Array[], dict?: string): void => {
    offsets[n] = size
    if (typeof body === 'string') {
      push(`${n} 0 obj\n${body}\nendobj\n`)
      return
    }
    push(`${n} 0 obj\n${dict}\nstream\n`)
    for (const b of body) push(b)
    push('\nendstream\nendobj\n')
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  pages.forEach((page, i) => {
    const n = pageObj(i)
    object(
      n,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`,
    )
    const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`)
    object(n + 1, [content], `<< /Length ${content.length} >>`)
    object(
      n + 2,
      [page.jpeg],
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
    )
  })
  const count = 3 + pages.length * 3
  const xref = size
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(table)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** SVG page markup -> PNG (base64) at 2x the slide size; `fontCss` carries the faces it uses */
async function svgToPngBase64(
  svg: string,
  widthPx: number,
  heightPx: number,
  fontCss?: string,
): Promise<string> {
  // an <img> SVG document loads nothing external: the @font-face data URLs go inside it
  const markup = fontCss
    ? svg.replace(/<svg\b[^>]*>/, (open) => `${open}<style>${fontCss}</style>`)
    : svg
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg page decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(widthPx * 2))
    canvas.height = Math.max(1, Math.round(heightPx * 2))
    const g = canvas.getContext('2d')
    if (!g) throw new Error('canvas 2d context unavailable')
    g.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.slice(dataUrl.indexOf(',') + 1)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The desktop's export pages (vector SVG or PNG) as PNGs for the image-per-page PDF */
export async function exportPagesToPngs(op: {
  pages: readonly ExportPdfPage[]
  widthPx: number
  heightPx: number
  fontCss?: string
}): Promise<string[]> {
  const out: string[] = []
  for (const page of op.pages)
    out.push(
      'png' in page
        ? page.png
        : await svgToPngBase64(page.svg, op.widthPx, op.heightPx, op.fontCss),
    )
  return out
}

/** PNG (base64) -> JPEG on a white background (slides are opaque; transparency would turn black) */
export async function pngToJpeg(pngBase64: string, quality = 0.92): Promise<JpegPage> {
  const blob = new Blob([base64ToBytes(pngBase64) as Uint8Array<ArrayBuffer>], {
    type: 'image/png',
  })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const g = canvas.getContext('2d')
  if (!g) throw new Error('canvas 2d context unavailable')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.drawImage(bitmap, 0, 0)
  bitmap.close()
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
  if (!jpeg) throw new Error('JPEG encoding failed')
  return {
    jpeg: new Uint8Array(await jpeg.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  }
}

export async function slidesPdf(op: {
  pngsBase64: readonly string[]
  widthPx: number
  heightPx: number
}): Promise<Uint8Array> {
  const pages: JpegPage[] = []
  for (const png of op.pngsBase64) pages.push(await pngToJpeg(png))
  return pdfFromJpegs(pages, pageWidthIn(op.widthPx, op.heightPx), PDF_PAGE_HEIGHT_IN)
}

/** the print document the desktop prints (same layouts: full / handouts / notes) */
export function printDocument(op: PrintSlidesOp): string {
  return buildPrintDocumentHtml({
    srcs: op.pngsBase64.map((b64) => `data:image/png;base64,${b64}`),
    ratio: op.widthPx / op.heightPx,
    layout: op.layout ?? 'full',
    ...(op.notes ? { notes: op.notes } : {}),
    ...(op.orientation ? { orientation: op.orientation } : {}),
    ...(op.frame ? { frame: true } : {}),
  })
}

/**
 * Print `html` from a hidden same-origin `srcdoc` frame (frame-src 'none' does not apply to
 * about:srcdoc; the document inherits the frame's CSP, which allows data: images and inline
 * styles). Resolves after the browser's print dialog closes.
 */
export function printHtml(html: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.dataset.slidesWeb = 'print'
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    let settled = false
    const done = (r: { ok: boolean; error?: string }): void => {
      if (settled) return
      settled = true
      setTimeout(() => iframe.remove(), 0)
      resolve(r)
    }
    iframe.addEventListener(
      'load',
      () => {
        const win = iframe.contentWindow
        if (!win) return done({ ok: false, error: 'print frame unavailable' })
        const images = Array.from(win.document.images)
        void Promise.all(images.map((img) => img.decode().catch(() => {})))
          .then(() => win.document.fonts?.ready)
          .then(() => {
            win.addEventListener('afterprint', () => done({ ok: true }), { once: true })
            try {
              win.focus()
              win.print()
            } catch (err) {
              return done({ ok: false, error: err instanceof Error ? err.message : String(err) })
            }
            // browsers without afterprint (or a print() that returns after the dialog) settle here
            setTimeout(() => done({ ok: true }), 0)
          })
      },
      { once: true },
    )
    iframe.srcdoc = html
    document.body.append(iframe)
  })
}
