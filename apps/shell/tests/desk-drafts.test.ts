import { describe, expect, it } from 'vitest'
import type { OpenDocumentTab } from '../src/shared/tabs-api'
import { listDeskDrafts, type RecoveryProbe } from '../src/main/desk-drafts'

const tab = (over: Partial<OpenDocumentTab> = {}): OpenDocumentTab => ({
  id: 't1',
  kind: 'docs',
  title: 'Report',
  filePath: '/w/report.docx',
  active: false,
  dirty: false,
  ...over,
})
const untitled = (over: Partial<OpenDocumentTab>): OpenDocumentTab => {
  const t = tab(over)
  delete t.filePath
  return t
}
const probes = (copies: Record<string, number>): RecoveryProbe[] => [
  { app: 'docs', ext: /\.docx$/i, mtime: (p) => copies[p] ?? null },
  { app: 'slides', ext: /\.pptx$/i, mtime: (p) => copies[p] ?? null },
]

describe('listDeskDrafts', () => {
  it('lists dirty tabs (main and detached, untitled too) before recovery copies', async () => {
    const drafts = await listDeskDrafts({
      openTabs: async () => [
        tab({ dirty: true }),
        tab({ id: 't2', title: 'Clean', filePath: '/w/clean.docx' }),
        untitled({ id: 'detached:9', kind: 'sheets', title: 'Untitled', dirty: true }),
      ],
      recents: () => ['/w/old.docx'],
      probes: probes({ '/w/old.docx': 500 }),
    })
    expect(drafts).toEqual([
      { kind: 'unsaved', title: 'Report', app: 'docs', tabId: 't1', filePath: '/w/report.docx' },
      { kind: 'unsaved', title: 'Untitled', app: 'sheets', tabId: 'detached:9' },
      {
        kind: 'recovery',
        title: 'old.docx',
        app: 'docs',
        filePath: '/w/old.docx',
        modifiedMs: 500,
      },
    ])
  })

  it('skips a recent file that is open, has no probe, or has no newer copy', async () => {
    const drafts = await listDeskDrafts({
      openTabs: async () => [tab({ filePath: '/w/open.docx' })],
      recents: () => ['/w/open.docx', '/w/notes.md', '/w/clean.pptx'],
      probes: probes({ '/w/open.docx': 900 }),
    })
    expect(drafts).toEqual([])
  })
})
