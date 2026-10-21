import { describe, expect, it } from 'vitest'
import { planZipDownload, ZIP_MAX_FILES } from '../src/renderer/src/uniwork-zip-download/zip-plan'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'

const doc = (id: string, partial: Partial<DocumentsHomeDoc> = {}): DocumentsHomeDoc => ({
  id,
  workspaceId: 'ws-1',
  title: `${id}.docx`,
  format: 'docx',
  updatedAt: '2026-10-21T02:00:00.000Z',
  kind: 'file',
  parentId: null,
  canEdit: true,
  canManage: true,
  ...partial,
})
const files = (n: number) => Array.from({ length: n }, (_, i) => doc(`f${i + 1}`))

describe('planZipDownload (UNI-2068 ZB)', () => {
  it('exactly one downloadable file is a plain download, no zip', () => {
    const plan = planZipDownload({ docs: [doc('a')], workspaceId: 'ws-1', screen: 'workspace' })
    expect(plan.mode).toBe('file')
    if (plan.mode !== 'file') return
    expect(plan.doc.id).toBe('a')
    expect(plan.skipped).toEqual([])
  })

  it('two or more files go into one zip, in the selection order', () => {
    const plan = planZipDownload({ docs: files(3), workspaceId: 'ws-1', screen: 'workspace' })
    expect(plan.mode).toBe('zip')
    if (plan.mode !== 'zip') return
    expect(plan.docs.map((d) => d.id)).toEqual(['f1', 'f2', 'f3'])
    expect(plan.skipped).toEqual([])
  })

  it('pages and folders are skipped as not_a_file with their titles; the files still go', () => {
    const plan = planZipDownload({
      docs: [
        doc('a'),
        doc('p', { kind: 'page', title: 'Notes' }),
        doc('b'),
        doc('d', { kind: 'folder', title: 'Folder' }),
      ],
      workspaceId: 'ws-1',
      screen: 'workspace',
    })
    expect(plan.mode).toBe('zip')
    expect(plan.skipped).toEqual([
      { documentId: 'p', title: 'Notes', reason: 'not_a_file' },
      { documentId: 'd', title: 'Folder', reason: 'not_a_file' },
    ])
  })

  it('one file next to a folder is still the plain download, the folder is listed', () => {
    const plan = planZipDownload({
      docs: [doc('a'), doc('d', { kind: 'folder' })],
      workspaceId: 'ws-1',
      screen: 'workspace',
    })
    expect(plan.mode).toBe('file')
    expect(plan.skipped).toEqual([{ documentId: 'd', title: 'd.docx', reason: 'not_a_file' }])
  })

  it('a folder-only selection has nothing to download', () => {
    const plan = planZipDownload({
      docs: [doc('d', { kind: 'folder' })],
      workspaceId: 'ws-1',
      screen: 'workspace',
    })
    expect(plan.mode).toBe('none')
    expect(plan.skipped).toHaveLength(1)
  })

  it('rows of another workspace are never sent: other_workspace', () => {
    const plan = planZipDownload({
      docs: [doc('a'), doc('b'), doc('x', { workspaceId: 'ws-2' })],
      workspaceId: 'ws-1',
      screen: 'shared',
    })
    expect(plan.mode).toBe('zip')
    if (plan.mode !== 'zip') return
    expect(plan.docs.map((d) => d.id)).toEqual(['a', 'b'])
    expect(plan.skipped).toEqual([{ documentId: 'x', title: 'x.docx', reason: 'other_workspace' }])
  })

  it('a row without a workspace id belongs to the current workspace', () => {
    const plan = planZipDownload({
      docs: [doc('a', { workspaceId: '' }), doc('b')],
      workspaceId: 'ws-1',
      screen: 'workspace',
    })
    expect(plan.mode).toBe('zip')
  })

  it('more than 100 files: the first 100 go, the rest are zip_limit', () => {
    expect(ZIP_MAX_FILES).toBe(100)
    const plan = planZipDownload({ docs: files(103), workspaceId: 'ws-1', screen: 'workspace' })
    expect(plan.mode).toBe('zip')
    if (plan.mode !== 'zip') return
    expect(plan.docs).toHaveLength(100)
    expect(plan.docs[99]!.id).toBe('f100')
    expect(plan.skipped.map((s) => [s.documentId, s.reason])).toEqual([
      ['f101', 'zip_limit'],
      ['f102', 'zip_limit'],
      ['f103', 'zip_limit'],
    ])
  })

  it('exactly 100 files send all of them', () => {
    const plan = planZipDownload({ docs: files(100), workspaceId: 'ws-1', screen: 'workspace' })
    expect(plan.mode === 'zip' && plan.docs.length).toBe(100)
    expect(plan.skipped).toEqual([])
  })

  it('a trashed row and the trash screen offer nothing', () => {
    expect(
      planZipDownload({
        docs: [doc('a', { archived: true })],
        workspaceId: 'ws-1',
        screen: 'workspace',
      }).mode,
    ).toBe('none')
    expect(planZipDownload({ docs: [doc('a')], workspaceId: 'ws-1', screen: 'trash' }).mode).toBe(
      'none',
    )
  })

  it('the shelf (Lưu trữ) downloads like the live list', () => {
    expect(planZipDownload({ docs: files(2), workspaceId: 'ws-1', screen: 'shelved' }).mode).toBe(
      'zip',
    )
  })
})
