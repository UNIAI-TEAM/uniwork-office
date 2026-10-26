/**
 * Engine order for local OCR: the bundled Tesseract `vie` engine reads first
 * and the platform system engine (Vision / Windows.Media.Ocr) takes a page
 * over when Tesseract has demonstrably not read it. Tesseract-first is
 * measured against Windows.Media.Ocr WITHOUT the Vietnamese language pack
 * (23.6% CER on the Phase 1 pages, Tesseract 0.4-1%); macOS Vision and
 * Windows with the Vietnamese pack installed were NOT measured (follow-up).
 * Pure policy: no node imports, the engines are caller-supplied (see
 * ocr-local.ts for the wiring); a sync and an async chain share one decision.
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
 *     marks, punctuation, currency and the ASCII symbols forms use). Pure
 *     rule/leader glyphs (`_ | - — – = . · …` and runs of them: fill-in lines,
 *     ruled tables, dot leaders) are neither foreign nor part of the base the
 *     share is taken over. Measured: every Latin page ~0-0.8%, Chinese pages
 *     junk (see the tests for the current shares). The data separates well
 *     below the 30% the Phase 1 brief proposed; rule 2 catches the CJK pages
 *     anyway — this is the independent second signal for a page Tesseract is
 *     falsely sure about;
 *  4. is ASCII-only Latin text: at least 150 letters and at most 1% of them
 *     outside A-Z/a-z. A Vietnamese page cannot look like that (29.0-29.9% of
 *     its letters are non-ASCII: tone marks, ă â ê ô ơ ư đ), and `vie` reads
 *     such a page slightly WORSE than the system recognizer (English: Tesseract
 *     0.6-0.9% CER vs Windows en-US 0.1-0.4%; non-ASCII letters 0-0.3%).
 *     French stays on Tesseract on purpose: its accents (5.1-5.8% non-ASCII)
 *     put it far above the 1% line, and Tesseract measured BETTER there
 *     (1.1-1.4% vs 1.8-2.8%).
 *
 * What the chain returns. The system result replaces Tesseract's only when it
 * holds text. When the gate flagged Tesseract with rule 1, 2 or 3 and the
 * system engine has nothing (missing, fails, finds nothing, or there is no
 * system engine at all — Linux), the chain returns null: a page the `vie`
 * model cannot read (zh/ja/ko/ru/..., or a mixed page) must keep its scan
 * bitmap, because the downstream gates in ocr.ts only look at the lines that
 * survive a per-line cut and could let a few junk/Latin lines of such a page
 * replace the bitmap with a text-less document. Rule 4 (English) is not a
 * failure of Tesseract: with nothing from the system engine its text stands.
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

/** punctuation and symbols a Latin document legitimately contains: prose
 * punctuation, currency (incl. the dong sign), list/legal/math marks, and the
 * ASCII symbols forms use (`_ | = # @ < > ~ *`) */
const REPERTOIRE_PUNCTUATION = new Set([...`.,;:!?'"’‘“”„()[]-–—/«»…%&+°§€$₫•·×©™№≥≤→←±*_|=#@<>~`])
/** pure rule / leader glyphs (fill-in lines, ruled tables, dot leaders): left
 * out of the foreign count AND of the base the foreign share is taken over */
const RULE_GLYPHS = new Set([...'_|-—–=.·…'])
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
  let measured = 0
  let letters = 0
  let accented = 0
  for (const line of result.lines) {
    let lineChars = 0
    for (const ch of line.text) {
      if (ch.trim() === '') continue
      lineChars++
      if (!RULE_GLYPHS.has(ch)) {
        measured++
        if (!inRepertoire(ch)) foreign++
      }
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
  if (measured > 0 && foreign / measured > OCR_CHAIN_MAX_FOREIGN_SHARE) return 'foreign-script'
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

/** the same decision for the sync and the async chain: what a flagged first result becomes */
function settle(
  first: OcrRecognition | null,
  reason: OcrFallbackReason,
  second: OcrRecognition | null,
): OcrRecognition | null {
  if (hasText(second)) return second
  // `ascii-only` is a good Tesseract read the system engine merely does a bit better;
  // everything else means the page was NOT read — a bitmap beats junk text
  return reason === 'ascii-only' ? first : null
}

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
 * gate above. The gate always runs, with or without a fallback (Linux): a
 * flagged result with nothing behind it is null, not the flagged result.
 */
export function chainOcrEngines(primary: OcrEngine, fallback: OcrEngine | null): OcrEngine {
  return (png, page) => {
    const first = attempt(primary, png, page)
    const reason = ocrFallbackReason(first)
    if (reason === null) return first
    return settle(first, reason, fallback ? attempt(fallback, png, page) : null)
  }
}

/** asynchronous engine: the viewer bridge must not block the main process */
export type AsyncOcrEngine = (
  png: Uint8Array,
  page: Parameters<OcrEngine>[1],
) => Promise<OcrRecognition | null>

async function attemptAsync(
  engine: AsyncOcrEngine,
  png: Uint8Array,
  page: Parameters<OcrEngine>[1],
) {
  try {
    return await engine(png, page)
  } catch {
    return null
  }
}

/** async twin of chainOcrEngines: same gate, same decision, engines awaited */
export function chainOcrEnginesAsync(
  primary: AsyncOcrEngine,
  fallback: AsyncOcrEngine | null,
): AsyncOcrEngine {
  return async (png, page) => {
    const first = await attemptAsync(primary, png, page)
    const reason = ocrFallbackReason(first)
    if (reason === null) return first
    return settle(first, reason, fallback ? await attemptAsync(fallback, png, page) : null)
  }
}
