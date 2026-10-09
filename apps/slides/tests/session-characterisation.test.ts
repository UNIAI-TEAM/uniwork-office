// @vitest-environment node
/**
 * Characterisation harness for the Slides document session (GO-B5 / S1a).
 *
 * Drives the real `slides:*` IPC handlers through a fake ipcMain (no Electron) on the
 * fixture decks: open -> representative edits across every handler family -> save. Each
 * step's result, the events main pushes to the renderers and the platform calls
 * (dialogs, clipboard, nativeImage) are digested into a trace that is pinned in
 * __snapshots__/session-characterisation.trace.json, together with the saved bytes.
 * Moving the session core out of Electron main must leave that trace unchanged.
 *
 * Non-determinism is pinned: Date (fake timers), crypto.randomUUID (counter), Math.random
 * (LCG) and font metrics (heuristic provider instead of the machine's system fonts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TINY_PNG,
  digest,
  drainSideEffects,
  fileDigest,
  flushDeferred,
  harness,
  invoke,
  shape,
} from './helpers/slides-ipc-harness'

vi.mock('electron', async () => (await import('./helpers/slides-ipc-harness')).electronModule)
vi.mock(
  '@genoffice/electron-utils',
  async () => (await import('./helpers/slides-ipc-harness')).electronUtilsModule,
)
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  let n = 0
  return {
    ...actual,
    randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  }
})
vi.mock('../src/main/fonts', async () => {
  const { HeuristicMetrics } = await import('@genoffice/pptx-render')
  return {
    createSystemFontMetrics: () => new HeuristicMetrics(),
    resetFontRegistry: () => {},
    registerEmbeddedFonts: () => false,
    listPrivateFontFaces: () => [],
    getPrivateFontData: () => null,
  }
})
vi.mock('../src/main/shaped-metrics', () => ({
  refineComplexWidths: async () => false,
  shapedMetricsReady: async () => {},
}))
vi.mock('../src/main/font-store', () => ({
  downloadFontFamily: async () => {},
  initFontStore: () => {},
  installLocalFontFiles: () => [],
  listFontCatalog: () => [],
  missingCatalogFonts: () => [],
}))
vi.mock('../src/main/ai-ipc', () => ({
  registerAiIpc: () => {},
  registerSlidesOnlyAiIpc: () => {},
}))
vi.mock('../src/main/presenter-show', () => ({ registerPresenterIpc: () => {} }))
vi.mock('../src/main/attachments-ipc', () => ({ registerAttachmentIpc: () => {} }))
vi.mock('../src/main/generated-page-temp', () => ({
  cleanupExpiredGeneratedPages: async () => {},
}))
vi.mock('../src/main/pdf-export', () => ({ exportSlidesPdf: async () => ({ ok: false }) }))
vi.mock('@genoffice/ai-search', () => ({
  gskApiKey: () => '',
  gskSlideGenerate: async () => ({ bytes: new Uint8Array(), model: '' }),
  setGskProxyUrl: () => {},
}))
vi.mock('@genoffice/project-store', () => ({ ProjectStore: class {} }))
vi.mock('@genoffice/pipelines/slides', () => ({
  buildPagePptx: async () => ({ bytes: new Uint8Array(), imageFailures: [] }),
  parsePageSpec: () => ({ ok: false, error: 'not in the harness' }),
}))

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '..', '..', '..', 'packages', 'pptx-engine', 'tests', 'fixtures')
const SNAPSHOT = join(here, '__snapshots__', 'session-characterisation.trace.json')
const FIT = 1280

interface Node {
  type: string
  sourceId: string
  text?: unknown
}
interface Slide {
  nodes: Node[]
}

let root = ''
const trace: unknown[] = []

/** Replace the temp root in any string so the trace does not depend on the machine. */
function scrub(value: unknown): unknown {
  if (typeof value === 'string') return root ? value.split(root).join('<tmp>') : value
  if (Array.isArray(value)) return value.map(scrub)
  if (value instanceof Uint8Array || value instanceof Map) return value
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v)
    return out
  }
  return value
}

