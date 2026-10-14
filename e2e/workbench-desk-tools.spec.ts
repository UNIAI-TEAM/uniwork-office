import { test, expect, type ElectronApplication } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { closeAndSaveVideo, launchShell } from './helpers'

/**
 * Desk tools run end to end in the real main process: native pickers are
 * stubbed to answer with paths under a temp dir, then each tool is called
 * through the shell page's `window.aiOffice.runDeskTool`.
 */

const ROOT = resolve(__dirname, '..')
// built by `npm run build:all` (cargo); a .xlsx cannot open without it
const XLSX_SIDECAR = join(
  ROOT,
  'apps/sheets/native/xlsx-engine/target/release',
  process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar',
)

/** a PDF whose pages carry `label` and are `width` points wide, so order is checkable */
async function makePdf(path: string, label: string, pages: number, width: number) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    doc.addPage([width, 400]).drawText(`${label} page ${i}`, { x: 40, y: 300, size: 18, font })
  }
  await writeFile(path, await doc.save())
}

const pageWidths = async (path: string) =>
  (await PDFDocument.load(await readFile(path))).getPages().map((p) => p.getWidth())

/** next save dialog answers `path`; open dialogs answer `folder`; message boxes answer OK */
async function stubDialogs(app: ElectronApplication, savePath: string, folder: string) {
  await app.evaluate(
    ({ dialog }, { savePath, folder }) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: savePath,
      })) as typeof dialog.showSaveDialog
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog
      dialog.showMessageBox = (async () => ({
        response: 0,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox
    },
    { savePath, folder },
  )
}

