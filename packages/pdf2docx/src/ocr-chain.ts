/**
 * Engine order for local OCR: the bundled Tesseract `vie` engine reads first
 * (it is the only engine that keeps Vietnamese tone marks — Windows.Media.Ocr
 * without the Vietnamese pack scores 23.6% CER on the Phase 1 pages), and the
 * platform system engine (Vision / Windows.Media.Ocr) takes a page over when
 * Tesseract has demonstrably not read it. Pure policy: no node imports, the
 * engines are caller-supplied (see ocr-local.ts for the wiring).
 *
 * Hand-over gate — the page goes to the system engine when Tesseract's result
 *  1. is null or has no text (engine missing or failed);
 *  2. has a char-weighted mean line confidence below 0.60. Measured (UNI-2165
 *     bench, tessdata_fast `vie`, PSM 11): Vietnamese pages 0.85-0.96 (ruled
 *     table 0.85, phone photo 0.945), English 0.88-0.90, French 0.86-0.88,
 *     Chinese 0.14-0.17 — the legitimate minimum leaves a 0.25 margin, the
 *     garbled-CJK maximum a 0.43 margin;
 *  3. has more than 5% of its non-space chars outside the repertoire the
 *     model can emit honestly (Latin letters incl. Vietnamese, digits, combining
 *     marks, common punctuation/currency). Measured: every Latin page 0-0.8%
 *     (the table's stray `|`), Chinese pages 9.3-14.6% (`# \ = @ } £ ®` junk).
 *     The Phase 1 brief proposed 30%; the data separates at 5% and 30% would
 *     never fire on the CJK pages (rule 2 catches those anyway — this is the
 *     independent second signal for a page Tesseract is falsely sure about);
 *  4. is ASCII-only Latin text: at least 150 letters and at most 1% of them
 *     outside A-Z/a-z. A Vietnamese page cannot look like that (29.0-29.9% of
 *     its letters are non-ASCII: tone marks, ă â ê ô ơ ư đ), and `vie` reads
 *     such a page slightly WORSE than the system recognizer (English: Tesseract
 *     0.6-0.9% CER vs Windows en-US 0.1-0.4%; non-ASCII letters 0-0.3%).
 *     French stays on Tesseract on purpose: its accents (5.1-5.8% non-ASCII)
 *     put it far above the 1% line, and Tesseract measured BETTER there
 *     (1.1-1.4% vs 1.8-2.8%).
 *
 * The system result replaces Tesseract's only when it holds text; when the
 * system engine is missing, fails or finds nothing, Tesseract's result stays
 * (the downstream gates in ocr.ts still decide between OCR text and bitmap).
 * No system engine (Linux): Tesseract alone.
 */
import type { OcrEngine, OcrRecognition } from './ocr'
import { scriptOf } from './script'

/** below this char-weighted mean line confidence the page is not read */
export const OCR_CHAIN_MIN_CONFIDENCE = 0.6
/** share of non-space chars outside the Latin/Vietnamese repertoire that voids a result */
export const OCR_CHAIN_MAX_FOREIGN_SHARE = 0.05
/** ASCII-only rule: fewer letters than this say nothing about the language */
export const OCR_CHAIN_ASCII_MIN_LETTERS = 150
/** ASCII-only rule: at most this share of letters may be non-ASCII */
export const OCR_CHAIN_ASCII_MAX_ACCENTED = 0.01

/** punctuation and symbols a Latin document legitimately contains */
const REPERTOIRE_PUNCTUATION = new Set([...`.,;:!?'"’‘“”„()[]-–—/«»…%&+°§€$`])
const DIGIT_OR_MARK = /[\p{N}\p{M}]/u
const ASCII_LETTER = /[A-Za-z]/

export type OcrFallbackReason = 'no-result' | 'low-confidence' | 'foreign-script' | 'ascii-only'

function inRepertoire(ch: string): boolean {
  if (REPERTOIRE_PUNCTUATION.has(ch) || DIGIT_OR_MARK.test(ch)) return true
  return scriptOf(ch.codePointAt(0) ?? 0) === 'latin'
}

/**
 * Why a Tesseract result should go to the system engine, or null when it
 * stands (see the gate in the file header).
 */
export function ocrFallbackReason(result: OcrRecognition | null): OcrFallbackReason | null {
  if (!result) return 'no-result'
  let chars = 0
  let confidenceSum = 0
  let foreign = 0
  let letters = 0
  let accented = 0
  for (const line of result.lines) {
    let lineChars = 0
    for (const ch of line.text) {
      if (ch.trim() === '') continue
      lineChars++
      if (!inRepertoire(ch)) foreign++
      if (scriptOf(ch.codePointAt(0) ?? 0) === 'latin') {
        letters++
        if (!ASCII_LETTER.test(ch)) accented++
      }
    }
    chars += lineChars
    confidenceSum += lineChars * line.confidence
  }
  if (chars === 0) return 'no-result'
  if (confidenceSum / chars < OCR_CHAIN_MIN_CONFIDENCE) return 'low-confidence'
  if (foreign / chars > OCR_CHAIN_MAX_FOREIGN_SHARE) return 'foreign-script'
  if (
    letters >= OCR_CHAIN_ASCII_MIN_LETTERS &&
    accented / letters <= OCR_CHAIN_ASCII_MAX_ACCENTED
  ) {
    return 'ascii-only'
  }
  return null
}

const hasText = (r: OcrRecognition | null): r is OcrRecognition =>
  r !== null && r.lines.some((l) => l.text.trim() !== '')

/** an engine that throws is an engine that has nothing for this page */
function attempt(engine: OcrEngine, png: Uint8Array, page: Parameters<OcrEngine>[1]) {
  try {
    return engine(png, page)
  } catch {
    return null
  }
}

/**
 * Primary engine first, system engine as the fallback under the hand-over
 * gate above. Without a fallback the primary engine is returned as is.
 */
export function chainOcrEngines(primary: OcrEngine, fallback: OcrEngine | null): OcrEngine {
  if (!fallback) return primary
  return (png, page) => {
    const first = attempt(primary, png, page)
    if (ocrFallbackReason(first) === null) return first
    const second = attempt(fallback, png, page)
    return hasText(second) ? second : first
  }
}
