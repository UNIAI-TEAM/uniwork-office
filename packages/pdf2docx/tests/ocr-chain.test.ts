/** Hand-over gate between the bundled Tesseract engine and the system engine
 * (src/ocr-chain.ts): every branch of the gate, with fake engines. */
import { describe, expect, it, vi } from 'vitest'
import type { OcrEngine, OcrLine, OcrRecognition } from '../src/ocr'
import { chainOcrEngines, OCR_CHAIN_ASCII_MIN_LETTERS, ocrFallbackReason } from '../src/ocr-chain'

const PAGE = { widthPt: 612, heightPt: 792 }
const PNG = new Uint8Array([1, 2, 3])
const box = { x0: 0.1, y0: 0.8, x1: 0.9, y1: 0.83 }

const line = (text: string, confidence = 0.9): OcrLine => ({ text, confidence, box })
const rec = (...lines: OcrLine[]): OcrRecognition => ({ lines, paperShare: 0.95 })

const VI_TEXT = 'Hôm nay, ngày 15 tháng 9 năm 2026, tại văn phòng công ty ở Hà Nội,'
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
    const junk = '#=@}£®>~'
    const text = (VI_TEXT.replace(/\s/g, '') + VI_TEXT.replace(/\s/g, '')).slice(0, 92) + junk
    expect([...text].length).toBe(100)
    expect(ocrFallbackReason(rec(line(text, 0.9)))).toBe('foreign-script')
    // 4 of 100 stays (a ruled table's stray `|` is 0.8% in the bench)
    const mild = (VI_TEXT.replace(/\s/g, '') + VI_TEXT.replace(/\s/g, '')).slice(0, 96) + '#=@~'
    expect(ocrFallbackReason(rec(line(mild, 0.9)))).toBeNull()
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

describe('chainOcrEngines', () => {
  const engine = (result: OcrRecognition | null): OcrEngine => vi.fn(() => result)
  const good = rec(line(VI_TEXT, 0.95))
  const system = rec(line('system result', 1))

  it('returns the primary engine itself when there is no fallback (Linux)', () => {
    const primary = engine(good)
    expect(chainOcrEngines(primary, null)).toBe(primary)
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
    ['a primary result of foreign symbols', rec(line('#=@}£®>~'.repeat(5), 0.9))],
    ['long ASCII-only primary text', rec(line(ascii(300), 0.9))],
  ])('hands %s to the fallback', (_name, primaryResult) => {
    const fallback = engine(system)
    expect(chainOcrEngines(engine(primaryResult), fallback)(PNG, PAGE)).toBe(system)
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('keeps the primary result when the fallback returns null', () => {
    const weak = rec(line(VI_TEXT, 0.2))
    expect(chainOcrEngines(engine(weak), engine(null))(PNG, PAGE)).toBe(weak)
  })

  it('keeps the primary result when the fallback finds no text', () => {
    const english = rec(line(ascii(300), 0.9))
    expect(chainOcrEngines(engine(english), engine(rec()))(PNG, PAGE)).toBe(english)
    expect(chainOcrEngines(engine(english), engine(rec(line(' '))))(PNG, PAGE)).toBe(english)
  })

  it('treats a throwing engine as a null result', () => {
    const boom: OcrEngine = () => {
      throw new Error('spawn failed')
    }
    expect(chainOcrEngines(boom, engine(system))(PNG, PAGE)).toBe(system)
    const weak = rec(line(VI_TEXT, 0.2))
    expect(chainOcrEngines(engine(weak), boom)(PNG, PAGE)).toBe(weak)
    expect(chainOcrEngines(boom, boom)(PNG, PAGE)).toBeNull()
  })

  it('returns null when neither engine produces anything', () => {
    expect(chainOcrEngines(engine(null), engine(null))(PNG, PAGE)).toBeNull()
  })
})
