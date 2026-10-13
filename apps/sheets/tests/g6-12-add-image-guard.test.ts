import { describe, expect, it, vi } from 'vitest'

import {
  executeWorkbookTool,
  type ActiveSheetInfo,
  type SheetsSkillDeps,
} from '../src/renderer/ai/tools'
import type { AttachmentMeta } from '../src/shared/desktop-api'

// §9 #16 / C-BOUND: for a UniWork-bound workbook, propose_operations add_image
// must not read an arbitrary local path the model names; only attachments the
// user gave and remote/generated image URLs pass. Local workbooks keep today's
// behaviour.

const info: ActiveSheetInfo = {
  mode: 'demo',
  sheetId: 'sheet-1',
  sheetName: 'Sheet1',
  revision: 0,
  knownAddresses: ['A1'],
  sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
}

const attachment: AttachmentMeta = {
  path: '/home/u/Pictures/logo.png',
  name: 'logo.png',
  ext: 'png',
  sizeBytes: 1024,
}

function deps(bound: boolean, attachments: readonly AttachmentMeta[] = []) {
  const proposeOperations = vi.fn<SheetsSkillDeps['proposeOperations']>(() => ({
    ok: false,
    error: 'reached proposeOperations',
  }))
  const value: SheetsSkillDeps = {
    getActiveSheetInfo: () => info,
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Sheet1' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations,
    isUniworkBound: () => bound,
    getAttachments: () => attachments,
  }
  return { value, proposeOperations }
}

async function addImage(path: string, d: SheetsSkillDeps) {
  return executeWorkbookTool(
    {
      id: 'call-1',
      name: 'propose_operations',
      input: {
        summary: 'insert logo',
        operations: [{ op: 'add_image', sheetId: 'sheet-1', path, anchorCell: 'B2' }],
      },
    },
    d,
  )
}

describe('g6-12 add_image local path guard (UniWork-bound workbook)', () => {
  it.each(['/etc/passwd', '~/.ssh/id_rsa', 'C:\\Users\\u\\secret.png', 'relative/x.png'])(
    'refuses the local path %s before anything is applied',
    async (path) => {
      const { value, proposeOperations } = deps(true)
      const result = await addImage(path, value)
      expect(result.isError).toBe(true)
      expect(result.output).toMatch(/UniWork/)
      expect(result.output).toMatch(/attach/i)
      expect(proposeOperations).not.toHaveBeenCalled()
    },
  )

  it('refuses a local path inside a mixed batch (all-or-nothing)', async () => {
    const { value, proposeOperations } = deps(true)
    const result = await executeWorkbookTool(
      {
        id: 'call-1',
        name: 'propose_operations',
        input: {
          summary: 'two images',
          operations: [
            {
              op: 'add_image',
              sheetId: 'sheet-1',
              path: 'https://example.com/a.png',
              anchorCell: 'B2',
            },
            { op: 'add_image', sheetId: 'sheet-1', path: '/tmp/b.png', anchorCell: 'D2' },
          ],
        },
      },
      value,
    )
    expect(result.isError).toBe(true)
    expect(proposeOperations).not.toHaveBeenCalled()
  })

  it('lets an image the user attached through', async () => {
    const { value, proposeOperations } = deps(true, [attachment])
    await addImage(attachment.path, value)
    expect(proposeOperations).toHaveBeenCalledTimes(1)
  })

  it.each([
    'https://images.example.com/a.png',
    'http://images.example.com/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
  ])('lets the URL %s through to the guarded fetch', async (path) => {
    const { value, proposeOperations } = deps(true)
    await addImage(path, value)
    expect(proposeOperations).toHaveBeenCalledTimes(1)
  })

  it('keeps local paths for a local (not bound) workbook', async () => {
    const { value, proposeOperations } = deps(false)
    await addImage('/home/u/Pictures/chart.png', value)
    expect(proposeOperations).toHaveBeenCalledTimes(1)
  })
})