/** Invoke a handler, wait for coalesced notifications, and append the step to the trace. */
async function step<T = unknown>(wc: number, channel: string, ...args: unknown[]): Promise<T> {
  const result = await invoke(wc, channel, ...args)
  await flushDeferred()
  const clean = scrub(result)
  const effects = drainSideEffects()
  trace.push({
    wc,
    channel,
    result: shape(clean),
    digest: digest(clean),
    ...(scrub(effects) as object),
  })
  return result as T
}

function saved(name: string, path: string): void {
  trace.push({ saved: name, bytes: fileDigest(new Uint8Array(readFileSync(path))) })
}

/** Ids are re-minted by reparsing edits: look the last shape on a slide up right before use. */
async function lastShape(wc: number, slideIndex: number): Promise<string> {
  const slides = await step<Slide[]>(wc, 'slides:get-render-slides')
  return slides[slideIndex]!.nodes.filter((n) => n.type === 'shape').at(-1)!.sourceId
}

const firstText = (slide: Slide): Node =>
  slide.nodes.find((n) => (n.type === 'shape' || n.type === 'text') && n.text)!

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-10-09T03:00:00.000Z'))
  let uuid = 0
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
    () => `10000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` as const,
  )
  // Field GUIDs (header/footer slide numbers) come from Math.random: a fixed LCG pins them
  let seed = 0x2f6b
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  })
  root = mkdtempSync(join(tmpdir(), 'slides-harness-'))
  harness.userData = join(root, 'userData')
  harness.draftsDir = join(root, 'drafts')
  harness.tempDir = join(root, 'temp')
  for (const d of [harness.userData, harness.draftsDir, harness.tempDir, join(root, 'in')])
    mkdirSync(d, { recursive: true })
  copyFileSync(join(FIXTURES, '01_standard_business.pptx'), join(root, 'in', 'business.pptx'))
  copyFileSync(join(FIXTURES, '05_unicode_cjk_emoji.pptx'), join(root, 'in', 'unicode.pptx'))
  writeFileSync(join(root, 'in', 'picture.png'), TINY_PNG)
  writeFileSync(join(root, 'in', 'texture.png'), TINY_PNG)
  writeFileSync(
    join(root, 'in', 'sound.mp3'),
    Uint8Array.from({ length: 64 }, (_, i) => i),
  )
  const main = await import('../src/main/slides-main')
  main.registerSlidesIpc()
  drainSideEffects()
})

