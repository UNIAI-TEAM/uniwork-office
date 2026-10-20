import { test, expect } from '@playwright/test'
import JSZip from 'jszip'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  closeAndSaveVideo,
  handoffUrlToRunningApp,
  launchShell,
  screenshotPath,
  waitForPageWithUrl,
} from './helpers'

/**
 * UNI-2020 (F-G819-A07d): a UniWork xlsx opened from a launch ticket that carries a comment_id
 * must land on the commented cell with the thread focused. The real Sheets renderer and the real
 * comments preload run; only the main-process half of the comments seam is faked (the UniWork
 * server is out of scope): `context`, `list` and the held-reveal pull answer from a script.
 */

const DOC_ID = 'doc-uni2020'
const ROOT_ID = '01M4ZFJ4K2BJC1X6313JVAP243'
const ANCHOR_SHEET = 'Doanh thu Q2'
const ANCHOR_RANGE = 'B7'
/** rows per sheet */
const ROWS = 10

interface Probe {
  /** every fake-seam call the renderer made, in order, with ms since install */
  calls: string[]
  /** renderer console lines (all levels) */
  console: string[]
}

const CELL = (ref: string, text: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`

function sheetXml(cells: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${cells}</sheetData></worksheet>`
  )
}

/** a two-sheet workbook: sheet 1 opens on A1, sheet 2 holds the anchored B7 */
async function twoSheetWorkbook(): Promise<Buffer> {
  const rows = (prefix: string) =>
    Array.from({ length: ROWS }, (_, i) => {
      const row = i + 1
      return `<row r="${row}">${CELL(`A${row}`, `${prefix} a${row}`)}${CELL(`B${row}`, `${prefix} b${row}`)}</row>`
    }).join('')
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Doanh thu Q1" sheetId="1" r:id="rId1"/>' +
      `<sheet name="${ANCHOR_SHEET}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
  )
  zip.file('xl/worksheets/sheet1.xml', sheetXml(rows('q1')))
  zip.file('xl/worksheets/sheet2.xml', sheetXml(rows('q2')))
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '</styleSheet>',
  )
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Replaces the main-process comments handlers before the workbook opens, so the real preload
 * (`window.uniworkComments`) talks to a scripted server. The held reveal behaves like
 * comments-wiring's: the first `reveal:pending` pull gets it once, later pulls get null.
 */
async function installFakeComments(app: ElectronApplication, commentId: string): Promise<void> {
  await app.evaluate(
    ({ ipcMain, webContents, app: electronApp }, cfg) => {
      const g = globalThis as unknown as { __u2020?: Probe }
      const started = Date.now()
      const probe: Probe = { calls: [], console: [] }
      g.__u2020 = probe
      const note = (what: string) => probe.calls.push(`+${Date.now() - started}ms ${what}`)

      const listen = (wc: Electron.WebContents) => {
        wc.on('console-message', (...args: unknown[]) => {
          const first = args[0] as { message?: string; level?: unknown } | undefined
          const text =
            first && typeof first === 'object' && 'message' in first
              ? String(first.message)
              : String(args[2])
          probe.console.push(`+${Date.now() - started}ms ${text}`)
        })
      }
      for (const wc of webContents.getAllWebContents()) listen(wc)
      electronApp.on('web-contents-created', (_e, wc) => listen(wc))

      const channels = {
        context: 'uniwork:comments:context',
        list: 'uniwork:comments:list',
        revealPending: 'uniwork:comments:reveal:pending',
        reveal: 'uniwork:comments:reveal',
        anchors: 'uniwork:comments:anchors',
      }
      for (const channel of [channels.context, channels.list, channels.revealPending]) {
        ipcMain.removeHandler(channel)
      }

      let path = ''
      let pulls = 0
      let held: { path: string; commentId: string } | null = null
      const root = {
        id: cfg.commentId,
        document_id: cfg.docId,
        author_id: 'user-other',
        parent_id: null,
        body: 'Check the Q2 revenue',
        kind: 'comment',
        revision: 1,
        anchor: { format: 'xlsx', v: 1, sheet: cfg.anchorSheet, range: cfg.anchorRange },
        anchor_state: 'exact',
        resolved_at: null,
        deleted_at: null,
        created_at: '2026-10-20T00:00:00Z',
        updated_at: '2026-10-20T00:00:00Z',
        display_name: 'Tester B',
      }

      ipcMain.handle(channels.context, (_e, input: { path: string }) => {
        path = input.path
        note(`context path=${path}`)
        held = { path, commentId: cfg.commentId }
        return {
          ok: true,
          value: {
            documentId: cfg.docId,
            versionId: 'ver-1',
            level: 'manage',
            myUserId: 'user-me',
          },
        }
      })
      ipcMain.handle(channels.list, () => {
        note('list answered')
        return {
          ok: true,
          value: { comments: [root], mentions: [], list_token: 'tok-1', unchanged: false },
        }
      })
      ipcMain.handle(channels.revealPending, () => {
        pulls += 1
        const answer = held
        if (answer) held = null
        note(`reveal pull #${pulls} -> ${answer ? 'held reveal' : 'null'}`)
        return answer
      })
      // the first Save / anchor sync is not under test: accept anything
      ipcMain.removeHandler(channels.anchors)
      ipcMain.handle(channels.anchors, () => ({
        ok: true,
        value: { updated: [], skipped: [], list_token: 'tok-1' },
      }))
    },
    {
      commentId,
      docId: DOC_ID,
      anchorSheet: ANCHOR_SHEET,
      anchorRange: ANCHOR_RANGE,
    },
  )
}

