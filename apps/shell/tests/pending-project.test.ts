import { describe, expect, it } from 'vitest'
import {
  PENDING_PROJECT_TTL_MS,
  PendingProjects,
  pendingKindForPath,
} from '../src/main/pending-project'

describe('pendingKindForPath', () => {
  it('maps document extensions to the kind a new file is created as', () => {
    expect(pendingKindForPath('/p/a.docx')).toBe('doc')
    expect(pendingKindForPath('C:\\p\\a.XLSX')).toBe('sheet')
    expect(pendingKindForPath('/p/a.csv')).toBe('sheet')
    expect(pendingKindForPath('/p/a.pptx')).toBe('slide')
    expect(pendingKindForPath('/p/a.markdown')).toBe('markdown')
    expect(pendingKindForPath('/p/a.htm')).toBe('html')
    expect(pendingKindForPath('/p/a.pdf')).toBe('pdf')
    expect(pendingKindForPath('/p/a.txt')).toBeNull()
    expect(pendingKindForPath('/p/noext')).toBeNull()
  })
})

describe('PendingProjects', () => {
  const T0 = 1_000_000

  it('moves the first save of the bound tab into the project, once', () => {
    const pending = new PendingProjects()
    pending.remember('sheet', 'proj-1', T0)
    pending.bind(pending.take('sheet', T0 + 5), 7, T0 + 5)
    expect(pending.takeForTab(7, '/docs/Untitled.xlsx', () => true, T0 + 10)?.projectId).toBe(
      'proj-1',
    )
    expect(pending.takeForTab(7, '/docs/Other.xlsx', () => true, T0 + 20)).toBeNull()
  })

  it('does not hand the project to a workbook opened in another tab meanwhile', () => {
    const pending = new PendingProjects()
    pending.remember('sheet', 'proj-1', T0)
    pending.bind(pending.take('sheet', T0), 7, T0)
    // the user opens an existing xlsx in tab 9 while the new sheet in tab 7 is still unsaved
    expect(pending.takeForTab(9, '/docs/existing.xlsx', () => true, T0 + 1000)).toBeNull()
    expect(pending.takeForTab(7, '/docs/new.xlsx', () => true, T0 + 2000)?.projectId).toBe('proj-1')
  })

  it('keeps the binding when the file is of another kind or not fresh', () => {
    const pending = new PendingProjects()
    pending.remember('doc', 'proj-1', T0)
    pending.bind(pending.take('doc', T0), 3, T0)
    expect(pending.takeForTab(3, '/docs/a.xlsx', () => true, T0 + 1)).toBeNull()
    expect(pending.takeForTab(3, '/docs/old.docx', () => false, T0 + 2)).toBeNull()
    expect(pending.takeForTab(3, '/docs/new.docx', () => true, T0 + 3)?.projectId).toBe('proj-1')
  })

  it('expires: an unbound or unconsumed project cannot capture a later file', () => {
    const pending = new PendingProjects()
    pending.remember('pdf', 'proj-1', T0)
    expect(pending.take('pdf', T0 + PENDING_PROJECT_TTL_MS + 1)).toBeNull()

    pending.remember('doc', 'proj-1', T0)
    pending.bind(pending.take('doc', T0), 4, T0)
    expect(
      pending.takeForTab(4, '/docs/a.docx', () => true, T0 + PENDING_PROJECT_TTL_MS + 1),
    ).toBeNull()
  })

  it('counts the TTL of a tab-bound project from the bind, not from the click', () => {
    // the tab was bound late (slow start): the user still has a full window to save the new file
    const bindAt = T0 + PENDING_PROJECT_TTL_MS - 1000
    const inTime = new PendingProjects()
    inTime.remember('doc', 'proj-1', T0)
    inTime.bind(inTime.take('doc', T0 + 1), 4, bindAt)
    expect(
      inTime.takeForTab(4, '/docs/a.docx', () => true, bindAt + PENDING_PROJECT_TTL_MS - 1),
    ).toMatchObject({ projectId: 'proj-1', setAt: T0 })

    const late = new PendingProjects()
    late.remember('doc', 'proj-1', T0)
    late.bind(late.take('doc', T0 + 1), 4, bindAt)
    expect(
      late.takeForTab(4, '/docs/a.docx', () => true, bindAt + PENDING_PROJECT_TTL_MS + 1),
    ).toBeNull()
  })

  it('keeps a new sheet in its project when the fallback binds it after a later click', () => {
    // newSheetTab takes the project up front; when the temp workbook cannot be created it writes
    // the file into the default folder and binds the tab afterwards (no AI preset)
    const pending = new PendingProjects()
    pending.remember('sheet', 'proj-1', T0)
    const firstClick = pending.take('sheet', T0)
    // a second "new sheet" click from another project arrives while the first one still awaits
    pending.remember('sheet', 'proj-2', T0 + 500)
    const secondClick = pending.take('sheet', T0 + 500)
    pending.bind(firstClick, 11, T0 + 800)
    pending.bind(secondClick, 12, T0 + 900)
    const accept = () => true
    expect(pending.takeForTab(11, 'C:\\Docs\\Untitled.xlsx', accept, T0 + 1000)?.projectId).toBe(
      'proj-1',
    )
    expect(pending.takeForTab(12, 'C:\\Docs\\Untitled 2.xlsx', accept, T0 + 1100)?.projectId).toBe(
      'proj-2',
    )
  })

  it('a click without a project clears an earlier one; the default project is never pending', () => {
    const pending = new PendingProjects()
    pending.remember('slide', 'proj-1', T0)
    pending.remember('slide', undefined, T0 + 1)
    expect(pending.take('slide', T0 + 2)).toBeNull()
    pending.remember('slide', 'default', T0 + 3)
    expect(pending.take('slide', T0 + 4)).toBeNull()
  })

  it('take consumes the per-kind entry (direct-file kinds like pdf)', () => {
    const pending = new PendingProjects()
    pending.remember('pdf', 'proj-1', T0)
    expect(pending.take('pdf', T0 + 1)?.projectId).toBe('proj-1')
    expect(pending.take('pdf', T0 + 2)).toBeNull()
  })

  it('forgetTab drops the binding', () => {
    const pending = new PendingProjects()
    pending.remember('html', 'proj-1', T0)
    pending.bind(pending.take('html', T0), 5, T0)
    pending.forgetTab(5)
    expect(pending.takeForTab(5, '/docs/a.html', () => true, T0 + 1)).toBeNull()
  })
})
