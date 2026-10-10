import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createModuleSaveRequester } from '../src/main/uniwork-docs/module-save'
import type { TabKind } from '../src/shared/tabs-api'

function setup(kind: TabKind | null, destroyed = false) {
  const wc = { isDestroyed: () => destroyed, send: vi.fn() } as unknown as WebContents
  const deps = {
    targetForPath: vi.fn(() => (kind ? { kind, webContents: wc } : undefined)),
    sheetsMenuChannel: 'menu:action',
    requestMarkdownSave: vi.fn().mockResolvedValue(true),
    requestHtmlSave: vi.fn().mockResolvedValue(true),
    flushPdfSave: vi.fn().mockResolvedValue(true),
  }
  return { wc, deps, save: createModuleSaveRequester(deps) }
}

describe('UniWork chip Retry / conflict overwrite run the owning module Save', () => {
  it('docx: menu:command save', () => {
    const { wc, deps, save } = setup('docs')
    expect(save('/w/a.docx')).toBe(true)
    expect(wc.send).toHaveBeenCalledWith('menu:command', 'save')
    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(deps.requestMarkdownSave).not.toHaveBeenCalled()
  })

  it('xlsx: the sheets menu action channel, not menu:command', () => {
    const { wc, save } = setup('sheets')
    expect(save('/w/a.xlsx')).toBe(true)
    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send).toHaveBeenCalledWith('menu:action', 'save')
  })

  it('pptx: slides:menu save', () => {
    const { wc, save } = setup('slides')
    expect(save('/w/a.pptx')).toBe(true)
    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send).toHaveBeenCalledWith('slides:menu', 'save')
  })

  it('md: requestMarkdownSave(wc, save), nothing sent', () => {
    const { wc, deps, save } = setup('markdown')
    expect(save('/w/a.md')).toBe(true)
    expect(deps.requestMarkdownSave).toHaveBeenCalledWith(wc, 'save')
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('html: requestHtmlSave(wc, save), nothing sent', () => {
    const { wc, deps, save } = setup('html')
    expect(save('/w/a.html')).toBe(true)
    expect(deps.requestHtmlSave).toHaveBeenCalledWith(wc, 'save')
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('pdf: flushPdfSave(wc) with no options, i.e. an explicit user Save', () => {
    const { wc, deps, save } = setup('pdf')
    expect(save('/w/a.pdf')).toBe(true)
    expect(deps.flushPdfSave).toHaveBeenCalledTimes(1)
    expect(deps.flushPdfSave.mock.calls[0]).toEqual([wc])
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('returns false when nothing shows the path, so the service falls back', () => {
    const { wc, deps, save } = setup(null)
    expect(save('/w/gone.docx')).toBe(false)
    expect(wc.send).not.toHaveBeenCalled()
    expect(deps.flushPdfSave).not.toHaveBeenCalled()
  })

  it('returns false for a destroyed view without touching any module', () => {
    for (const kind of ['docs', 'sheets', 'slides', 'markdown', 'html', 'pdf'] as TabKind[]) {
      const { wc, deps, save } = setup(kind, true)
      expect(save('/w/x')).toBe(false)
      expect(wc.send).not.toHaveBeenCalled()
      expect(deps.requestMarkdownSave).not.toHaveBeenCalled()
      expect(deps.requestHtmlSave).not.toHaveBeenCalled()
      expect(deps.flushPdfSave).not.toHaveBeenCalled()
    }
  })

  it('returns false for a home tab', () => {
    const { save } = setup('home')
    expect(save('/w/a.docx')).toBe(false)
  })

  it('a rejected module save does not escape as an unhandled rejection', async () => {
    const { deps, save } = setup('markdown')
    deps.requestMarkdownSave.mockRejectedValue(new Error('boom'))
    expect(save('/w/a.md')).toBe(true)
    await Promise.resolve()
  })

  it('md/html/pdf tell the caller when the module did not write; docs/sheets/slides cannot (R2-4)', async () => {
    for (const [kind, mock] of [
      ['markdown', 'requestMarkdownSave'],
      ['html', 'requestHtmlSave'],
      ['pdf', 'flushPdfSave'],
    ] as const) {
      const { deps, save } = setup(kind)
      const notWritten = vi.fn()
      deps[mock].mockResolvedValue(false)
      expect(save('/w/x', notWritten)).toBe(true)
      await new Promise((r) => setTimeout(r, 0))
      expect(notWritten).toHaveBeenCalledTimes(1)

      const wrote = vi.fn()
      deps[mock].mockResolvedValue(true)
      save('/w/x', wrote)
      await new Promise((r) => setTimeout(r, 0))
      expect(wrote).not.toHaveBeenCalled()

      const rejected = vi.fn()
      deps[mock].mockRejectedValue(new Error('boom'))
      save('/w/x', rejected)
      await new Promise((r) => setTimeout(r, 0))
      expect(rejected).toHaveBeenCalledTimes(1)
    }
    for (const kind of ['docs', 'sheets', 'slides'] as TabKind[]) {
      const { save } = setup(kind)
      const notWritten = vi.fn()
      expect(save('/w/x', notWritten)).toBe(true)
      await new Promise((r) => setTimeout(r, 0))
      expect(notWritten).not.toHaveBeenCalled()
    }
  })

  it('is wired into the shell for every service Save path', () => {
    const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(source).toMatch(/requestModuleSave: requestUniworkModuleSave,/)
    expect(source).not.toMatch(/target\.webContents\.send\('menu:command', 'save'\)/)
    expect(source).toMatch(/sheetsMenuChannel: SHEETS_IPC_CHANNELS\.menuAction/)
  })
})
