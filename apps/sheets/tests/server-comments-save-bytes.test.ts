/**
 * G8-13 (UNI-1408), FE13-2 / lane decision D3: server comments never touch the workbook's own
 * comment parts. Byte-level, through the real save path: a workbook with a threaded comment (+ a
 * reply, persons) and a legacy note is opened by the xlsx sidecar and handed to the renderer stores
 * the way the preload does (F2: the thread reaches the thread store); a server comment is tracked
 * and a row is inserted (both stores follow it, as App does); the note snapshot is collected as the
 * Save does and the workbook is saved with `saveWorkbookViaSidecar`. The threadedComments, persons
 * and legacy comments parts must come back byte-for-byte.
 *
 * Needs the xlsx sidecar binary (`apps/sheets/native/xlsx-engine`, cargo release build). Without it
 * the suite is skipped with a message (as the CLI's sidecar tests are); the cloud CI replica builds
 * it, so the cloud run is the proof.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyCellEditsToXlsx } from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'
import { saveWorkbookViaSidecar } from '@genoffice/xlsx-gateway/gateway/xlsx-package-io'
import { XlsxSidecarClient } from '../src/main/xlsx-sidecar-client'
import { parseWorksheetComment } from '../src/preload/worksheet-comments'
import {
  createEditJournal,
  recordStructuralOp,
  toSaveStructuralOps,
} from '../src/renderer/edit-journal'
import { ServerAnchorStore } from '../src/renderer/server-comments/anchor-store'
import { threadStore } from '../src/renderer/threaded-comments'
import { collectNoteStates } from '../src/renderer/univer-sync'
import type { LazyWorkbookState, UniverRuntime } from '../src/renderer/univer-state'
import type { WorkbookFile } from '../src/shared/desktop-api'
import { buildEditFixture } from './fixture-builder'

const SIDECAR = fileURLToPath(
  new URL(
    `../native/xlsx-engine/target/release/${process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'}`,
    import.meta.url,
  ),
)
const HAS_SIDECAR = existsSync(SIDECAR)
if (!HAS_SIDECAR) {
  console.warn(
    `server-comments-save-bytes: skipped, no xlsx sidecar at ${SIDECAR} ` +
      '(cargo build --release in apps/sheets/native/xlsx-engine; the cloud CI replica builds it)',
  )
}

const THREAD = {
  id: '{A1B2C3D4-0000-4000-8000-000000000001}',
  personId: '{9E5A0F3C-0000-4000-8000-000000000002}',
  author: 'Ada',
  dT: '2026-10-01T08:00:00.00',
  done: false,
  text: 'Check the total',
  replies: [
    {
      id: '{A1B2C3D4-0000-4000-8000-000000000003}',
      personId: '{9E5A0F3C-0000-4000-8000-000000000002}',
      author: 'Ada',
      dT: '2026-10-01T08:05:00.00',
      text: 'Done',
    },
  ],
}

/** the original file: one thread with a reply at C3 and one legacy note at A1, on sheet "Data" */
async function original(): Promise<Buffer> {
  // the gateway's thread shape: the root text travels in the note's text
  const { text: _text, ...thread } = THREAD
  const saved = await applyCellEditsToXlsx(
    await buildEditFixture(),
    [],
    [],
    [],
    undefined,
    [],
    [],
    [],
    [],
    [],
    null,
    [],
    [
      {
        sheetName: 'Data',
        notes: [
          { row: 0, column: 0, author: 'Ann', text: 'plain legacy note' },
          { row: 2, column: 2, author: THREAD.author, text: THREAD.text, thread },
        ],
      },
    ],
  )
  return saved.buffer
}

/** the three comment parts of a package, by path */
async function commentParts(buffer: Buffer): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(buffer)
  const parts = new Map<string, Buffer>()
  for (const path of Object.keys(zip.files)) {
    if (/^xl\/(threadedComments\/|persons\/|comments\d*\.xml$)/.test(path)) {
      parts.set(path, await zip.file(path)!.async('nodebuffer'))
    }
  }
  return parts
}

describe.skipIf(!HAS_SIDECAR)(
  'server comments leave the file comment parts byte-identical (D3)',
  () => {
    let directory: string
    let client: XlsxSidecarClient

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'server-comments-save-bytes-'))
      client = new XlsxSidecarClient(SIDECAR)
    })

    afterAll(async () => {
      client.stop()
      await rm(directory, { recursive: true, force: true })
    })

    it('threadedComments, persons and the legacy comments part survive a server comment + row insert + Save', async () => {
      const sourcePath = join(directory, 'source.xlsx')
      const targetPath = join(directory, 'saved.xlsx')
      const source = await original()
      await writeFile(sourcePath, source)
      const before = await commentParts(source)
      expect([...before.keys()].some((p) => p.startsWith('xl/threadedComments/'))).toBe(true)
      expect([...before.keys()].some((p) => p.startsWith('xl/persons/'))).toBe(true)
      expect([...before.keys()].some((p) => /^xl\/comments\d*\.xml$/.test(p))).toBe(true)

      // open through the sidecar and hand the sheets over the way the preload does
      const opened = (await client.open(sourcePath)) as {
        sessionId: string
        sheets: Array<{ id: string; name: string; comments: unknown[] }>
      }
      const sheets = opened.sheets.map((s) => ({
        ...s,
        comments: s.comments.map(parseWorksheetComment),
      }))
      const file = { sheets } as unknown as WorkbookFile
      threadStore.load(file)
      const data = sheets.find((s) => s.name === 'Data')!
      expect(threadStore.get(data.id, 2, 2)?.id).toBe(THREAD.id)

      // a server comment on B7, then a row inserted below every comment
      const server = new ServerAnchorStore()
      const live = sheets.map((s) => ({ id: s.id, name: s.name, stableId: s.id }))
      server.track(
        [{ id: 'srv1', anchor: { format: 'xlsx', v: 1, sheet: data.id, range: 'B7' } }],
        live,
      )
      const insert = { kind: 'insert-rows', index: 20, count: 1 } as const
      const journal = createEditJournal()
      recordStructuralOp(journal, data.id, insert, data.name)
      threadStore.applyStructuralOp(data.id, insert)
      server.applyStructuralOp(data.id, insert)
      expect(server.locationOf('srv1')).not.toBeNull()

      // the Save's note snapshot: server comments mark nothing dirty
      const runtime = {
        univerAPI: {
          getActiveWorkbook: () => ({
            getSheetBySheetId: () => ({
              getNotes: () => [{ row: 0, col: 0, note: 'Ann:\nplain legacy note' }],
            }),
          }),
        },
      } as unknown as UniverRuntime
      const state = { editJournal: journal, file } as unknown as LazyWorkbookState
      const noteStates = collectNoteStates(runtime, state)
      const nameOf = (id: string) => sheets.find((s) => s.id === id)!.name

      await saveWorkbookViaSidecar({
        client,
        sourcePath,
        targetPath,
        edits: [],
        structuralOps: toSaveStructuralOps(journal).map(({ sheetId, ...op }) => ({
          sheetName: nameOf(sheetId),
          ops: [op as typeof insert],
        })),
        noteStates: noteStates.map(({ sheetId, notes }) => ({ sheetName: nameOf(sheetId), notes })),
      })
      await client.close(opened.sessionId)

      const after = await commentParts(await readFile(targetPath))
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
      for (const [path, bytes] of before) {
        expect(Buffer.compare(after.get(path)!, bytes), path).toBe(0)
      }
    })
  },
)
