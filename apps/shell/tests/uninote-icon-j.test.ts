/**
 * @vitest-environment jsdom
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { FileBadge } from '../src/renderer/src/FileBadge'
import { UniNoteIcon } from '../src/renderer/src/UniNoteIcon'

/**
 * UNI-2050 (card UNINOTE-ICON-J, desktop half): the UniNote / page kind icon is
 * the web's option J on every desktop surface, drawn by ONE shared component.
 * The reference numbers below are copied from the web's
 * packages/views/documents/uninote-icon.tsx and @uniwork/ui/brand/mark.generated
 * (MARK_COMPACT), web root commit 8be093cdb.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const RENDERER = join(__dirname, '../src/renderer/src')

const WEB = {
  viewBox: '0 0 240 240',
  tile: { width: '240', height: '240', rx: '48' },
  ramp: [
    ['0', '#0044E3'],
    ['.52', '#00B4FC'],
    ['1', '#02DEF5'],
  ],
  tileGradient: { x1: '0', y1: '240', x2: '240', y2: '0', gradientUnits: 'userSpaceOnUse' },
  markGradient: { x1: '0', y1: '0', x2: '128', y2: '0', gradientUnits: 'userSpaceOnUse' },
  page: 'M72 36H144L184 76V188a16 16 0 0 1-16 16H72a16 16 0 0 1-16-16V52a16 16 0 0 1 16-16Z',
  fold: 'M144 36V64a12 12 0 0 0 12 12H184Z',
  foldFill: '#A8E4FF',
  markTransform: `translate(76 82) scale(${88 / 128})`,
  heads: [
    { cx: '15', cy: '14', r: '14' },
    { cx: '113', cy: '14', r: '14' },
  ],
  bodies: [
    { x: '0', y: '32.6', width: '30', height: '45.4', rx: '15' },
    { x: '98', y: '32.6', width: '30', height: '45.4', rx: '15' },
  ],
  ribbon:
    'M0 53.552C5.704 56.61 10.55 60.734 15.864 64.353C17.998 65.8 21.289 67.983 23.988 68C26.662 68 29.956 65.83 32.069 64.399C33.694 63.298 35.273 62.127 36.853 60.961C45.141 54.842 53.231 49.244 64 49.2C74.769 49.244 82.859 54.842 91.147 60.961C92.727 62.127 94.306 63.298 95.931 64.399C98.044 65.83 101.338 68 104.012 68C106.711 67.983 110.002 65.8 112.136 64.353C117.45 60.734 122.296 56.61 128 53.552L128 82.541C124.694 84.916 121.302 87.128 117.601 88.844C113.271 90.825 108.847 91.969 104.068 92C93.289 91.981 85.188 86.393 76.893 80.269C75.311 79.101 73.73 77.928 72.103 76.824C69.978 75.382 66.689 73.211 64 73.2C61.311 73.211 58.022 75.382 55.897 76.824C54.27 77.928 52.689 79.101 51.107 80.269C42.812 86.393 34.711 91.981 23.932 92C19.153 91.969 14.729 90.825 10.399 88.844C6.698 87.128 3.306 84.916 0 82.541Z',
  lines: [
    { x: '76', y: '160', width: '88', height: '12', rx: '6', fill: '#4FA8FF', opacity: '0.7' },
    { x: '76', y: '180', width: '58', height: '12', rx: '6', fill: '#2E7CF0', opacity: '0.75' },
  ],
}

let host: HTMLElement | null = null
let root: Root | null = null

async function render(node: ReturnType<typeof createElement>): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(node)
  })
  return host
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  host = null
  root = null
})

const attrs = (el: Element, names: string[]) =>
  Object.fromEntries(names.map((n) => [n, el.getAttribute(n)]))

/** the geometry of one icon, in a shape that compares to WEB */
function geometry(svg: SVGElement) {
  const [tile, mark] = Array.from(svg.querySelectorAll('linearGradient'))
  const rects = Array.from(svg.querySelectorAll(':scope > rect'))
  const paths = Array.from(svg.querySelectorAll(':scope > path'))
  const g = svg.querySelector(':scope > g')!
  return {
    viewBox: svg.getAttribute('viewBox'),
    tileGradient: attrs(tile, ['x1', 'y1', 'x2', 'y2', 'gradientUnits']),
    markGradient: attrs(mark, ['x1', 'y1', 'x2', 'y2', 'gradientUnits']),
    ramp: [tile, mark].map((gr) =>
      Array.from(gr.querySelectorAll('stop')).map((s) => [
        s.getAttribute('offset'),
        s.getAttribute('stop-color'),
      ]),
    ),
    tile: attrs(rects[0], ['width', 'height', 'rx']),
    tileFill: rects[0].getAttribute('fill'),
    page: paths[0].getAttribute('d'),
    pageFill: paths[0].getAttribute('fill'),
    fold: paths[1].getAttribute('d'),
    foldFill: paths[1].getAttribute('fill'),
    markTransform: g.getAttribute('transform'),
    markFill: g.getAttribute('fill'),
    heads: Array.from(g.querySelectorAll('circle')).map((c) => attrs(c, ['cx', 'cy', 'r'])),
    bodies: Array.from(g.querySelectorAll('rect')).map((r) =>
      attrs(r, ['x', 'y', 'width', 'height', 'rx']),
    ),
    ribbon: g.querySelector('path')!.getAttribute('d'),
    lines: rects
      .slice(1)
      .map((r) => attrs(r, ['x', 'y', 'width', 'height', 'rx', 'fill', 'opacity'])),
    ids: Array.from(svg.querySelectorAll('linearGradient')).map((n) => n.id),
  }
}

