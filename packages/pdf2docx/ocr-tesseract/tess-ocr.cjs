/**
 * Bundled Tesseract OCR helper for pdf2docx (see src/ocr-tesseract.ts) — the
 * cross-platform sibling of vision-ocr.swift / win-ocr.cs, speaking the exact
 * same protocol:
 *
 * Reads a PNG from stdin, writes recognized lines as JSON to stdout:
 *   {"paper":0.93,"lines":[{"t":"text","c":0.91,"b":[x0,y0,x1,y1],"chars":[{"t":"a","b":[...]}]}]}
 * Boxes are normalized 0-1, origin BOTTOM-left, y up (PDF page space).
 * "paper" is the near-white pixel share (photo-vs-document signal), computed
 * exactly like win-ocr.cs PaperShare. "c" is the Tesseract line confidence / 100.
 *
 * argv[0]: directory holding <lang>.traineddata (required)
 * argv[1]: language code(s), '+'-joined (default "vie")
 *
 * Plain CommonJS, runs unbundled under `ELECTRON_RUN_AS_NODE=1 <app binary>`
 * or plain node; tesseract.js + pngjs resolve from the node_modules next to
 * this script (packaged: Resources/ocr/tesseract/node_modules, dev: repo root).
 *
 * Engine: Tesseract 5 LSTM (tessdata_fast) through tesseract.js 7 (WASM), page
 * segmentation 11 (sparse text) — the one mode that reads a ruled table and a
 * phone photo as well as plain pages (Phase 1 bench, UNI-2165).
 *
 * NO NETWORK, ever: tesseract.js falls back to a CDN when `langPath` is empty
 * and fetches when it is URL-shaped (worker-script/index.js). Here `langPath`
 * is always a non-empty absolute filesystem path that has been checked to hold
 * the model: path.resolve turns anything URL-looking into a local relative
 * path (which then fails the existence check, exit 4), and tesseract.js reads
 * a non-URL langPath with fs.readFile. cacheMethod 'none' disables every cache
 * read and write.
 *
 * Exit codes: 0 ok; 2 cannot decode input / bad arguments; 3 recognition
 * failed; 4 the language model is not available — callers treat any non-zero
 * exit as "no engine" and keep the fallback chain / bitmap.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const PARENT_PID_ENV = 'GENOFFICE_OCR_PARENT_PID'

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return Boolean(err && err.code === 'EPERM')
  }
}

// Exit if the parent converter crashes or is killed (R1-2 / R2-1).
// When GENOFFICE_OCR_PARENT_PID is set by the spawner, verify immediately at
// startup (before reading stdin or doing any OCR work) and on every 200 ms tick
// that process.ppid matches the expected parent PID and that the expected
// parent is still alive (process.kill(pid, 0) does not throw ESRCH). When unset
// (standalone/CLI use), keep the baseline process.ppid !== initialPpid poll.
function startParentWatch(env = process.env) {
  const rawExpected = env[PARENT_PID_ENV]
  if (typeof rawExpected === 'string' && rawExpected.trim() !== '') {
    const expectedPpid = Number(rawExpected)
    const isOrphaned = () =>
      !Number.isInteger(expectedPpid) ||
      expectedPpid <= 0 ||
      (typeof process.ppid === 'number' && process.ppid > 0 && process.ppid !== expectedPpid) ||
      !isProcessAlive(expectedPpid)
    if (isOrphaned()) {
      process.exit(1)
    }
    const timer = setInterval(() => {
      if (isOrphaned()) {
        process.exit(1)
      }
    }, 200)
    timer.unref()
    return timer
  }

  const initialPpid = process.ppid
  if (typeof initialPpid === 'number' && initialPpid > 0) {
    const timer = setInterval(() => {
      if (process.ppid !== initialPpid) {
        process.exit(1)
      }
    }, 200)
    timer.unref()
    return timer
  }
  return null
}

startParentWatch()

const LANG_CODES = /^[a-z_]{2,12}(\+[a-z_]{2,12})*$/

/** Tesseract sparse text: every text fragment is its own line, ruled tables survive */
const PAGE_SEG_MODE_SPARSE_TEXT = '11'

function fail(code, message) {
  process.stderr.write(`${message}\n`, () => process.exit(code))
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
    process.stdin.on('error', reject)
  })
}

/** near-white pixel share over strided samples (RGBA; alpha composited on white) */
function paperShare(png) {
  const { width, height, data } = png
  const total = width * height
  const stride = Math.max(1, Math.floor(total / 200000))
  let paper = 0
  let sampled = 0
  for (let i = 0; i < total; i += stride) {
    const o = i * 4
    const a = data[o + 3] / 255
    const min = Math.min(data[o], data[o + 1], data[o + 2])
    if (a * min + (1 - a) * 255 >= 200) paper++
    sampled++
  }
  return sampled > 0 ? paper / sampled : 1
}

