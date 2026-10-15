import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * reload-view.ts: the one routing every shell reload takes (tab or detached
 * window), so a document's one-shot open queue is refilled before the renderer
 * remounts. The module mains are mocked; only the call order is asserted.
 */

const calls: string[] = []
const queueDocsForView = vi.fn((...args: unknown[]) => void calls.push(`docs:${String(args[1])}`))
const queueWorkbookForView = vi.fn(
  (...args: unknown[]) => void calls.push(`sheets:${String(args[1])}`),
)
const queueSlidesForView = vi.fn(
  (...args: unknown[]) => void calls.push(`slides:${String(args[1])}`),
)
const clearPdfDirty = vi.fn((...args: unknown[]) => void calls.push(`pdf-clear:${String(args[0])}`))

vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('../../docs/src/main/docs-main', () => ({
  queueDocsForView: (...args: unknown[]) => queueDocsForView(...args),
}))
vi.mock('../../sheets/src/main/sheets-main', () => ({
  queueWorkbookForView: (...args: unknown[]) => queueWorkbookForView(...args),
}))
vi.mock('../../slides/src/main/slides-main', () => ({
  queueSlidesForView: (...args: unknown[]) => queueSlidesForView(...args),
}))
vi.mock('../../pdf/src/main/pdf-main', () => ({
  clearPdfDirty: (...args: unknown[]) => clearPdfDirty(...args),
}))

import { reloadPathTarget, reloadViewFromDisk } from '../src/main/reload-view'
import type { TabKind } from '../src/shared/tabs-api'

function fakeWebContents(id = 7, destroyed = false) {
  return {
    id,
    isDestroyed: () => destroyed,
    reload: vi.fn(() => void calls.push('reload')),
  }
}

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
})

describe('reloadViewFromDisk', () => {
  it.each([
    ['docs', 'docs:/tmp/a.docx'],
    ['sheets', 'sheets:/tmp/a.docx'],
    ['slides', 'slides:/tmp/a.docx'],
  ] as Array<[TabKind, string]>)('queues the %s open before the reload', (kind, queued) => {
    const wc = fakeWebContents()
    reloadViewFromDisk(wc as never, kind, '/tmp/a.docx')
    expect(calls).toEqual([queued, 'reload'])
  })

  it('clears the pdf dirty flag before the reload and queues nothing', () => {
    const wc = fakeWebContents(9)
    reloadViewFromDisk(wc as never, 'pdf', '/tmp/a.pdf')
    expect(calls).toEqual(['pdf-clear:9', 'reload'])
  })

  it('reloads markdown and html views without a queue', () => {
    reloadViewFromDisk(fakeWebContents() as never, 'markdown', '/tmp/a.md')
    reloadViewFromDisk(fakeWebContents() as never, 'html', '/tmp/a.html')
    expect(calls).toEqual(['reload', 'reload'])
  })

  it('queues nothing for an untitled view', () => {
    reloadViewFromDisk(fakeWebContents() as never, 'docs')
    expect(calls).toEqual(['reload'])
  })
})

describe('reloadPathTarget', () => {
  it('routes a tab through the tab manager reload', () => {
    const reloadTab = vi.fn()
    const wc = fakeWebContents()
    reloadPathTarget(
      { tabId: 't1', kind: 'slides', webContents: wc as never },
      '/tmp/d.pptx',
      reloadTab,
    )
    expect(reloadTab).toHaveBeenCalledWith('t1')
    expect(wc.reload).not.toHaveBeenCalled()
  })

  it.each([
    ['docs', 'docs:/tmp/x'],
    ['sheets', 'sheets:/tmp/x'],
    ['slides', 'slides:/tmp/x'],
  ] as Array<[TabKind, string]>)(
    'a detached %s window queues its open before the reload',
    (kind, queued) => {
      const reloadTab = vi.fn()
      const wc = fakeWebContents()
      reloadPathTarget({ kind, webContents: wc as never }, '/tmp/x', reloadTab)
      expect(reloadTab).not.toHaveBeenCalled()
      expect(calls).toEqual([queued, 'reload'])
    },
  )

  it('does nothing for a missing target or a destroyed window', () => {
    const reloadTab = vi.fn()
    reloadPathTarget(undefined, '/tmp/x', reloadTab)
    const wc = fakeWebContents(7, true)
    reloadPathTarget({ kind: 'docs', webContents: wc as never }, '/tmp/x', reloadTab)
    expect(calls).toEqual([])
    expect(reloadTab).not.toHaveBeenCalled()
  })
})
