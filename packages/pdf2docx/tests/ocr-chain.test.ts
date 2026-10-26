/** Hand-over gate between the bundled Tesseract engine and the system engine
 * (src/ocr-chain.ts): every branch of the gate, with fake engines. */
import { describe, expect, it, vi } from 'vitest'
import type { OcrEngine, OcrLine, OcrRecognition } from '../src/ocr'
import {
  chainOcrEngines,
  chainOcrEnginesAsync,
  OCR_CHAIN_ASCII_MIN_LETTERS,
  ocrFallbackReason,
  type AsyncOcrEngine,
} from '../src/ocr-chain'

const PAGE = { widthPt: 612, heightPt: 792 }
const PNG = new Uint8Array([1, 2, 3])
const box = { x0: 0.1, y0: 0.8, x1: 0.9, y1: 0.83 }

const line = (text: string, confidence = 0.9): OcrLine => ({ text, confidence, box })
const rec = (...lines: OcrLine[]): OcrRecognition => ({ lines, paperShare: 0.95 })

const VI_TEXT = 'Hôm nay, ngày 15 tháng 9 năm 2026, tại văn phòng công ty ở Hà Nội,'
const VI_BASE = VI_TEXT.replace(/\s/g, '')
/** the first n non-space chars of Vietnamese text */
const viChars = (n: number) => (VI_BASE + VI_BASE).slice(0, n)
/** symbols outside the repertoire (code-ish / currency junk the `vie` model emits for CJK) */
const JUNK = '\\}£®¥^`¤'
/** ASCII English prose with exactly n letters */
const ascii = (letters: number) =>
  'abcdefghij '.repeat(Math.ceil(letters / 10)).slice(0, letters + Math.floor(letters / 10))

describe('ocrFallbackReason', () => {
  it('lets a Vietnamese result stand', () => {
    expect(ocrFallbackReason(rec(line(VI_TEXT, 0.95)))).toBeNull()
  })

  it('hands over a missing or empty result', () => {
    expect(ocrFallbackReason(null)).toBe('no-result')
    expect(ocrFallbackReason(rec())).toBe('no-result')
    expect(ocrFallbackReason(rec(line('   ')))).toBe('no-result')
  })

  it('hands over below 0.60 mean confidence and keeps exactly 0.60', () => {
    expect(ocrFallbackReason(rec(line(VI_TEXT, 0.59)))).toBe('low-confidence')
    expect(ocrFallbackReason(rec(line(VI_TEXT, 0.6)))).toBeNull()
  })

  it('weights the mean by chars, not by lines', () => {
    // one long garbled line + one short confident line: the line mean is
    // 0.575 (< 0.60 is not what matters) — the char mean decides
    const garbled = line(VI_TEXT.repeat(3), 0.3)
    const short = line('Hà Nội', 0.99)
    expect(ocrFallbackReason(rec(garbled, short))).toBe('low-confidence')
    // the reverse: a long confident line outweighs one short garbled line
    expect(ocrFallbackReason(rec(line(VI_TEXT.repeat(3), 0.95), line('x', 0.1)))).toBeNull()
  })

  it('hands over a confident result full of characters the model cannot emit honestly', () => {
    // 8 of 100 non-space chars are junk symbols: 8% > 5%
    const text = viChars(92) + JUNK
    expect([...text].length).toBe(100)
    expect(ocrFallbackReason(rec(line(text, 0.9)))).toBe('foreign-script')
    // 4 of 100 stays (a ruled table's stray `|` is 0.8% in the bench)
    expect(ocrFallbackReason(rec(line(viChars(96) + JUNK.slice(0, 4), 0.9)))).toBeNull()
  })

  it('keeps the ASCII symbols and marks a Vietnamese form legitimately contains', () => {
    // 12 of 100 chars are `_ | = # @ < > ~ * • ₫ ×`: all inside the repertoire
    const form = viChars(88) + '_|=#@<>~*•₫×'
    expect([...form].length).toBe(100)
    expect(ocrFallbackReason(rec(line(form, 0.9)))).toBeNull()
    expect(
      ocrFallbackReason(
        rec(
          line('Họ và tên: ________________  Ngày sinh: ____/____/______', 0.9),
          line(
            'Số tiền: 1.250.000 ₫ • Email: nguyen.van.a@example.vn | Mã số #A-12 ≥ 5% ≤ 9%',
            0.9,
          ),
          line('© 2026 Công ty™ — Số № 7 → xem mục 3 ← ± 2° ×3', 0.9),
        ),
      ),
    ).toBeNull()
  })

  it('leaves rule/leader glyphs out of both sides of the foreign share', () => {
    const rules = '_'.repeat(150) + '|'.repeat(50) + '.'.repeat(60) + '-—–=·…'.repeat(10)
    // 4 junk of 100 real chars + 320 rule glyphs: 4% (not 0.95%) — stays
    expect(ocrFallbackReason(rec(line(viChars(96) + JUNK.slice(0, 4) + rules, 0.9)))).toBeNull()
    // 6 junk of 100 real chars + the same rules: 6% > 5% — the rules do not dilute it
    expect(ocrFallbackReason(rec(line(viChars(94) + JUNK.slice(0, 6) + rules, 0.9)))).toBe(
      'foreign-script',
    )
    // a page of nothing but rules says nothing about the script
    expect(ocrFallbackReason(rec(line(rules, 0.9)))).toBeNull()
  })

  it('counts CJK as outside the repertoire', () => {
    expect(ocrFallbackReason(rec(line('会议纪要项目管理委员会第三次会议', 0.9)))).toBe(
      'foreign-script',
    )
  })

  it('does not count digits, marks or common punctuation as foreign', () => {
    expect(
      ocrFallbackReason(rec(line('125.000.000 đ (10%) — «tổng»: 5 + 3 & €7 §2…', 0.9))),
    ).toBeNull()
  })

  it('hands over long ASCII-only Latin text (system OCR reads it better)', () => {
    expect(ocrFallbackReason(rec(line(ascii(OCR_CHAIN_ASCII_MIN_LETTERS), 0.9)))).toBe('ascii-only')
  })

  it('keeps ASCII text too short to say anything about the language', () => {
    expect(ocrFallbackReason(rec(line(ascii(OCR_CHAIN_ASCII_MIN_LETTERS - 1), 0.9)))).toBeNull()
  })

  it('keeps French: its accents put it above the 1% line', () => {
    const french =
      "Décisions : corriger les polices des anciens formulaires ; revoir les droits d'accès ; " +
      'le dépassement budgétaire ne doit pas excéder le plafond. Où est le cœur du problème ? ' +
      "C'est déjà très clair, la réunion est close à midi et demi."
    expect([...french].filter((c) => /[a-z]/i.test(c)).length).toBeGreaterThan(
      OCR_CHAIN_ASCII_MIN_LETTERS,
    )
    expect(ocrFallbackReason(rec(line(french, 0.88)))).toBeNull()
  })

  it('tolerates a single stray accent in a long English page', () => {
    // 1 accented letter in 200 = 0.5% <= 1%
    expect(ocrFallbackReason(rec(line(ascii(199) + 'é', 0.9)))).toBe('ascii-only')
    // 3 accented letters in 200 = 1.5% > 1%
    expect(ocrFallbackReason(rec(line(ascii(197) + 'ééé', 0.9)))).toBeNull()
  })
})