const num = (v) => Math.round(v * 1e6) / 1e6
/** normalized coordinates stay inside the page: an edge-touching bbox must not round to 1.000001 / -0.000001 */
const unit = (v) => num(Math.min(1, Math.max(0, v)))

/** pixel rect (origin top-left) -> normalized PDF-space box (origin bottom-left) */
function box(b, w, h) {
  return [unit(b.x0 / w), unit(1 - b.y1 / h), unit(b.x1 / w), unit(1 - b.y0 / h)]
}

/**
 * Per-glyph boxes for one line, or null when the line text and the symbol
 * boxes cannot be aligned one-to-one. Gaps between words become zero-box
 * entries (like win-ocr.cs AlignChars — the policy layer spans word gaps
 * itself), so chars.length === [...text].length; a symbol that normalizes to
 * several code points splits its box evenly.
 */
function alignChars(text, words, w, h) {
  const chars = []
  let cursor = 0
  const space = (from, to) => {
    for (const ch of text.slice(from, to)) chars.push({ t: ch, b: [0, 0, 0, 0] })
  }
  for (const word of words) {
    const wt = word.text.normalize('NFC')
    if (wt === '') continue
    const at = text.indexOf(wt, cursor)
    if (at < 0) return null
    space(cursor, at)
    const parts = []
    for (const sym of word.symbols ?? []) {
      const glyphs = [...sym.text.normalize('NFC')]
      const sw = sym.bbox.x1 - sym.bbox.x0
      glyphs.forEach((g, i) => {
        parts.push({
          t: g,
          b: box(
            {
              x0: sym.bbox.x0 + (sw * i) / glyphs.length,
              x1: sym.bbox.x0 + (sw * (i + 1)) / glyphs.length,
              y0: sym.bbox.y0,
              y1: sym.bbox.y1,
            },
            w,
            h,
          ),
        })
      })
    }
    if (parts.map((p) => p.t).join('') !== wt) return null
    chars.push(...parts)
    cursor = at + wt.length
  }
  space(cursor, text.length)
  return [...text].length === chars.length ? chars : null
}

function lineJson(line, w, h) {
  const text = (line.text ?? '').normalize('NFC').replace(/\s+$/, '').replace(/^\s+/, '')
  if (text === '') return null
  const b = line.bbox
  if (!(b.x1 > b.x0 && b.y1 > b.y0)) return null
  const entry = {
    t: text,
    c: Math.min(1, Math.max(0, (line.confidence ?? 0) / 100)),
    b: box(b, w, h),
  }
  const chars = alignChars(text, line.words ?? [], w, h)
  if (chars) entry.chars = chars
  return entry
}

async function main() {
  const [tessdataArg, langArg] = process.argv.slice(2)
  const lang = langArg || 'vie'
  if (!tessdataArg || !LANG_CODES.test(lang))
    return fail(2, 'usage: tess-ocr <tessdata-dir> [lang]')
  const langPath = path.resolve(tessdataArg)
  for (const l of lang.split('+')) {
    if (!fs.existsSync(path.join(langPath, `${l}.traineddata`))) {
      return fail(4, `language model not found: ${path.join(langPath, `${l}.traineddata`)}`)
    }
  }

  const input = await readStdin()
  if (input.length === 0) return fail(2, 'empty input')
  const { PNG } = require('pngjs')
  let png
  try {
    png = PNG.sync.read(input)
  } catch (e) {
    return fail(2, `cannot decode input image: ${e.message}`)
  }

  let lines
  try {
    const { createWorker, OEM } = require('tesseract.js')
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      langPath,
      gzip: false,
      cacheMethod: 'none',
    })
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PAGE_SEG_MODE_SPARSE_TEXT,
        preserve_interword_spaces: '1',
      })
      const { data } = await worker.recognize(input, {}, { blocks: true })
      lines = []
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs ?? []) {
          for (const line of paragraph.lines ?? []) {
            const entry = lineJson(line, png.width, png.height)
            if (entry) lines.push(entry)
          }
        }
      }
    } finally {
      await worker.terminate()
    }
  } catch (e) {
    return fail(3, `recognition failed: ${e && e.message ? e.message : e}`)
  }

  const payload = JSON.stringify({ paper: num(paperShare(png)), lines })
  process.stdout.write(payload, () => process.exit(0))
}

if (require.main === module) {
  main().catch((e) => fail(3, `unexpected failure: ${e && e.stack ? e.stack : e}`))
} else {
  module.exports = { startParentWatch, PARENT_PID_ENV }
}