describe('UniNote icon = web option J (UNI-2050, web 8be093cdb)', () => {
  it('draws the web J geometry: grid, tile, ramp, page, fold, compact mark, two lines', async () => {
    const h = await render(createElement(UniNoteIcon, { className: 'x' }))
    const svg = h.querySelector('svg')!
    expect(svg.getAttribute('class')).toBe('x')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const got = geometry(svg)
    expect(got.viewBox).toBe(WEB.viewBox)
    expect(got.tile).toEqual(WEB.tile)
    expect(got.tileGradient).toEqual(WEB.tileGradient)
    expect(got.markGradient).toEqual(WEB.markGradient)
    expect(got.ramp).toEqual([WEB.ramp, WEB.ramp])
    expect(got.page).toBe(WEB.page)
    expect(got.pageFill).toBe('#fff')
    expect(got.fold).toBe(WEB.fold)
    expect(got.foldFill).toBe(WEB.foldFill)
    expect(got.markTransform).toBe(WEB.markTransform)
    expect(got.heads).toEqual(WEB.heads)
    expect(got.bodies).toEqual(WEB.bodies)
    expect(got.ribbon).toBe(WEB.ribbon)
    expect(got.lines).toEqual(WEB.lines)
  })

  it('fills the tile and the mark from its own gradients', async () => {
    const h = await render(createElement(UniNoteIcon, {}))
    const g = geometry(h.querySelector('svg')!)
    expect(g.tileFill).toBe(`url(#${g.ids[0]})`)
    expect(g.markFill).toBe(`url(#${g.ids[1]})`)
  })

  it('gives every instance its own gradient ids', async () => {
    const h = await render(
      createElement('div', null, createElement(UniNoteIcon, {}), createElement(UniNoteIcon, {})),
    )
    const [a, b] = Array.from(h.querySelectorAll('svg')).map(geometry)
    expect(new Set([...a.ids, ...b.ids]).size).toBe(4)
  })

  it('is what FileBadge draws for a page, at every size, and nothing theme-tinted', async () => {
    for (const size of [16, 20, 28, 36]) {
      const h = await render(createElement(FileBadge, { ext: 'page', size }))
      const svg = h.querySelector('svg')!
      expect(svg.getAttribute('width')).toBe(String(size))
      expect(svg.getAttribute('height')).toBe(String(size))
      const { ids: _ids, tileFill: _t, markFill: _m, ...rest } = geometry(svg)
      const ref = await render(createElement(UniNoteIcon, {}))
      const {
        ids: _i2,
        tileFill: _t2,
        markFill: _m2,
        ...want
      } = geometry(ref.querySelector('svg')!)
      expect(rest).toEqual(want)
      expect(h.innerHTML).not.toContain('var(--')
      if (root) act(() => root!.unmount())
      root = null
      host?.remove()
    }
  })

  it('draws no page icon of its own anywhere else in the renderer', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(tsx?|svg|css)$/.test(name)) files.push(p)
      }
    }
    walk(RENDERER)
    const owners = files.filter((f) =>
      /M22 14 V56|UniNoteBadge|M68 2 H88/.test(readFileSync(f, 'utf8')),
    )
    expect(owners).toEqual([])
  })

  it('every page call site goes through FileBadge, which uses the shared component', () => {
    const fileBadge = readFileSync(join(RENDERER, 'FileBadge.tsx'), 'utf8')
    expect(fileBadge).toMatch(/from '\.\/UniNoteIcon'/)
    for (const rel of [
      'uniwork-home/NewMenu.tsx',
      'uniwork-home/DocumentsHome.tsx',
      'uniwork-home/ShelvedDocumentsView.tsx',
      'uniwork-folders/BrowserContents.tsx',
    ]) {
      expect(readFileSync(join(RENDERER, rel), 'utf8'), rel).toMatch(/<FileBadge/)
    }
  })
})
