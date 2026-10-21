import { describe, expect, it } from 'vitest'
import { accessCellName, canShareRow } from '../src/renderer/src/doclist/share-gate'
import { parseDocumentList } from '../src/main/uniwork-docs/parse'

/**
 * UNI-2047 SD-A: the gate of the Share entries (the web's `canShareRow`,
 * row-level.ts:44) on the app's row, and the Access cell's button name.
 */

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  workspaceId: 'ws_1',
  title: 'Plan.docx',
  kind: 'file' as const,
  ...over,
})

describe('canShareRow', () => {
  it('opens for an ordinary file or page, whatever the viewer level', () => {
    expect(canShareRow(row())).toBe(true)
    expect(canShareRow(row({ kind: 'page' }))).toBe(true)
    expect(canShareRow(row({ myLevel: 'view' }))).toBe(true)
    expect(canShareRow(row({ myLevel: 'manage', canManage: true }))).toBe(true)
    expect(canShareRow(row({ adminScope: true }))).toBe(true)
  })

  it('a row with no kind (the library route sends files only) is a file', () => {
    const { kind: _kind, ...bare } = row()
    expect(canShareRow(bare)).toBe(true)
  })

  it('never for a folder', () => {
    expect(canShareRow(row({ kind: 'folder' }))).toBe(false)
  })

  it('never for a document of another module (owner_kind)', () => {
    expect(canShareRow(row({ ownerKind: 'work_product' }))).toBe(false)
  })

  it('never for a trashed row, by flag or by timestamp', () => {
    expect(canShareRow(row({ archived: true }))).toBe(false)
    expect(canShareRow(row({ archivedAt: '2026-10-20T01:00:00Z' }))).toBe(false)
  })

  it('never for My Folder', () => {
    expect(canShareRow(row({ systemKind: 'my_folder', kind: 'folder' }))).toBe(false)
    expect(canShareRow(row({ systemKind: 'my_folder' }))).toBe(false)
  })

  it('never for a row whose organization is known to be empty (an unresolved starred row)', () => {
    expect(canShareRow(row({ organizationId: '' }))).toBe(false)
    expect(canShareRow(row({ organizationId: 'org_1' }))).toBe(true)
  })

  it('a shelved row still opens (the dialog says it is shelved)', () => {
    expect(canShareRow(row({ shelvedAt: '2026-10-19T01:00:00Z' }))).toBe(true)
  })

  it('nothing for no row', () => {
    expect(canShareRow(null)).toBe(false)
    expect(canShareRow(undefined)).toBe(false)
  })
})

describe('accessCellName', () => {
  it('manage for a manager or an administering admin, view for everyone else', () => {
    expect(accessCellName(row({ myLevel: 'manage' }))).toBe('manage')
    expect(accessCellName(row({ adminScope: true }))).toBe('manage')
    expect(accessCellName(row({ myLevel: 'edit' }))).toBe('view')
    expect(accessCellName(row({ myLevel: 'comment' }))).toBe('view')
    expect(accessCellName(row({ myLevel: 'view' }))).toBe('view')
    expect(accessCellName(row())).toBe('view')
    expect(accessCellName(row({ adminScope: false, myLevel: 'edit' }))).toBe('view')
  })
})

describe('owner_kind reaches the row (main parse)', () => {
  it('keeps a work-product owner kind on a list row and leaves it off an ordinary one', () => {
    const page = parseDocumentList(
      {
        documents: [
          {
            id: 'd1',
            kind: 'file',
            workspace_id: 'ws_1',
            title: 'a.docx',
            updated_at: '2026-10-18T08:00:00Z',
            owner_kind: 'work_product',
          },
          {
            id: 'd2',
            kind: 'file',
            workspace_id: 'ws_1',
            title: 'b.docx',
            updated_at: '2026-10-18T08:00:00Z',
          },
        ],
        next_cursor: null,
      },
      'ws_1',
    )
    expect(page.documents[0]).toMatchObject({ ownerKind: 'work_product' })
    expect(page.documents[1]).not.toHaveProperty('ownerKind')
    expect(canShareRow(page.documents[0]!)).toBe(false)
    expect(canShareRow(page.documents[1]!)).toBe(true)
  })
})