test('Desk tools merge, split, convert and export PDFs', async () => {
  test.setTimeout(240_000)
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-desk-tools-'))
  const a = join(dir, 'a.pdf')
  const b = join(dir, 'b.pdf')
  const c = join(dir, 'c.pdf')
  await makePdf(a, 'Alpha', 3, 300)
  await makePdf(b, 'Bravo', 1, 400)
  await makePdf(c, 'Charlie', 2, 500)

  const docx = join(dir, 'letter.docx')
  await writeFile(docx, await readFile(join(ROOT, 'fixtures/generated/simple.docx')))
  const pptx = join(dir, 'deck.pptx')
  await writeFile(
    pptx,
    await readFile(join(ROOT, 'packages/pptx-engine/tests/fixtures/01_standard_business.pptx')),
  )
  const xlsx = join(dir, 'sheet.xlsx')
  const zip = await JSZip.loadAsync(
    await readFile(join(ROOT, 'apps/shell/build/shell-new/blank.xlsx')),
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:B1"/><sheetData><row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>Budget</t></is></c><c r="B1"><v>42</v></c>' +
      '</row></sheetData></worksheet>',
  )
  await writeFile(xlsx, await zip.generateAsync({ type: 'nodebuffer' }))
  const md = join(dir, 'notes.md')
  await writeFile(md, '# Notes\n\nA short paragraph.\n')
  const html = join(dir, 'page.html')
  await writeFile(html, '<!doctype html><html><body><h1>Page</h1><p>Hello.</p></body></html>')

  const launched = await launchShell({ onboardingSeen: true, videoDir: 'workbench-desk-tools' })
  const { app, page } = launched
  const run = (req: { tool: string; inputs: string[]; splitEvery?: number }) =>
    page.evaluate(
      (r) =>
        (
          window as unknown as {
            aiOffice: { runDeskTool(r: unknown): Promise<Record<string, unknown>> }
          }
        ).aiOffice.runDeskTool(r),
      req,
    )

  try {
    await test.step('merge keeps the picked order', async () => {
      const out = join(dir, 'merged.pdf')
      await stubDialogs(app, out, dir)
      expect(await run({ tool: 'merge-pdf', inputs: [c, a, b] })).toEqual({
        ok: true,
        outputs: [out],
      })
      expect(await pageWidths(out)).toEqual([500, 500, 300, 300, 300, 400])
    })

    await test.step('merge refuses to overwrite a source', async () => {
      await stubDialogs(app, a, dir)
      expect(await run({ tool: 'merge-pdf', inputs: [a, b] })).toEqual({
        ok: false,
        error: 'same-path',
      })
    })

    await test.step('split twice writes a fresh folder', async () => {
      await stubDialogs(app, join(dir, 'unused.pdf'), dir)
      const first = await run({ tool: 'split-pdf', inputs: [a], splitEvery: 1 })
      expect(first.ok).toBe(true)
      expect(first.outputs).toHaveLength(3)
      expect((await readdir(join(dir, 'a-parts'))).sort()).toEqual([
        'a-1.pdf',
        'a-2.pdf',
        'a-3.pdf',
      ])
      const second = await run({ tool: 'split-pdf', inputs: [a], splitEvery: 2 })
      expect(second.ok).toBe(true)
      expect((await readdir(join(dir, 'a-parts 2'))).sort()).toEqual(['a-1.pdf', 'a-2.pdf'])
      expect(await pageWidths(join(dir, 'a-parts 2', 'a-1.pdf'))).toEqual([300, 300])
    })

    await test.step('a second run while one waits on its picker is refused', async () => {
      // the save dialog stays open until released, holding the tool lock
      await app.evaluate(
        ({ dialog }, out) => {
          const g = globalThis as { releaseSave?: () => void }
          dialog.showSaveDialog = (() =>
            new Promise((done) => {
              g.releaseSave = () => done({ canceled: false, filePath: out })
            })) as typeof dialog.showSaveDialog
        },
        join(dir, 'held.pdf'),
      )
      const held = run({ tool: 'merge-pdf', inputs: [a, b] })
      await expect
        .poll(() =>
          app.evaluate(() => typeof (globalThis as { releaseSave?: unknown }).releaseSave),
        )
        .toBe('function')
      expect(await run({ tool: 'split-pdf', inputs: [b] })).toEqual({ ok: false, error: 'busy' })
      await app.evaluate(() => (globalThis as { releaseSave?: () => void }).releaseSave?.())
      expect((await held).ok).toBe(true)
    })

    for (const kind of ['docx', 'xlsx', 'pptx'] as const) {
      await test.step(`PDF → ${kind}`, async () => {
        const out = join(dir, `a-converted.${kind}`)
        await stubDialogs(app, out, dir)
        expect(await run({ tool: `pdf-to-${kind}`, inputs: [a] })).toEqual({
          ok: true,
          outputs: [out],
        })
        // every OOXML file is a zip
        expect((await readFile(out)).subarray(0, 2).toString()).toBe('PK')
      })
    }

    for (const [input, folder] of [
      [docx, 'docs-autosave'],
      [pptx, 'slides-autosave'],
    ] as const) {
      await test.step(`export PDF from ${input.split('.').pop()} leaves its crash copy alone`, async () => {
        // a crash copy newer than the file: opening it normally asks Restore / Discard
        const ext = input.split('.').pop()!
        const name = createHash('sha1').update(input).digest('hex').slice(0, 16)
        const copy = join(launched.userDataDir, folder, `${name}.${ext}`)
        await mkdir(join(launched.userDataDir, folder), { recursive: true })
        await writeFile(copy, await readFile(input))
        const later = new Date(Date.now() + 60_000)
        await utimes(copy, later, later)
        const out = `${input}.with-copy.pdf`
        await stubDialogs(app, out, dir)
        // record every message box and answer "Discard", the answer that deletes the copy
        await app.evaluate(({ dialog }) => {
          const g = globalThis as { messageBoxes?: number }
          g.messageBoxes = 0
          dialog.showMessageBox = (async () => {
            g.messageBoxes = (g.messageBoxes ?? 0) + 1
            return { response: 1, checkboxChecked: false }
          }) as typeof dialog.showMessageBox
        })
        expect(await run({ tool: 'export-pdf', inputs: [input] })).toEqual({
          ok: true,
          outputs: [out],
        })
        expect(
          await app.evaluate(() => (globalThis as { messageBoxes?: number }).messageBoxes),
        ).toBe(0)
        expect(existsSync(copy)).toBe(true)
      })
    }

    for (const input of [docx, xlsx, pptx, md, html]) {
      await test.step(`export PDF from ${input.split('.').pop()}`, async () => {
        if (input === xlsx && !existsSync(XLSX_SIDECAR)) {
          test
            .info()
            .annotations.push({ type: 'skipped-step', description: 'no xlsx sidecar build' })
          return
        }
        const out = `${input}.exported.pdf`
        await stubDialogs(app, out, dir)
        expect(await run({ tool: 'export-pdf', inputs: [input] })).toEqual({
          ok: true,
          outputs: [out],
        })
        const bytes = await readFile(out)
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
        expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0)
      })
    }
  } finally {
    await closeAndSaveVideo(launched, 'workbench-desk-tools')
  }
})
