/**
 * One editing scenario run twice: by the desktop session core in Node (apps/slides/tests/
 * frame-parity.test.ts, saved with Electron's savePptxToFile) and by the web frame's slidesApi
 * on the browser shims (web/modules/slides/session-in-frame.test.ts, saved through api.save).
 * Both pin the saved package to the same snapshot (__snapshots__/frame-parity.json): the
 * deck's entries must be byte-identical. The zip container itself differs on purpose (the
 * desktop streams with data descriptors, the web generates one buffer), so entries are compared.
 */
import JSZip from 'jszip'

export const PARITY_TIME = new Date('2026-10-09T03:00:00.000Z')
export const FIT = 1280

/** a slidesApi-shaped call; `channel` is the desktop IPC channel of the same method */
export interface ParityStep {
  method: string
  channel: string
  args: (ids: ParityIds) => unknown[]
  /** keep part of the result for later steps */
  keep?: (result: unknown, ids: ParityIds) => void
}

export interface ParityIds {
  title: string
  shape: string
  table: string
}

interface Slide {
  nodes: Array<{ sourceId: string; text?: unknown; type: string }>
}

export const PARITY_STEPS: ParityStep[] = [
  {
    method: 'getRenderSlides',
    channel: 'slides:get-render-slides',
    args: () => [],
    keep: (r, ids) => {
      ids.title = (r as Slide[])[0]!.nodes.find((n) => n.text)!.sourceId
    },
  },
  {
    method: 'editText',
    channel: 'slides:edit-text',
    args: (ids) => [
      {
        slideIndex: 0,
        sourceId: ids.title,
        paragraphs: [{ runs: [{ text: 'Edited in the frame' }] }],
      },
    ],
  },
  {
    method: 'setElementFont',
    channel: 'slides:set-element-font',
    args: (ids) => [{ slideIndex: 0, sourceIds: [ids.title], bold: true, color: '#1F4E79' }],
  },
  {
    method: 'addElement',
    channel: 'slides:add-element',
    args: () => [
      {
        slideIndex: 1,
        kind: 'rect',
        xPx: 100,
        yPx: 100,
        wPx: 300,
        hPx: 120,
        fitWidthPx: FIT,
        text: 'Box',
      },
    ],
    keep: (r, ids) => {
      ids.shape = (r as { sourceId: string }).sourceId
    },
  },
  {
    method: 'editFill',
    channel: 'slides:edit-fill',
    args: (ids) => [{ slideIndex: 1, sourceId: ids.shape, fill: '#C00000' }],
  },
  {
    method: 'addTable',
    channel: 'slides:add-table',
    args: () => [
      { slideIndex: 2, rows: 2, cols: 2, xPx: 80, yPx: 400, wPx: 400, hPx: 120, fitWidthPx: FIT },
    ],
    keep: (r, ids) => {
      ids.table = (r as { sourceId: string }).sourceId
    },
  },
  {
    method: 'editTableCell',
    channel: 'slides:edit-table-cell',
    args: (ids) => [
      {
        slideIndex: 2,
        sourceId: ids.table,
        row: 0,
        col: 0,
        paragraphs: [{ runs: [{ text: 'Cell' }] }],
      },
    ],
  },
  {
    method: 'setNotes',
    channel: 'slides:set-notes',
    args: () => [{ slideIndex: 0, text: 'Speaker notes from the frame' }],
  },
  {
    method: 'moveSlide',
    channel: 'slides:move-slide',
    args: () => [{ fromIndex: 0, toIndex: 2 }],
  },
  { method: 'undo', channel: 'slides:undo', args: () => [] },
  { method: 'redo', channel: 'slides:redo', args: () => [] },
]

/** run the steps through `call` (desktop: the handler registry; web: window.slidesApi) */
export async function runParity(
  call: (step: ParityStep, args: unknown[]) => Promise<unknown>,
): Promise<void> {
  const ids: ParityIds = { title: '', shape: '', table: '' }
  for (const step of PARITY_STEPS) {
    const result = await call(step, step.args(ids))
    if (result === null || result === undefined || result === false)
      throw new Error(`parity step ${step.method} failed`)
    step.keep?.(result, ids)
  }
}

/** entry name -> uncompressed size + SHA-256 (WebCrypto; available in Node and the browser) */
export async function packageDigest(bytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes)
  const out: Record<string, string> = {}
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name]!
    if (entry.dir) continue
    const data = await entry.async('uint8array')
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>),
    )
    out[name] = `${data.length}:${[...digest].map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }
  return out
}