afterAll(() => {
  vi.useRealTimers()
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('slides session characterisation', () => {
  it('replays the fixture scenario with an unchanged trace', async () => {
    const business = join(root, 'in', 'business.pptx')
    const A = 1

    // ── Open + text family ────────────────────────────────────────────
    await step(A, 'slides:open-path', business, FIT)
    let slides = await step<Slide[]>(A, 'slides:get-render-slides')
    const title = firstText(slides[0]!).sourceId
    await step(A, 'slides:edit-text', {
      slideIndex: 0,
      sourceId: title,
      paragraphs: [{ runs: [{ text: 'Characterised title' }] }, { runs: [{ text: 'Line two' }] }],
    })
    await step(A, 'slides:set-element-font', {
      slideIndex: 0,
      sourceIds: [title],
      bold: true,
      fontSizePt: 40,
      color: '#1F4E79',
    })
    await step(A, 'slides:set-element-paragraph-format', {
      slideIndex: 0,
      sourceIds: [title],
      align: 'center',
      spaceAfterPt: 6,
    })
    await step(A, 'slides:set-element-paragraph-format', {
      slideIndex: 0,
      sourceIds: [title],
      indentDelta: 1,
    })
    await step(A, 'slides:find-replace', {
      find: 'Line',
      replace: 'Row',
      matchCase: true,
      firstOnly: false,
    })

    // ── Shapes ───────────────────────────────────────────────────────
    const box = await step<{ sourceId: string }>(A, 'slides:add-element', {
      slideIndex: 1,
      kind: 'rect',
      xPx: 100,
      yPx: 120,
      wPx: 300,
      hPx: 160,
      fitWidthPx: FIT,
      text: 'Box one\nsecond',
      fillColor: '#4472C4',
      stroke: { color: '#203864', widthPt: 2 },
    })
    const shapeId = box.sourceId
    for (const [x, preview] of [
      [110, true],
      [130, true],
      [140, false],
    ] as const)
      await step(A, 'slides:edit-transform', {
        slideIndex: 1,
        sourceId: shapeId,
        xPx: x,
        yPx: 140,
        wPx: 320,
        hPx: 170,
        rotationDeg: 0,
        fitWidthPx: FIT,
        preview,
      })
    await step(A, 'slides:edit-fill', { slideIndex: 1, sourceId: shapeId, fill: '#FF0000' })
    await step(A, 'slides:edit-fill', {
      slideIndex: 1,
      sourceId: shapeId,
      fill: { gradient: { from: '#FF0000', to: '#0000FF', angleDeg: 45 } },
    })
    await step(A, 'slides:edit-fill', {
      slideIndex: 1,
      sourceId: shapeId,
      fill: {
        gradient: { from: '#FFFFFF', to: '#000000', path: 'circle', center: { x: 0.3, y: 0.4 } },
      },
    })
    await step(A, 'slides:edit-stroke', {
      slideIndex: 1,
      sourceId: shapeId,
      stroke: { color: '#00B050', widthPt: 3, dash: 'dash', cap: 'rnd', join: 'round' },
    })
    await step(A, 'slides:flip-elements', { slideIndex: 1, sourceIds: [shapeId], axis: 'h' })
    await step(A, 'slides:change-shape', { slideIndex: 1, sourceId: shapeId, prst: 'roundRect' })
    for (const preview of [true, false])
      await step(A, 'slides:set-shape-adjust', {
        slideIndex: 1,
        sourceId: shapeId,
        adjust: { adj: 30000 },
        preview,
      })
    await step(A, 'slides:set-text-anchor', { slideIndex: 1, sourceId: shapeId, anchor: 'bottom' })
    await step(A, 'slides:set-text-body-props', {
      slideIndex: 1,
      sourceId: shapeId,
      props: { autofit: 'resize', insets: { l: 0.2 } },
    })
    await step(A, 'slides:set-effects', {
      slideIndex: 1,
      sourceId: shapeId,
      effects: { shadow: { color: '#000000', blurRad: 50800, dist: 38100, dirDeg: 45 } },
    })
    await step(A, 'slides:edit-connector-endpoints', {
      slideIndex: 1,
      sourceId: shapeId,
      x1Px: 0,
      y1Px: 0,
      x2Px: 10,
      y2Px: 10,
      fitWidthPx: FIT,
    })
    const second = await step<{ sourceId: string }>(A, 'slides:add-element', {
      slideIndex: 1,
      kind: 'ellipse',
      xPx: 500,
      yPx: 300,
      wPx: 120,
      hPx: 120,
      fitWidthPx: FIT,
    })
    await step(A, 'slides:batch-edit-transform', {
      slideIndex: 1,
      fitWidthPx: FIT,
      items: [
        { sourceId: shapeId, xPx: 150, yPx: 150, wPx: 320, hPx: 170, rotationDeg: 10 },
        { sourceId: second.sourceId, xPx: 520, yPx: 310, wPx: 120, hPx: 120, rotationDeg: 0 },
      ],
    })
    await step(A, 'slides:reorder-element', {
      slideIndex: 1,
      sourceId: second.sourceId,
      dir: 'back',
    })
    const grouped = await step<{ groupId: string }>(A, 'slides:group-elements', {
      slideIndex: 1,
      sourceIds: [shapeId, second.sourceId],
    })
    await step(A, 'slides:ungroup-element', { slideIndex: 1, sourceId: grouped.groupId })
    slides = await step<Slide[]>(A, 'slides:get-render-slides')
    const onSlide1 = slides[1]!.nodes.map((n) => n.sourceId)
    await step(A, 'slides:copy-elements', { slideIndex: 1, sourceIds: onSlide1.slice(-2) })
    await step(A, 'slides:clipboard-probe')
    await step(A, 'slides:clipboard-external')
    await step(A, 'slides:paste-elements', { slideIndex: 2, fitWidthPx: FIT })
    await step(A, 'slides:paste-elements', { slideIndex: 2, fitWidthPx: FIT })
    const dup = await step<{ sourceIds: string[] }>(A, 'slides:duplicate-elements', {
      slideIndex: 1,
      sourceIds: onSlide1.slice(-1),
      dxPx: 20,
      dyPx: 20,
      fitWidthPx: FIT,
    })
    await step(A, 'slides:delete-element', { slideIndex: 1, sourceId: dup.sourceIds[0] })
    let liveShape = await lastShape(A, 1)
    await step(A, 'slides:apply-edit-script', {
      slideIndex: 1,
      fitWidthPx: FIT,
      boxes: [{ id: liveShape, x: 60, y: 60, w: 400, h: 90, rotation: 0 }],
      edits: [
        { id: liveShape, kind: 'text', paragraphs: [{ runs: [{ text: 'Scripted' }] }] },
        { id: liveShape, kind: 'style', style: { bold: true, align: 'right' } },
      ],
    })

    // ── Tables ───────────────────────────────────────────────────────
    const table = await step<{ sourceId: string }>(A, 'slides:add-table', {
      slideIndex: 2,
      rows: 3,
      cols: 3,
      xPx: 80,
      yPx: 300,
      wPx: 600,
      hPx: 180,
      fitWidthPx: FIT,
    })
    let tableId = table.sourceId
    await step(A, 'slides:edit-table-cell', {
      slideIndex: 2,
      sourceId: tableId,
      row: 0,
      col: 0,
      paragraphs: [{ runs: [{ text: 'Head' }] }],
    })
    tableId = (
      await step<{ sourceId: string }>(A, 'slides:table-structure', {
        slideIndex: 2,
        sourceId: tableId,
        kind: 'insert-row',
        index: 1,
      })
    ).sourceId
    tableId = (
      await step<{ sourceId: string }>(A, 'slides:table-merge', {
        slideIndex: 2,
        sourceId: tableId,
        kind: 'merge-right',
        row: 1,
        col: 0,
      })
    ).sourceId
    await step(A, 'slides:set-table-col-width', {
      slideIndex: 2,
      sourceId: tableId,
      col: 2,
      wPx: 150,
    })
    await step(A, 'slides:set-table-row-height', {
      slideIndex: 2,
      sourceId: tableId,
      row: 0,
      hPx: 60,
    })
    await step(A, 'slides:set-table-cell-anchor', {
      slideIndex: 2,
      sourceId: tableId,
      row: 0,
      col: 1,
      anchor: 'middle',
    })
    await step(A, 'slides:edit-table-style', {
      slideIndex: 2,
      sourceId: tableId,
      firstRow: true,
      bandRow: true,
      shadingColor: '#DDEBF7',
      cells: [{ row: 0, col: 0 }],
    })

    // ── Charts / SmartArt ────────────────────────────────────────────
    const chart = await step<{ sourceId: string }>(A, 'slides:add-chart', {
      slideIndex: 3,
      kind: 'bar',
      title: 'Sales',
      categories: ['Q1', 'Q2', 'Q3'],
      series: [
        { name: 'North', values: [1, 2, 3] },
        { name: 'South', values: [3, 2, 1] },
      ],
      xPx: 100,
      yPx: 100,
      wPx: 500,
      hPx: 300,
      fitWidthPx: FIT,
    })
    await step(A, 'slides:get-chart-data', 3, chart.sourceId)
    await step(A, 'slides:chart-color-schemes')
    const edited = await step<{ sourceId: string }>(A, 'slides:edit-chart', {
      slideIndex: 3,
      sourceId: chart.sourceId,
      kind: 'line',
      colorScheme: 'colorful2',
      legendPos: 'r',
      dataLabels: true,
    })
    await step(A, 'slides:edit-chart', {
      slideIndex: 3,
      sourceId: edited.sourceId,
      colorScheme: 'warm',
      title: 'Sales by quarter',
    })
    await step(A, 'slides:add-smartart', {
      slideIndex: 3,
      layout: 'process',
      items: ['Plan', 'Build', 'Ship'],
      xPx: 80,
      yPx: 450,
      wPx: 700,
      hPx: 150,
      fitWidthPx: FIT,
    })

    // ── Pictures, media, ink, background ─────────────────────────────
    harness.openDialogQueue.push({ canceled: false, filePaths: [join(root, 'in', 'picture.png')] })
    const pic = await step<{ sourceId: string }>(A, 'slides:insert-image', 4, FIT)
    await step(A, 'slides:insert-image', 4, FIT) // canceled picker
    const pngB64 = Buffer.from(TINY_PNG).toString('base64')
    const bytesPic = await step<{ sourceId: string }>(A, 'slides:add-image-bytes', {
      slideIndex: 4,
      base64: pngB64,
      ext: 'png',
      xPx: 10,
      yPx: 10,
      wPx: 64,
      hPx: 64,
      fitWidthPx: FIT,
      name: 'icon',
    })
    await step(A, 'slides:replace-picture-bytes', {
      slideIndex: 4,
      sourceId: bytesPic.sourceId,
      base64: pngB64,
      ext: 'png',
    })
    await step(A, 'slides:edit-picture-opacity', {
      slideIndex: 4,
      sourceId: pic.sourceId,
      opacity: 0.5,
    })
    await step(A, 'slides:edit-picture-src-rect', {
      slideIndex: 4,
      sourceId: pic.sourceId,
      srcRect: { l: 0.1, t: 0.1, r: 0.1, b: 0.1 },
      boxPx: { x: 200, y: 200, w: 300, h: 200 },
      fitWidthPx: FIT,
    })
    harness.openDialogQueue.push({ canceled: false, filePaths: [join(root, 'in', 'picture.png')] })
    await step(A, 'slides:pick-picture-file')
    liveShape = await lastShape(A, 1)
    await step(A, 'slides:edit-image-fill', {
      slideIndex: 1,
      targets: [{ sourceId: liveShape }],
      mode: 'tile',
      source: { base64: pngB64, ext: 'png' },
    })
    harness.openDialogQueue.push({ canceled: false, filePaths: [join(root, 'in', 'texture.png')] })
    await step(A, 'slides:edit-image-fill', {
      slideIndex: 1,
      targets: [{ sourceId: liveShape }],
      mode: 'stretch',
    })
    harness.openDialogQueue.push({ canceled: false, filePaths: [join(root, 'in', 'sound.mp3')] })
    const audio = await step<{ sourceId: string }>(A, 'slides:insert-media', 4, 'audio', FIT)
    await step(A, 'slides:media-data', 4, audio.sourceId)
    await step(A, 'slides:add-media-bytes', {
      slideIndex: 4,
      kind: 'video',
      base64: Buffer.from(Uint8Array.from({ length: 48 }, (_, i) => 255 - i)).toString('base64'),
      ext: 'webm',
      fitWidthPx: FIT,
      name: 'recording.webm',
    })
    await step(A, 'slides:add-ink', {
      slideIndex: 4,
      base64: pngB64,
      xPx: 30,
      yPx: 40,
      wPx: 50,
      hPx: 20,
      fitWidthPx: FIT,
      payload: '[[0,0],[1,1]]',
    })
    await step(A, 'slides:edit-background', {
      slideIndex: 0,
      fitWidthPx: FIT,
      kind: 'solid',
      color: '#FFF2CC',
    })
    await step(A, 'slides:edit-background', {
      slideIndex: -1,
      fitWidthPx: FIT,
      kind: 'gradient',
      from: '#FFFFFF',
      to: '#DDEBF7',
      angleDeg: 90,
    })
    harness.openDialogQueue.push({ canceled: false, filePaths: [join(root, 'in', 'texture.png')] })
    await step(A, 'slides:edit-background', {
      slideIndex: 2,
      fitWidthPx: FIT,
      kind: 'image',
      mode: 'stretch',
    })
    await step(A, 'slides:edit-background', {
      slideIndex: -1,
      fitWidthPx: FIT,
      kind: 'image',
      mode: 'tile',
      pick: false,
      sourceSlideIndex: 2,
    })
    await step(A, 'slides:edit-background', { slideIndex: 3, fitWidthPx: FIT, kind: 'reset' })
    await step(A, 'slides:edit-background', {
      slideIndex: 3,
      fitWidthPx: FIT,
      kind: 'hideGraphics',
      hidden: true,
    })

    // ── Links, header/footer, theme ──────────────────────────────────
    liveShape = await lastShape(A, 1)
    await step(A, 'slides:set-link', {
      slideIndex: 1,
      sourceId: liveShape,
      target: { kind: 'url', url: 'https://example.com/a' },
    })
    await step(A, 'slides:get-link', 1, liveShape)
    await step(A, 'slides:get-slide-links', 1)
    await step(A, 'slides:get-run-links', 1)
    await step(A, 'slides:apply-header-footer', {
      footer: 'Confidential',
      slideNum: true,
      date: '2026-10-09',
      fitWidthPx: FIT,
    })
    await step(A, 'slides:get-header-footer', 1)
    await step(A, 'slides:apply-theme', {
      name: 'Harness',
      colors: {
        dk1: '#000000',
        lt1: '#FFFFFF',
        dk2: '#1F2937',
        lt2: '#F3F4F6',
        accent1: '#2563EB',
        accent2: '#DC2626',
        accent3: '#16A34A',
        accent4: '#CA8A04',
        accent5: '#9333EA',
        accent6: '#0891B2',
        hlink: '#2563EB',
        folHlink: '#7C3AED',
      },
      majorFont: 'Georgia',
      minorFont: 'Verdana',
      fitWidthPx: FIT,
    })

    // ── Slide operations ─────────────────────────────────────────────
    await step(A, 'slides:add-slide', { sourceIndex: 0, fitWidthPx: FIT })
    await step(A, 'slides:add-slide', { sourceIndex: 1, clearText: true, fitWidthPx: FIT })
    await step(A, 'slides:add-blank-slide', { sourceIndex: 2, fitWidthPx: FIT })
    const layouts = await step<{ layouts: Array<{ path: string }> }>(A, 'slides:get-layouts')
    await step(A, 'slides:add-slide-with-layout', {
      sourceIndex: 3,
      layoutPath: layouts.layouts[1]!.path,
      fitWidthPx: FIT,
    })
    await step(A, 'slides:set-slide-layout', {
      slideIndex: 4,
      layoutPath: layouts.layouts[2]!.path,
    })
    await step(A, 'slides:set-slide-layout', { slideIndex: 4 })
    await step(A, 'slides:delete-slide', 5)
    await step(A, 'slides:move-slide', { fromIndex: 0, toIndex: 2 })
    await step(A, 'slides:set-hidden', { slideIndex: 1, hidden: true })
    await step(A, 'slides:set-transition', { slideIndex: -1, kind: 'fade' })
    await step(A, 'slides:get-transition', 0)
    await step(A, 'slides:set-advance-times', { times: [{ slideIndex: 0, ms: 3000 }] })
    slides = await step<Slide[]>(A, 'slides:get-render-slides')
    const animTarget = firstText(slides[0]!).sourceId
    await step(A, 'slides:set-animations', {
      slideIndex: 0,
      items: [
        { sourceId: animTarget, effect: 'fade', trigger: 'onClick', durationMs: 500, delayMs: 0 },
      ],
    })
    await step(A, 'slides:get-animations', 0)
    await step(A, 'slides:get-shape-keys', 0)
    await step(A, 'slides:copy-slide', 0, pngB64)
    await step(A, 'slides:has-slide-clipboard')
    await step(A, 'slides:clipboard-external')
    await step(A, 'slides:paste-slide', { afterIndex: 2, fitWidthPx: FIT })
    await step(A, 'slides:repaste-slide', { mode: 'source', fitWidthPx: FIT })
    await step(A, 'slides:repaste-slide', { mode: 'picture', fitWidthPx: FIT })

    // ── Notes, comments, sections ────────────────────────────────────
    await step(A, 'slides:set-notes', { slideIndex: 0, text: 'Speaker notes\nsecond line' })
    await step(A, 'slides:get-notes', 0)
    await step(A, 'slides:add-comment', { slideIndex: 0, text: 'Check this' })
    const comments = await step<Array<{ authorId: number; idx: number }>>(
      A,
      'slides:get-comments',
      0,
    )
    await step(A, 'slides:add-comment', { slideIndex: 0, text: 'Second' })
    await step(A, 'slides:delete-comment', {
      slideIndex: 0,
      authorId: comments[0]!.authorId,
      idx: comments[0]!.idx,
    })
    const sec = (
      await step<Array<{ id: string }>>(A, 'slides:add-section', { atSlideIndex: 0, name: 'Intro' })
    )[0]!
    const sec2 = (
      await step<Array<{ id: string }>>(A, 'slides:add-section', { atSlideIndex: 3, name: 'Body' })
    )[1]!
    await step(A, 'slides:rename-section', { id: sec.id, name: 'Opening' })
    const sections = await step<unknown[]>(A, 'slides:get-sections')
    await step(A, 'slides:move-section', { id: sec2.id, dir: 'up' })
    await step(A, 'slides:set-sections', sections)
    await step(A, 'slides:remove-section', { id: sec2.id })

    // ── Master view ──────────────────────────────────────────────────
    const master = await step<{ items: Array<{ partPath: string; slide: Slide }> }>(
      A,
      'slides:master-enter',
      FIT,
    )
    const masterItem = master.items[1]!
    const opened = await step<Slide>(A, 'slides:master-open', masterItem.partPath)
    const masterText = firstText(opened)
    await step(A, 'slides:master-edit-text', {
      sourceId: masterText.sourceId,
      paragraphs: [{ runs: [{ text: 'Master title' }] }],
    })
    await step(A, 'slides:master-edit-fill', { sourceId: masterText.sourceId, fill: '#E2F0D9' })
    await step(A, 'slides:master-edit-stroke', {
      sourceId: masterText.sourceId,
      stroke: { color: '#375623', widthPt: 1 },
    })
    for (const preview of [true, false])
      await step(A, 'slides:master-edit-transform', {
        sourceId: masterText.sourceId,
        xPx: 40,
        yPx: 30,
        wPx: 900,
        hPx: 100,
        rotationDeg: 0,
        fitWidthPx: FIT,
        preview,
      })
    await step(A, 'slides:undo') // refused in master view
    await step(A, 'slides:master-close')

    // ── Raw transactions, history batches, undo/redo ─────────────────
    await step(A, 'slides:apply-txn', {
      ops: [{ op: 'setNotes', target: { slide: 1 }, text: 'dry' }],
      dryRun: true,
    })
    await step(A, 'slides:apply-txn', {
      isolation: 'per_op',
      ops: [
        {
          op: 'setText',
          target: { slide: 0, el: animTarget },
          paragraphs: [{ runs: [{ text: 'Txn' }] }],
        },
        { op: 'setNotes', target: { slide: 1 }, text: 'from txn' },
        { op: 'deleteElement', target: { slide: 0, el: 'missing' } },
      ],
    })
    await step(A, 'slides:apply-txn', { ops: [] })
    await step(A, 'slides:history-batch-begin')
    await step(A, 'slides:set-hidden', { slideIndex: 2, hidden: true })
    await step(A, 'slides:set-notes', { slideIndex: 2, text: 'batched' })
    const snapId = await step<number>(A, 'slides:history-batch-end')
    await step(A, 'slides:set-slide-size', { cx: 9144000, cy: 6858000 })
    await step(A, 'slides:get-slide-size')
    await step(A, 'slides:ai-snapshot-restore', snapId)
    await step(A, 'slides:undo')
    await step(A, 'slides:undo')
    await step(A, 'slides:undo')
    await step(A, 'slides:redo')
    await step(A, 'slides:redo')
    await step(A, 'slides:is-dirty')

    // ── Second window on the same file shares the session ────────────
    const B = 2
    await step(B, 'slides:open-path', business, FIT)
    await step(A, 'slides:set-hidden', { slideIndex: 0, hidden: false })
    await step(B, 'slides:consume-pending-open', 960)

    // ── Save, save as ────────────────────────────────────────────────
    await step(A, 'slides:save')
    saved('business after save', business)
    await step(A, 'slides:is-dirty')
    await step(A, 'slides:set-notes', { slideIndex: 0, text: 'after save' })
    const copyPath = join(root, 'in', 'business-copy.pptx')
    harness.saveDialogQueue.push({ canceled: false, filePath: copyPath })
    await step(A, 'slides:save-as', 'Deck')
    saved('business save-as', copyPath)
    await step(A, 'slides:save-as', 'Deck') // canceled dialog
    await step(A, 'slides:recent')

    // ── New blank deck, untitled save into the drafts folder ─────────
    const C = 3
    await step(C, 'slides:new-blank', FIT)
    const blank = await step<Slide[]>(C, 'slides:get-render-slides')
    await step(C, 'slides:add-element', {
      slideIndex: 0,
      kind: 'textbox',
      xPx: 100,
      yPx: 100,
      wPx: 400,
      hPx: 80,
      fitWidthPx: FIT,
      paragraphs: [{ runs: [{ text: 'Blank deck', bold: true }] }],
    })
    void blank
    const untitled = await step<{ path: string }>(C, 'slides:save')
    saved('untitled draft', untitled.path)

    // ── Unicode deck ─────────────────────────────────────────────────
    const D = 4
    const unicode = join(root, 'in', 'unicode.pptx')
    await step(D, 'slides:open-path', unicode, FIT)
    const uni = await step<Slide[]>(D, 'slides:get-render-slides')
    await step(D, 'slides:edit-text', {
      slideIndex: 0,
      sourceId: firstText(uni[0]!).sourceId,
      paragraphs: [{ runs: [{ text: 'Tiếng Việt 中文 العربية 🎉' }] }],
    })
    await step(D, 'slides:save')
    saved('unicode after save', unicode)
    // A history batch on a short undo stack collapses into one AI rollback point
    await step(D, 'slides:history-batch-begin')
    await step(D, 'slides:history-batch-begin')
    await step(D, 'slides:set-notes', { slideIndex: 0, text: 'batched one' })
    await step(D, 'slides:history-batch-end')
    await step(D, 'slides:set-hidden', { slideIndex: 0, hidden: true })
    const rollback = await step<number>(D, 'slides:history-batch-end')
    await step(D, 'slides:undo')
    await step(D, 'slides:redo')
    await step(D, 'slides:ai-snapshot-restore', rollback)
    await step(D, 'slides:ai-snapshot-restore', rollback) // already consumed
    await step(D, 'slides:is-dirty')

    // ── Misc queries and no-session answers ──────────────────────────
    await step(9, 'slides:get-render-slides')
    await step(9, 'slides:is-dirty')
    await step(9, 'slides:get-slide-links', 0)
    await step(9, 'slides:get-header-footer', 0)
    await step(9, 'slides:get-transition', 0)
    await step(9, 'slides:get-notes', 0)
    await step(9, 'slides:copy-elements', { slideIndex: 0, sourceIds: [] })
    await step(9, 'slides:set-transition', { slideIndex: 0, kind: 'fade' })
    await step(9, 'slides:save')

    await expect(JSON.stringify(trace, null, 1) + '\n').toMatchFileSnapshot(SNAPSHOT)
  })
})
