import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { DeskToolId, DeskToolResult } from '../shared/home-api'

export const DESK_TOOL_IDS: readonly DeskToolId[] = [
  'pdf-to-docx',
  'pdf-to-xlsx',
  'pdf-to-pptx',
  'export-pdf',
  'merge-pdf',
  'split-pdf',
]

const PDF = /\.pdf$/i
/** what Export PDF takes: the inputs headlessModuleFor (electron-utils) routes to an editor */
export const EXPORTABLE = /\.(docx|xlsx|xlsm|xls|csv|tsv|pptx|md|markdown|html|htm)$/i
const MAX_MERGE = 50

/** Everything runDeskTool touches outside itself; index.ts wires the real ones, tests pass fakes. */
export interface DeskToolDeps {
  /** a Desk tool or a PDF tab conversion is already running */
  busy(): boolean
  setBusy(on: boolean): void
  /** taskbar / dock progress, shown once the user picked where to write */
  progress(on: boolean): void
  /** [] when the picker was cancelled */
  pickFiles(opts: { exportable: boolean; multi: boolean }): Promise<string[]>
  /** null when cancelled */
  pickSavePath(defaultPath: string): Promise<string | null>
  /** null when cancelled */
  pickFolder(defaultPath: string): Promise<string | null>
  /** the PDF tab's own flow (save dialog, stale tab, password, degrade notes); null = cancelled or already reported */
  convertPdf(kind: 'docx' | 'xlsx' | 'pptx', pdfPath: string): Promise<string | null>
  /** hidden-window export; throws on failure */
  exportPdf(input: string, outPath: string): Promise<void>
  mergePdf(first: Uint8Array, others: Uint8Array[]): Promise<{ merged: Uint8Array }>
  splitPdf(bytes: Uint8Array, every: number): Promise<Uint8Array[]>
  /** a main-window tab shows this PDF */
  isOpenInTab(path: string): boolean
  isFile(path: string): boolean
  exists(path: string): boolean
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  mkdir(path: string): Promise<void>
  recordRecent(path: string): void
}

// APFS and NTFS default to case-insensitive; on a case-sensitive volume this only refuses more
const norm = (p: string) =>
  process.platform === 'win32' || process.platform === 'darwin'
    ? resolve(p).toLowerCase()
    : resolve(p)
const stem = (path: string) => basename(path, extname(path))

/** Input check at the trust boundary: absolute paths, extension, count, existence. */
export function checkDeskInputs(
  tool: DeskToolId,
  inputs: readonly unknown[],
  isFile: (path: string) => boolean,
): DeskToolResult | null {
  const bad = { ok: false, error: 'bad-input' } as const
  if (!inputs.every((p) => typeof p === 'string' && isAbsolute(p))) return bad
  const paths = inputs as string[]
  const want = tool === 'export-pdf' ? EXPORTABLE : PDF
  if (!paths.every((p) => want.test(p))) return bad
  const countOk =
    tool === 'merge-pdf' ? paths.length >= 2 && paths.length <= MAX_MERGE : paths.length === 1
  if (!countOk) return bad
  if (!paths.every(isFile)) return { ok: false, error: 'not-found' }
  return null
}

/** a folder that does not exist yet: "<base>", then "<base> 2", "<base> 3"… */
function freshDir(base: string, exists: (path: string) => boolean): string {
  let dir = base
  for (let n = 2; exists(dir); n++) dir = `${base} ${n}`
  return dir
}

/**
 * One Desk tool run (office desk spec §4-5.1): validate, pick inputs when
 * none were dropped, ask where to write, run, record the output as recent.
 * Never throws; one tool at a time.
 */
export async function runDeskTool(raw: unknown, deps: DeskToolDeps): Promise<DeskToolResult> {
  const bad = { ok: false, error: 'bad-input' } as const
  const canceled = { ok: false, canceled: true } as const
  const req = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tool = req.tool as DeskToolId
  if (!DESK_TOOL_IDS.includes(tool)) return bad
  const every = req.splitEvery ?? 1
  if (typeof every !== 'number' || !Number.isInteger(every) || every < 1 || every > 999) return bad
  if (req.inputs !== undefined && !Array.isArray(req.inputs)) return bad
  if (deps.busy()) return { ok: false, error: 'busy' }
  // one lock from the picker to the last write, so a second request can never interleave
  deps.setBusy(true)
  try {
    let inputs: unknown[] = (req.inputs as unknown[] | undefined) ?? []
    if (inputs.length === 0) {
      inputs = await deps.pickFiles({
        exportable: tool === 'export-pdf',
        multi: tool === 'merge-pdf',
      })
      if (inputs.length === 0) return canceled
    }
    const refused = checkDeskInputs(tool, inputs, deps.isFile)
    if (refused) return refused
    const paths = inputs as string[]
    const first = paths[0]!

    if (tool === 'pdf-to-docx' || tool === 'pdf-to-xlsx' || tool === 'pdf-to-pptx') {
      // the PDF tab's flow keeps its own busy flag, dialogs and error reporting
      const kind = tool.slice('pdf-to-'.length) as 'docx' | 'xlsx' | 'pptx'
      const out = await deps.convertPdf(kind, first)
      if (!out) return canceled
      deps.recordRecent(out)
      return { ok: true, outputs: [out] }
    }

    if (tool === 'split-pdf') {
      const where = await deps.pickFolder(dirname(first))
      if (!where) return canceled
      deps.progress(true)
      const parts = await deps.splitPdf(await deps.readFile(first), every)
      const base = stem(first).replace(/[/\\:*?"<>|]/g, '_')
      // a fresh folder, so a split never overwrites earlier parts
      const dir = freshDir(join(where, `${base}-parts`), deps.exists)
      await deps.mkdir(dir)
      const outputs: string[] = []
      for (const [i, bytes] of parts.entries()) {
        const out = join(dir, `${base}-${i + 1}.pdf`)
        await deps.writeFile(out, bytes)
        outputs.push(out)
      }
      return { ok: true, outputs }
    }

    const suggested = join(
      dirname(first),
      tool === 'merge-pdf' ? `${stem(first)}-merged.pdf` : `${stem(first)}.pdf`,
    )
    const out = await deps.pickSavePath(suggested)
    if (!out) return canceled
    if (paths.some((p) => norm(p) === norm(out))) return { ok: false, error: 'same-path' }
    if (deps.isOpenInTab(out)) return { ok: false, error: 'target-open' }
    deps.progress(true)
    if (tool === 'export-pdf') {
      await deps.exportPdf(first, out)
    } else {
      const [head, ...rest] = await Promise.all(paths.map((p) => deps.readFile(p)))
      const { merged } = await deps.mergePdf(head!, rest)
      await deps.writeFile(out, merged)
    }
    deps.recordRecent(out)
    return { ok: true, outputs: [out] }
  } catch (err) {
    console.error('[shell] desk tool failed:', err)
    return { ok: false, error: 'failed' }
  } finally {
    deps.progress(false)
    deps.setBusy(false)
  }
}
