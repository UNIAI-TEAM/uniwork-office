import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confirmUniworkClose,
  isUniworkCloseGuarded,
  setUniworkCloseGuard,
} from '../src/main/uniwork-docs/close-guard'

/**
 * Quitting with a UniWork document whose local changes are not in UniWork
 * (A1.4): the shell window's close guard asks once per such tab, after the
 * module prompts, and a refusal keeps the window open. The six app-mains that
 * own the module prompts are faked (all clean).
 */

vi.mock('../../docs/src/main/docs-main', () => ({
  docsQueryDirty: async () => false,
  requestDocsClose: async () => true,
}))
vi.mock('../../sheets/src/main/sheets-main', () => ({
  requestSheetsClose: async () => true,
  resetSheetsShuttingDown: () => undefined,
}))
vi.mock('../../slides/src/main/slides-main', () => ({ requestSlidesClose: async () => true }))
vi.mock('../../pdf/src/main/pdf-main', () => ({ requestPdfClose: async () => true }))
vi.mock('../../markdown/src/main/markdown-main', () => ({
  requestMarkdownClose: async () => true,
}))
vi.mock('../../html/src/main/html-main', () => ({ requestHtmlClose: async () => true }))

class FakeWindow {
  destroyed = false
  handlers = new Map<string, (...args: never[]) => void>()
  on = (event: string, fn: (...args: never[]) => void): void => {
    this.handlers.set(event, fn)
  }
  isDestroyed = (): boolean => this.destroyed
  close = (): void => {
    this.requestClose()
  }
  requestClose = (): boolean => {
    let prevented = false
    this.handlers.get('close')?.({ preventDefault: () => (prevented = true) } as never)
    if (!prevented) this.destroyed = true
    return prevented
  }
}

function fakeManager(guarded: Array<{ id: string; path: string }>) {
  return {
    activateTab: vi.fn(),
    dirtySheetsTabs: () => [],
    dirtyPdfTabs: () => [],
    dirtyMarkdownTabs: () => [],
    dirtyHtmlTabs: () => [],
    dirtySlidesTabs: () => [],
    docsTabs: () => [],
    uniworkGuardedTabs: () => guarded,
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

afterEach(() => setUniworkCloseGuard(null))

describe('UniWork close guard seam', () => {
  it('unbound paths and no guard close as before', async () => {
    expect(await confirmUniworkClose('/x/plain.docx')).toBe(true)
    const confirmClose = vi.fn(async () => false)
    setUniworkCloseGuard({ isCloseGuarded: (p) => p.startsWith('/uw/'), confirmClose })
    expect(isUniworkCloseGuarded('/x/plain.docx')).toBe(false)
    expect(await confirmUniworkClose('/x/plain.docx')).toBe(true)
    expect(await confirmUniworkClose(undefined)).toBe(true)
    expect(confirmClose).not.toHaveBeenCalled()
    expect(await confirmUniworkClose('/uw/a.docx')).toBe(false)
  })

  it('quit: a refused UniWork prompt keeps the window open and shows that tab', async () => {
    const { installShellCloseGuard } = await import('../src/main/window-close-guard')
    const confirmClose = vi.fn(async (path: string) => path !== '/uw/b.docx')
    setUniworkCloseGuard({ isCloseGuarded: () => true, confirmClose })
    const win = new FakeWindow()
    const manager = fakeManager([
      { id: 't1', path: '/uw/a.docx' },
      { id: 't2', path: '/uw/b.docx' },
    ])
    installShellCloseGuard(win as never, manager as never)
    expect(win.requestClose()).toBe(true)
    await flush()
    expect(confirmClose.mock.calls.map(([p]) => p)).toEqual(['/uw/a.docx', '/uw/b.docx'])
    expect(win.destroyed).toBe(false)
    expect(manager.activateTab).toHaveBeenCalledWith('t2')
  })

  it('quit: every UniWork prompt accepted closes the window', async () => {
    const { installShellCloseGuard } = await import('../src/main/window-close-guard')
    setUniworkCloseGuard({ isCloseGuarded: () => true, confirmClose: async () => true })
    const win = new FakeWindow()
    installShellCloseGuard(win as never, fakeManager([{ id: 't1', path: '/uw/a.docx' }]) as never)
    win.requestClose()
    await flush()
    expect(win.destroyed).toBe(true)
  })
})
