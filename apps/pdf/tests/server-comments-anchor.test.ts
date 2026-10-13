/**
 * G8-15 (UNI-1410): the PDF server-comment anchor and its re-send after Save.
 * Card test line "delete a page -> lost": a Save that dropped the anchored page
 * sends `comments.anchors` with the saved version and `state: 'lost'` (old anchor
 * kept); a reorder moves the page number; nothing is sent before the receipt.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  ANCHORS_PER_REQUEST,
  PDF_POINT_ANCHOR_SIZE,
  makePdfAnchor,
  parsePdfAnchor,
  pdfAnchorOrder,
  pointAnchorRect,
  remapAnchorsAfterSave,
} from '../src/renderer/server-comments/pdf-anchor'
import { composePageMaps, createAnchorResend } from '../src/renderer/server-comments/anchor-resend'
import {
  createPdfAnchorAdapter,
  locatePdfAnchor,
} from '../src/renderer/server-comments/pdf-adapter'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('pdf anchor shape (addendum §4.3)', () => {
  it('is {format, v, page, rect} with a normalised rect in PDF points', () => {
    expect(makePdfAnchor(2, [300, 560, 72, 540])).toEqual({
      format: 'pdf',
      v: 1,
      page: 2,
      rect: [72, 540, 300, 560],
    })
  })

  it('a point placement anchors a small square below-right of the point (PDF y grows upwards)', () => {
    expect(pointAnchorRect([100, 700])).toEqual([
      100,
      700 - PDF_POINT_ANCHOR_SIZE,
      100 + PDF_POINT_ANCHOR_SIZE,
      700,
    ])
  })

  it('rejects another format and a bad page / rect', () => {
    expect(parsePdfAnchor({ format: 'pptx', v: 1, slide_id: '1' })).toBeNull()
    expect(parsePdfAnchor({ format: 'pdf', v: 1, page: 0, rect: [0, 0, 1, 1] })).toBeNull()
    expect(parsePdfAnchor({ format: 'pdf', v: 1, page: 1, rect: [0, 0, 1] })).toBeNull()
    expect(parsePdfAnchor({ format: 'pdf', v: 1, page: 1, rect: [0, 0, 1, Infinity] })).toBeNull()
  })

  it('sorts by page, then top-down', () => {
    const a = makePdfAnchor(1, [0, 0, 10, 10])
    const b = makePdfAnchor(2, [0, 0, 10, 10])
    expect(pdfAnchorOrder(a, 700)).toBeLessThan(pdfAnchorOrder(b, 10))
    expect(pdfAnchorOrder(a, 10)).toBeLessThan(pdfAnchorOrder(a, 700))
  })
})

const root = (id: string, page: number, state: string | null = 'exact') => ({
  id,
  anchor: makePdfAnchor(page, [72, 540, 300, 560]),
  anchor_state: state,
})

describe('remap after Save', () => {
  it('a deleted page turns the thread lost and keeps the old anchor', () => {
    // three pages; page 2 (index 1) deleted: 0 -> 0, 2 -> 1
    const pageMap = new Map([
      [0, 0],
      [2, 1],
    ])
    expect(remapAnchorsAfterSave([root('a', 1), root('b', 2), root('c', 3)], pageMap)).toEqual([
      { commentId: 'a', anchor: makePdfAnchor(1, [72, 540, 300, 560]), state: 'exact' },
      { commentId: 'b', anchor: makePdfAnchor(2, [72, 540, 300, 560]), state: 'lost' },
      { commentId: 'c', anchor: makePdfAnchor(2, [72, 540, 300, 560]), state: 'exact' },
    ])
  })

  it('skips threads already lost and roots without a pdf anchor', () => {
    const items = remapAnchorsAfterSave(
      [root('a', 1, 'lost'), { id: 'b', anchor: null, anchor_state: null }],
      new Map([[0, 0]]),
    )
    expect(items).toEqual([])
  })

  it('composes the page maps of two saves before one receipt', () => {
    const first = new Map([
      [0, 1],
      [1, 0],
      [2, 2],
    ]) // swap pages 1 and 2
    const second = new Map([
      [0, 0],
      [2, 1],
    ]) // then delete the page now at index 1
    expect([...composePageMaps(first, second)]).toEqual([
      [1, 0],
      [2, 1],
    ])
  })
})

describe('anchor re-send after the save receipt (contract §2.6)', () => {
  it('delete a page -> comments.anchors with the new version and state lost', async () => {
    const send = vi.fn(async () => ({ updated: ['b'] }))
    const onUpdated = vi.fn()
    const resend = createAnchorResend({
      roots: () => [root('a', 1), root('b', 2)],
      send,
      onUpdated,
    })
    resend.saved(new Map([[0, 0]]))
    await flush()
    // nothing before UniWork reports the version
    expect(send).not.toHaveBeenCalled()
    resend.receipt('ver-2')
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('ver-2', [
      { commentId: 'a', anchor: makePdfAnchor(1, [72, 540, 300, 560]), state: 'exact' },
      { commentId: 'b', anchor: makePdfAnchor(2, [72, 540, 300, 560]), state: 'lost' },
    ])
    expect(onUpdated).toHaveBeenCalledTimes(1)
  })

  it('a receipt before the renderer save lands waits for the save', async () => {
    const send = vi.fn(async () => ({ updated: [] as string[] }))
    const onUpdated = vi.fn()
    const resend = createAnchorResend({ roots: () => [root('a', 1)], send, onUpdated })
    resend.receipt('ver-3')
    await flush()
    expect(send).not.toHaveBeenCalled()
    resend.saved(new Map([[0, 0]]))
    await flush()
    expect(send).toHaveBeenCalledWith('ver-3', [
      { commentId: 'a', anchor: makePdfAnchor(1, [72, 540, 300, 560]), state: 'exact' },
    ])
    // nothing changed on the server: no reload
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('splits more than 500 anchors into several requests', async () => {
    const roots = Array.from({ length: ANCHORS_PER_REQUEST + 1 }, (_, i) => root(`c${i}`, 1))
    const send = vi.fn(async () => ({ updated: [] as string[] }))
    const resend = createAnchorResend({ roots: () => roots, send, onUpdated: () => {} })
    resend.saved(new Map([[0, 0]]))
    resend.receipt('ver-4')
    await flush()
    expect(
      send.mock.calls.map((c) => (c as unknown[])[1] as unknown[]).map((x) => x.length),
    ).toEqual([ANCHORS_PER_REQUEST, 1])
  })

  it('a failed send reports the error and sends nothing more after dispose', async () => {
    const onError = vi.fn()
    const send = vi.fn(async () => {
      throw { code: 'malformed', details: { code: 'anchor_version_invalid' } }
    })
    const resend = createAnchorResend({
      roots: () => [root('a', 1)],
      send,
      onUpdated: () => {},
      onError,
    })
    resend.saved(new Map([[0, 0]]))
    resend.receipt('ver-x')
    await flush()
    expect(onError).toHaveBeenCalledTimes(1)
    resend.dispose()
    resend.saved(new Map([[0, 0]]))
    resend.receipt('ver-y')
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('anchor adapter', () => {
  const goTo = vi.fn()
  const deps = {
    pageCount: 3,
    isShown: (i: number) => i !== 1,
    viewTop: (_i: number, rect: readonly number[]) => 842 - rect[3]!,
    goTo,
  }

  it('locates page N as page index N-1 of the open file, not a deleted or missing page', () => {
    expect(locatePdfAnchor(makePdfAnchor(3, [1, 2, 3, 4]), deps)).toEqual({
      origIdx: 2,
      rect: [1, 2, 3, 4],
    })
    expect(locatePdfAnchor(makePdfAnchor(2, [1, 2, 3, 4]), deps)).toBeNull()
    expect(locatePdfAnchor(makePdfAnchor(9, [1, 2, 3, 4]), deps)).toBeNull()
  })

  it('goTo hands the page and the rect to the viewer', () => {
    const adapter = createPdfAnchorAdapter(deps)
    adapter.goTo(makePdfAnchor(3, [72, 540, 300, 560]))
    expect(goTo).toHaveBeenCalledWith(2, [72, 540, 300, 560])
    expect(adapter.locate(makePdfAnchor(2, [0, 0, 1, 1]))).toBe(false)
  })
})
