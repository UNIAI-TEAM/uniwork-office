// GO-B5 S4 (UNI-1015): text-metric fidelity of the Slides web frame against the desktop.
//
// The desktop lays text out with OpentypeMetrics over real font files (main/fonts.ts); the frame
// with canvas measureText (web/modules/slides/fonts.ts). Both sides build RenderSlides for the
// fixture decks; the reference side here is the engine in Node with OpentypeMetrics over the
// bundled Carlito faces (what the desktop uses for Calibri) and the heuristic for faces the
// reference has no file for. Per text node we compare line count, run start x and run width,
// and write the drift table to docs/web-modules/slides-fidelity.md. The test fails only on
// a gross regression (line breaks diverging on the Calibri deck); the numbers are the report.
// Run: npm run build:web -- --module slides && npx playwright test -c web/e2e slides-fidelity
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as opentype from 'opentype.js'
import { openPptx } from '../../packages/pptx-engine/src/index'
import {
  buildRenderSlide,
  OpentypeMetrics,
  type OpentypeFontLike,
  type RenderSlide,
  type RunStyle,
} from '../../packages/pptx-render/src/index'

const repoRoot = resolve(__dirname, '../..')
const FIT = 1280
const DECKS = ['sample.pptx', 'unicode.pptx']

const built = (): boolean => {
  const root = resolve(repoRoot, 'dist-web/slides')
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

function carlito(): (style: RunStyle) => OpentypeFontLike | undefined {
  const dir = resolve(repoRoot, 'packages/ui/src/fonts')
  const load = (name: string) => {
    const b = readFileSync(resolve(dir, `${name}.ttf`))
    return opentype.parse(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    ) as unknown as OpentypeFontLike
  }
  const faces = {
    '00': load('Carlito-Regular'),
    '10': load('Carlito-Bold'),
    '01': load('Carlito-Italic'),
    '11': load('Carlito-BoldItalic'),
  }
  return (style) =>
    /^(calibri|calibri light|carlito)$/i.test(style.fontFamily.trim())
      ? faces[`${style.bold ? 1 : 0}${style.italic ? 1 : 0}` as keyof typeof faces]
      : undefined
}

async function desktopSlides(deck: string): Promise<RenderSlide[]> {
  const opened = await openPptx(
    new Uint8Array(readFileSync(resolve(repoRoot, 'web/fixtures', deck))),
  )
  const metrics = new OpentypeMetrics(carlito())
  return opened.deck.slides.map((s, i) =>
    buildRenderSlide(s, opened.deck.size, { fitWidthPx: FIT, metrics, slideNo: i + 1 }),
  )
}

async function frameSlides(page: Page, deck: string): Promise<RenderSlide[]> {
  await page.goto(`/test-host/?module=slides&lang=en&open=/fixtures/${deck}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame: Frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await expect(frame.locator('.thumb').first()).toBeVisible({ timeout: 30_000 })
  // the session laid the deck out at the renderer's fit width; re-lay at FIT for a like-for-like table
  return frame.evaluate(async (fit) => {
    const api = window.slidesApi
    await document.fonts.ready
    const r = await api.consumePendingOpen(fit)
    return (r?.slides ?? (await api.getRenderSlides()) ?? []) as unknown as RenderSlide[]
  }, FIT)
}

interface Run {
  text: string
  x: number
  widthPx: number
  fontFamily: string
}
interface TextNode {
  sourceId: string
  text?: { lines: Array<{ runs: Run[] }> }
}

interface Drift {
  nodes: number
  lineMismatch: number
  runs: number
  maxDx: number
  meanWidthPct: number
  maxWidthPct: number
}

function compare(desk: RenderSlide[], web: RenderSlide[]): Drift {
  const d: Drift = { nodes: 0, lineMismatch: 0, runs: 0, maxDx: 0, meanWidthPct: 0, maxWidthPct: 0 }
  let pctSum = 0
  desk.forEach((ds, si) => {
    const ws = web[si]
    if (!ws) return
    // element ids come from a per-process counter, so nodes pair by their order on the slide
    const webText = (ws.nodes as unknown as TextNode[]).filter((n) => n.text)
    const deskText = (ds.nodes as unknown as TextNode[]).filter((n) => n.text)
    deskText.forEach((n, ni) => {
      const w = webText[ni]
      if (!n.text || !w?.text) return
      d.nodes++
      if (n.text.lines.length !== w.text.lines.length) {
        d.lineMismatch++
        return
      }
      n.text.lines.forEach((line, li) => {
        line.runs.forEach((run, ri) => {
          const wr = w.text!.lines[li]!.runs[ri]
          if (!wr || !run.text.trim()) return
          d.runs++
          d.maxDx = Math.max(d.maxDx, Math.abs(run.x - wr.x))
          const pct = run.widthPx > 0 ? (Math.abs(run.widthPx - wr.widthPx) / run.widthPx) * 100 : 0
          pctSum += pct
          d.maxWidthPct = Math.max(d.maxWidthPct, pct)
        })
      })
    })
  })
  d.meanWidthPct = d.runs ? pctSum / d.runs : 0
  return d
}

test.describe('slides web text-metric fidelity', () => {
  test.skip(!built(), 'no dist-web/slides build: npm run build:web -- --module slides')

  test('canvas metrics vs the desktop reference on the fixture decks', async ({ page }) => {
    const rows: string[] = []
    const results: Record<string, Drift> = {}
    for (const deck of DECKS) {
      const drift = compare(await desktopSlides(deck), await frameSlides(page, deck))
      results[deck] = drift
      rows.push(
        `| ${deck} | ${drift.nodes} | ${drift.lineMismatch} | ${drift.runs} | ${drift.maxDx.toFixed(2)} | ${drift.meanWidthPct.toFixed(2)} | ${drift.maxWidthPct.toFixed(2)} |`,
      )
    }
    writeFileSync(
      resolve(repoRoot, 'docs/web-modules/slides-fidelity.md'),
      [
        '# Slides web: text-metric fidelity (GO-B5 S4)',
        '',
        'Generated by `web/e2e/slides-fidelity.spec.ts` (headless Chromium on the production build, fit width',
        `${FIT} px). Reference = the engine in Node with OpentypeMetrics over the bundled Carlito faces (the`,
        "desktop's Calibri twin) and the heuristic where it has no font file; web = the frame's canvas",
        'measureText metrics. Per text node: line count; per run: start x (px) and width (% of the reference).',
        '',
        '| deck | text nodes | nodes with a different line count | runs compared | max run x drift (px) | mean width drift (%) | max width drift (%) |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows,
        '',
      ].join('\n'),
    )
    // Calibri deck: same font file on both sides (Carlito), so line breaks must agree
    expect(results['sample.pptx']!.lineMismatch).toBe(0)
  })
})