async function readProbe(app: ElectronApplication): Promise<Probe> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __u2020?: Probe }
    return g.__u2020 ?? { calls: [], console: [] }
  })
}

/** what the open sheet shows: the name box (selected range) and the active sheet tab */
async function editorState(page: Page): Promise<{ range: string; sheet: string }> {
  return page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-u-comp="defined-name"] input')
    const tab = document.querySelector<HTMLElement>(
      '[data-u-comp="slide-tab-bar"] [class*="active"], [role="tab"][aria-selected="true"]',
    )
    return { range: input?.value ?? '', sheet: tab?.textContent?.trim() ?? '' }
  })
}

for (const mode of ['pull'] as const) {
  test.describe(`sheets: server reveal (${mode})`, () => {
    test('reveal from a launch ticket selects the anchor cell and focuses the thread', async () => {
      const scratch = await mkdtemp(join(tmpdir(), 'uni2020-reveal-'))
      const workbook = join(scratch, 'revenue.xlsx')
      await writeFile(workbook, await twoSheetWorkbook())

      const launched = await launchShell({
        onboardingSeen: true,
        videoDir: 'sheets-server-reveal',
      })
      try {
        await installFakeComments(launched.app, ROOT_ID)
        // the OS hands the file to the running app: the sheets editor opens after the fake is live
        await handoffUrlToRunningApp(launched.userDataDir, workbook)
        const sheets = await waitForPageWithUrl(launched.app, '://sheets/')

        await expect
          .poll(
            async () =>
              (await readProbe(launched.app)).calls.some((c) => c.includes('list answered')),
            {
              timeout: 30_000,
            },
          )
          .toBe(true)
        // the reveal runs once the workbook has opened: wait until it demonstrably happened ...
        await expect
          .poll(
            async () => {
              const calls = (await readProbe(launched.app)).calls
              const pulled = calls.some((c) => c.includes('-> held reveal'))
              return pulled && (await editorState(sheets)).range === ANCHOR_RANGE
            },
            { timeout: 25_000 },
          )
          .toBe(true)
        // ... then settle past the 1.5 s focus guard, so the final read proves focus survives its end
        await sheets.waitForTimeout(3_000)
        // the panel's thread heading is DOM: focused = document.activeElement

        const probe = await readProbe(launched.app)
        const focus = await sheets.evaluate((id) => {
          const active = document.activeElement as HTMLElement | null
          const item = document.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)
          return {
            present: !!item,
            focusedThreadId:
              active?.closest<HTMLElement>('[data-thread-id]')?.dataset.threadId ?? null,
          }
        }, ROOT_ID)
        const state = await editorState(sheets)
        await sheets.screenshot({ path: screenshotPath(`sheets-server-reveal-${mode}`) })
        test.info().annotations.push({
          type: 'probe',
          description: JSON.stringify({ mode, focus, state, calls: probe.calls }),
        })
        expect(focus.focusedThreadId, 'the revealed thread has focus').toBe(ROOT_ID)
        expect(state.range, 'the anchor cell is selected').toBe(ANCHOR_RANGE)
        expect(state.sheet, 'the anchor sheet is active').toBe(ANCHOR_SHEET)
      } finally {
        await closeAndSaveVideo(launched, `sheets-server-reveal-${mode}`)
        await rm(scratch, { recursive: true, force: true })
      }
    })
  })
}