/** a page the `vie` model cannot read (zh) with a few Latin lines on it */
const MIXED = rec(
  line('会议纪要项目管理委员会第三次会议', 0.5),
  line('技术组报告了数据迁移的进度完成', 0.55),
  line('财务部建议增加测试人员的预算', 0.6),
  line('河内办公室第三会议室二〇二六年', 0.52),
  line('Hà Nội 2026', 0.95),
  line('Phòng 3', 0.9),
)

describe('chainOcrEngines', () => {
  const engine = (result: OcrRecognition | null): OcrEngine => vi.fn(() => result)
  const good = rec(line(VI_TEXT, 0.95))
  const system = rec(line('system result', 1))
  const boom: OcrEngine = () => {
    throw new Error('spawn failed')
  }

  it('lets a good primary result through without a fallback (Linux)', () => {
    expect(chainOcrEngines(engine(good), null)(PNG, PAGE)).toBe(good)
  })

  it('does not call the fallback when the primary result stands', () => {
    const primary = engine(good)
    const fallback = engine(system)
    expect(chainOcrEngines(primary, fallback)(PNG, PAGE)).toBe(good)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('passes the page render and size to both engines', () => {
    const primary = engine(null)
    const fallback = engine(system)
    chainOcrEngines(primary, fallback)(PNG, PAGE)
    expect(primary).toHaveBeenCalledWith(PNG, PAGE)
    expect(fallback).toHaveBeenCalledWith(PNG, PAGE)
  })

  it.each([
    ['a null primary result', null],
    ['an empty primary result', rec()],
    ['a low-confidence primary result', rec(line(VI_TEXT, 0.2))],
    ['a primary result of foreign symbols', rec(line(JUNK.repeat(5), 0.9))],
    ['a mixed junk + Latin page', MIXED],
    ['long ASCII-only primary text', rec(line(ascii(300), 0.9))],
  ])('hands %s to the fallback', (_name, primaryResult) => {
    const fallback = engine(system)
    expect(chainOcrEngines(engine(primaryResult), fallback)(PNG, PAGE)).toBe(system)
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  describe('a page Tesseract did not read keeps its bitmap (null) when nothing else reads it', () => {
    const unread = [
      ['no result', null],
      ['an empty result', rec()],
      ['low confidence', rec(line(VI_TEXT, 0.2))],
      ['foreign script', rec(line('会议纪要项目管理委员会第三次会议', 0.9))],
      ['a mixed junk + Latin page (junk lines at 0.5-0.6)', MIXED],
    ] as const
    const fallbacks = [
      ['returns null', engine(null)],
      ['finds no text', engine(rec())],
      ['finds only blanks', engine(rec(line(' ')))],
      ['throws', boom],
    ] as const

    for (const [why, primaryResult] of unread) {
      for (const [how, fallback] of fallbacks) {
        it(`${why}, system engine ${how}`, () => {
          expect(chainOcrEngines(engine(primaryResult), fallback)(PNG, PAGE)).toBeNull()
        })
      }
      it(`${why}, no system engine (Linux)`, () => {
        expect(chainOcrEngines(engine(primaryResult), null)(PNG, PAGE)).toBeNull()
      })
    }
  })

  it('keeps Tesseract text for English (ascii-only) when the fallback has nothing, with or without one', () => {
    const english = rec(line(ascii(300), 0.9))
    expect(chainOcrEngines(engine(english), engine(null))(PNG, PAGE)).toBe(english)
    expect(chainOcrEngines(engine(english), engine(rec()))(PNG, PAGE)).toBe(english)
    expect(chainOcrEngines(engine(english), engine(rec(line(' '))))(PNG, PAGE)).toBe(english)
    expect(chainOcrEngines(engine(english), boom)(PNG, PAGE)).toBe(english)
    expect(chainOcrEngines(engine(english), null)(PNG, PAGE)).toBe(english)
  })

  it('treats a throwing engine as a null result', () => {
    expect(chainOcrEngines(boom, engine(system))(PNG, PAGE)).toBe(system)
    expect(chainOcrEngines(boom, boom)(PNG, PAGE)).toBeNull()
    expect(chainOcrEngines(boom, null)(PNG, PAGE)).toBeNull()
  })

  it('returns null when neither engine produces anything', () => {
    expect(chainOcrEngines(engine(null), engine(null))(PNG, PAGE)).toBeNull()
  })
})

describe('chainOcrEnginesAsync (the viewer bridge: same gate, same decisions)', () => {
  const engine = (result: OcrRecognition | null): AsyncOcrEngine =>
    // resolve on a later tick: the chain really awaits its engines
    vi.fn<AsyncOcrEngine>(
      () => new Promise<OcrRecognition | null>((resolve) => setTimeout(() => resolve(result), 5)),
    )
  const reject: AsyncOcrEngine = () => Promise.reject(new Error('spawn failed'))
  const good = rec(line(VI_TEXT, 0.95))
  const system = rec(line('system result', 1))

  it('lets a good primary result through, with and without a fallback', async () => {
    const fallback = engine(system)
    expect(await chainOcrEnginesAsync(engine(good), fallback)(PNG, PAGE)).toBe(good)
    expect(fallback).not.toHaveBeenCalled()
    expect(await chainOcrEnginesAsync(engine(good), null)(PNG, PAGE)).toBe(good)
  })

  it('passes the page render and size to both engines', async () => {
    const primary = engine(null)
    const fallback = engine(system)
    expect(await chainOcrEnginesAsync(primary, fallback)(PNG, PAGE)).toBe(system)
    expect(primary).toHaveBeenCalledWith(PNG, PAGE)
    expect(fallback).toHaveBeenCalledWith(PNG, PAGE)
  })

  it.each([
    ['null', null],
    ['low confidence', rec(line(VI_TEXT, 0.2))],
    ['a mixed junk + Latin page', MIXED],
    ['long ASCII-only text', rec(line(ascii(300), 0.9))],
  ])('hands %s to the fallback', async (_name, primaryResult) => {
    expect(await chainOcrEnginesAsync(engine(primaryResult), engine(system))(PNG, PAGE)).toBe(
      system,
    )
  })

  it('returns null for an unread page when the fallback has nothing, rejects, or is absent', async () => {
    for (const primaryResult of [null, rec(line(VI_TEXT, 0.2)), MIXED]) {
      for (const fallback of [engine(null), engine(rec()), reject, null]) {
        expect(await chainOcrEnginesAsync(engine(primaryResult), fallback)(PNG, PAGE)).toBeNull()
      }
    }
  })

  it('keeps Tesseract text for English (ascii-only) when the fallback has nothing', async () => {
    const english = rec(line(ascii(300), 0.9))
    for (const fallback of [engine(null), engine(rec()), reject, null]) {
      expect(await chainOcrEnginesAsync(engine(english), fallback)(PNG, PAGE)).toBe(english)
    }
  })

  it('treats a rejecting engine as a null result', async () => {
    expect(await chainOcrEnginesAsync(reject, engine(system))(PNG, PAGE)).toBe(system)
    expect(await chainOcrEnginesAsync(reject, reject)(PNG, PAGE)).toBeNull()
  })
})
