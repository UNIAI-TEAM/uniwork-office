/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { anchorLabel } from '../src/collab/anchor-label'
import { AnchorLabel } from '../src/collab/AnchorLabel'
import { collabPanelStrings } from '../src/strings-collab-panel'

const STRINGS = {
  collabAnchorDocx: 'Đoạn “{quote}”',
  collabAnchorCell: 'Ô {cell}',
  collabAnchorSlide: 'Slide {slide}',
  collabAnchorPage: 'Trang {page}',
  collabAnchorStale: 'Vị trí có thể đã thay đổi',
  collabAnchorLost: 'Đoạn được bình luận không còn trong bản hiện tại',
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('anchorLabel', () => {
  it('docx: quote under the cut is used whole, no title', () => {
    const a = {
      format: 'docx',
      v: 1,
      path: [0],
      start: 0,
      end: 5,
      quote: 'doanh thu quý 3',
      prefix: '',
      suffix: '',
    }
    expect(anchorLabel(a, { lang: 'vi' })).toEqual({
      key: 'collabAnchorDocx',
      params: { quote: 'doanh thu quý 3' },
    })
  })

  it('docx: a long quote is cut at 60 characters with an ellipsis; the full quote (<= 500) goes in the title', () => {
    const quote = 'a'.repeat(499) + 'b'
    const label = anchorLabel({ format: 'docx', v: 1, quote }, { lang: 'en' })
    expect(label?.key).toBe('collabAnchorDocx')
    expect(label?.params.quote).toBe('a'.repeat(60) + '…')
    expect(label?.title).toBe(quote)
  })

  it('docx: exactly 60 characters is not cut', () => {
    const quote = 'x'.repeat(60)
    expect(anchorLabel({ format: 'docx', v: 1, quote }, { lang: 'en' })).toEqual({
      key: 'collabAnchorDocx',
      params: { quote },
    })
  })

  it('docx: counts code points, never splits a surrogate pair, and collapses whitespace', () => {
    const quote = '😀'.repeat(70)
    expect(anchorLabel({ format: 'docx', v: 1, quote }, { lang: 'en' })?.params.quote).toBe(
      '😀'.repeat(60) + '…',
    )
    expect(
      anchorLabel({ format: 'docx', v: 1, quote: 'a\n  b\tc' }, { lang: 'en' })?.params.quote,
    ).toBe('a b c')
  })

  it('docx: a title never exceeds 500 characters even when the server sent more', () => {
    const label = anchorLabel({ format: 'docx', v: 1, quote: 'q'.repeat(900) }, { lang: 'en' })
    expect(Array.from(label?.title ?? '')).toHaveLength(500)
  })

  it('docx: no quote -> no label', () => {
    expect(anchorLabel({ format: 'docx', v: 1, quote: '' }, { lang: 'en' })).toBeNull()
    expect(anchorLabel({ format: 'docx', v: 1 }, { lang: 'en' })).toBeNull()
  })

  it('xlsx: the active sheet gets the bare range', () => {
    const a = { format: 'xlsx', v: 1, sheet: 'Sheet1', range: 'B7:D9' }
    expect(anchorLabel(a, { lang: 'en', activeSheet: 'Sheet1' })).toEqual({
      key: 'collabAnchorCell',
      params: { cell: 'B7:D9' },
    })
  })

  it("xlsx: another sheet gets Excel syntax 'Sheet'!B7, quotes doubled", () => {
    expect(
      anchorLabel(
        { format: 'xlsx', v: 1, sheet: 'Other sheet', range: 'B7' },
        { lang: 'en', activeSheet: 'S1' },
      )?.params.cell,
    ).toBe("'Other sheet'!B7")
    expect(
      anchorLabel(
        { format: 'xlsx', v: 1, sheet: "Bob's", range: 'A1' },
        { lang: 'en', activeSheet: 'S1' },
      )?.params.cell,
    ).toBe("'Bob''s'!A1")
  })

  it('xlsx: without an active sheet (no editor) the sheet is always named', () => {
    expect(
      anchorLabel({ format: 'xlsx', v: 1, sheet: 'S1', range: 'B7' }, { lang: 'en' })?.params.cell,
    ).toBe("'S1'!B7")
  })

  it('xlsx: a stable sheet id is shown through the name resolver', () => {
    const a = { format: 'xlsx', v: 1, sheet: 'sh-9', range: 'C3' }
    const resolveSheetName = (id: string) => (id === 'sh-9' ? 'Plan' : undefined)
    expect(anchorLabel(a, { lang: 'en', activeSheet: 'Plan', resolveSheetName })?.params.cell).toBe(
      'C3',
    )
    expect(
      anchorLabel(a, { lang: 'en', activeSheet: 'Other', resolveSheetName })?.params.cell,
    ).toBe("'Plan'!C3")
  })

  it('xlsx: no range -> no label', () => {
    expect(anchorLabel({ format: 'xlsx', v: 1, sheet: 'S1' }, { lang: 'en' })).toBeNull()
  })

  it('pptx: slide_index + 1, number through the locale', () => {
    expect(
      anchorLabel({ format: 'pptx', v: 1, slide_id: '257', slide_index: 4 }, { lang: 'en' }),
    ).toEqual({
      key: 'collabAnchorSlide',
      params: { slide: '5' },
    })
    expect(
      anchorLabel({ format: 'pptx', v: 1, slide_id: '1', slide_index: 1233 }, { lang: 'en' })
        ?.params.slide,
    ).toBe('1,234')
    expect(
      anchorLabel({ format: 'pptx', v: 1, slide_id: '1', slide_index: 1233 }, { lang: 'de' })
        ?.params.slide,
    ).toBe('1.234')
    expect(
      anchorLabel({ format: 'pptx', v: 1, slide_id: '1', slide_index: 1233 }, { lang: 'ar' })
        ?.params.slide,
    ).toBe(new Intl.NumberFormat('ar').format(1234))
  })

  it('pdf: the page through the locale', () => {
    expect(
      anchorLabel({ format: 'pdf', v: 1, page: 2, rect: [0, 0, 1, 1] }, { lang: 'vi' }),
    ).toEqual({
      key: 'collabAnchorPage',
      params: { page: '2' },
    })
    expect(anchorLabel({ format: 'pdf', v: 1, page: 12345 }, { lang: 'vi' })?.params.page).toBe(
      new Intl.NumberFormat('vi').format(12345),
    )
  })

  it('numbers that are not whole positive counts give no label', () => {
    expect(anchorLabel({ format: 'pptx', v: 1, slide_index: -1 }, { lang: 'en' })).toBeNull()
    expect(anchorLabel({ format: 'pptx', v: 1, slide_index: 'x' }, { lang: 'en' })).toBeNull()
    expect(anchorLabel({ format: 'pdf', v: 1, page: 0 }, { lang: 'en' })).toBeNull()
    expect(anchorLabel({ format: 'pdf', v: 1 }, { lang: 'en' })).toBeNull()
  })

  it('an unknown format gives no label', () => {
    expect(anchorLabel({ format: 'html', v: 1 }, { lang: 'en' })).toBeNull()
  })
})

function render(props: Record<string, unknown>): HTMLElement {
  act(() =>
    root.render(createElement(AnchorLabel, { lang: 'vi', strings: STRINGS, ...props } as never)),
  )
  return host
}

describe('AnchorLabel', () => {
  const docx = { format: 'docx', v: 1, quote: 'doanh thu quý 3' }

  it('renders the format label with its placeholder filled, no state text when exact', () => {
    const el = render({ anchor: docx, state: 'exact' })
    expect(el.textContent).toBe('Đoạn “doanh thu quý 3”')
    expect(el.querySelector('.collab-anchor-state')).toBeNull()
  })

  it('renders one label per format', () => {
    expect(
      render({ anchor: { format: 'xlsx', v: 1, sheet: 'S1', range: 'B7' }, activeSheet: 'S1' })
        .textContent,
    ).toBe('Ô B7')
    expect(render({ anchor: { format: 'pptx', v: 1, slide_index: 2 } }).textContent).toBe('Slide 3')
    expect(render({ anchor: { format: 'pdf', v: 1, page: 9 } }).textContent).toBe('Trang 9')
  })

  it('a cut quote keeps the full text in title and is keyboard-reachable', () => {
    const quote = 'w'.repeat(200)
    const label = render({ anchor: { format: 'docx', v: 1, quote } }).querySelector(
      '.collab-anchor-label',
    ) as HTMLElement
    expect(label.getAttribute('title')).toBe(quote)
    expect(label.getAttribute('tabindex')).toBe('0')
    expect(label.textContent).toBe('Đoạn “' + 'w'.repeat(60) + '…”')
  })

  it('a whole quote carries no title and no tab stop', () => {
    const label = render({ anchor: docx }).querySelector('.collab-anchor-label') as HTMLElement
    expect(label.hasAttribute('title')).toBe(false)
    expect(label.hasAttribute('tabindex')).toBe(false)
  })

  it('stale: label + state as TEXT', () => {
    const el = render({ anchor: docx, state: 'stale' })
    const state = el.querySelector('.collab-anchor-state') as HTMLElement
    expect(state.textContent).toBe('Vị trí có thể đã thay đổi')
    expect(state.classList.contains('collab-anchor-state-stale')).toBe(true)
    expect(el.textContent).toContain('Đoạn “doanh thu quý 3”')
  })

  it('lost: label + its own state text', () => {
    const state = render({ anchor: docx, state: 'lost' }).querySelector(
      '.collab-anchor-state',
    ) as HTMLElement
    expect(state.textContent).toBe('Đoạn được bình luận không còn trong bản hiện tại')
    expect(state.classList.contains('collab-anchor-state-lost')).toBe(true)
  })

  it('lost renders the shipped copy of vi and en with the same class and words', () => {
    for (const [lang, text] of [
      ['vi', 'Đoạn được bình luận không còn trong bản hiện tại'],
      ['en', 'The commented passage is not in the current version'],
    ] as const) {
      const strings = { ...STRINGS, ...collabPanelStrings[lang] }
      const state = render({ anchor: docx, state: 'lost', strings }).querySelector(
        '.collab-anchor-state-lost',
      ) as HTMLElement
      expect(state.textContent).toBe(text)
    }
  })

  it('lost with a position that cannot be labelled still shows the state text', () => {
    const el = render({ anchor: { format: 'docx', v: 1, quote: '' }, state: 'lost' })
    expect(el.querySelector('.collab-anchor-label')).toBeNull()
    expect(el.textContent).toBe('Đoạn được bình luận không còn trong bản hiện tại')
  })

  it('exposes ids so the thread can name itself from them', () => {
    const el = render({ anchor: docx, state: 'stale', labelId: 'lbl-1', stateId: 'st-1' })
    expect(el.querySelector('#lbl-1')?.textContent).toBe('Đoạn “doanh thu quý 3”')
    expect(el.querySelector('#st-1')?.textContent).toBe('Vị trí có thể đã thay đổi')
  })

  it('renders nothing without an anchor (discussion kind) and never invents state text', () => {
    expect(render({ anchor: null, state: 'lost' }).innerHTML).toBe('')
    expect(render({ anchor: undefined }).innerHTML).toBe('')
  })

  it('an unknown anchor_state string shows no state text', () => {
    expect(
      render({ anchor: docx, state: 'weird' }).querySelector('.collab-anchor-state'),
    ).toBeNull()
  })
})
