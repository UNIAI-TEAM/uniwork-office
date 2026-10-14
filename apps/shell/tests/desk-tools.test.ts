import { describe, expect, it, vi } from 'vitest'
import { checkDeskInputs, runDeskTool, type DeskToolDeps } from '../src/main/desk-tools'

function deps(over: Partial<DeskToolDeps> = {}) {
  const files = new Map<string, Uint8Array>([
    ['/w/a.pdf', new Uint8Array([1])],
    ['/w/b.pdf', new Uint8Array([2])],
    ['/w/report.docx', new Uint8Array([3])],
  ])
  const dirs = new Set<string>()
  let busy = false
  const d: DeskToolDeps = {
    busy: () => busy,
    setBusy: (on) => {
      busy = on
    },
    progress: vi.fn<DeskToolDeps['progress']>(),
    pickFiles: vi.fn<DeskToolDeps['pickFiles']>(async () => []),
    pickSavePath: vi.fn<DeskToolDeps['pickSavePath']>(async (p) => p),
    pickFolder: vi.fn<DeskToolDeps['pickFolder']>(async () => '/out'),
    convertPdf: vi.fn<DeskToolDeps['convertPdf']>(async (kind, p) =>
      p.replace(/\.pdf$/, `.${kind}`),
    ),
    exportPdf: vi.fn<DeskToolDeps['exportPdf']>(async (_input, out) => {
      files.set(out, new Uint8Array([9]))
    }),
    mergePdf: vi.fn<DeskToolDeps['mergePdf']>(async (first, others) => ({
      merged: new Uint8Array([...first, ...others.flatMap((o) => [...o])]),
    })),
    splitPdf: vi.fn<DeskToolDeps['splitPdf']>(async () => [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]),
    isOpenInTab: () => false,
    isFile: (p) => files.has(p),
    exists: (p) => files.has(p) || dirs.has(p),
    readFile: async (p) => files.get(p)!,
    writeFile: vi.fn<DeskToolDeps['writeFile']>(async (p, b) => {
      files.set(p, b)
    }),
    mkdir: vi.fn<DeskToolDeps['mkdir']>(async (p) => {
      dirs.add(p)
    }),
    recordRecent: vi.fn<DeskToolDeps['recordRecent']>(),
    ...over,
  }
  return { d, files, dirs }
}

describe('desk tools: input checks', () => {
  it('refuses bad requests at the boundary', async () => {
    const { d } = deps()
    const bad = { ok: false, error: 'bad-input' }
    expect(await runDeskTool({ tool: 'format-disk' }, d)).toEqual(bad)
    expect(await runDeskTool({ tool: 'split-pdf', splitEvery: 0 }, d)).toEqual(bad)
    expect(await runDeskTool({ tool: 'split-pdf', splitEvery: 1000 }, d)).toEqual(bad)
    expect(await runDeskTool({ tool: 'split-pdf', splitEvery: 1.5 }, d)).toEqual(bad)
    expect(await runDeskTool({ tool: 'merge-pdf', inputs: '/w/a.pdf' }, d)).toEqual(bad)
    expect(checkDeskInputs('pdf-to-docx', ['w/a.pdf'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('pdf-to-docx', ['/w/report.docx'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('pdf-to-docx', ['/w/a.pdf', '/w/b.pdf'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('merge-pdf', ['/w/a.pdf'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('export-pdf', ['/w/a.pdf'], d.isFile)).toEqual(bad)
    expect(checkDeskInputs('pdf-to-docx', ['/w/gone.pdf'], d.isFile)).toEqual({
      ok: false,
      error: 'not-found',
    })
    expect(checkDeskInputs('export-pdf', ['/w/report.docx'], d.isFile)).toBeNull()
  })

  it('answers busy while another run is going, before any dialog', async () => {
    const { d } = deps({ busy: () => true })
    expect(await runDeskTool({ tool: 'merge-pdf' }, d)).toEqual({ ok: false, error: 'busy' })
    expect(d.pickFiles).not.toHaveBeenCalled()
  })

  it('holds the lock from the picker on, so a second run is busy', async () => {
    let answer: (paths: string[]) => void = () => {}
    const { d } = deps({
      pickFiles: () => new Promise<string[]>((r) => (answer = r)),
    })
    const a = runDeskTool({ tool: 'merge-pdf' }, d)
    expect(await runDeskTool({ tool: 'split-pdf', inputs: ['/w/a.pdf'] }, d)).toEqual({
      ok: false,
      error: 'busy',
    })
    answer(['/w/a.pdf', '/w/b.pdf'])
    expect(await a).toEqual({ ok: true, outputs: ['/w/a-merged.pdf'] })
    expect(d.busy()).toBe(false)
  })

  it('a rejected picker comes back as failed and frees the tool', async () => {
    const { d } = deps({
      pickFiles: async () => {
        throw new Error('dialog gone')
      },
    })
    expect(await runDeskTool({ tool: 'merge-pdf' }, d)).toEqual({ ok: false, error: 'failed' })
    expect(d.busy()).toBe(false)
  })

  it('asks for files when none were dropped; a cancelled picker is quiet', async () => {
    const { d } = deps()
    expect(await runDeskTool({ tool: 'merge-pdf' }, d)).toEqual({ ok: false, canceled: true })
    expect(d.pickFiles).toHaveBeenCalledWith({ exportable: false, multi: true })
  })
})

describe('desk tools: runs', () => {
  it('PDF to Office goes through the shared flow and records the output', async () => {
    const { d } = deps()
    expect(await runDeskTool({ tool: 'pdf-to-docx', inputs: ['/w/a.pdf'] }, d)).toEqual({
      ok: true,
      outputs: ['/w/a.docx'],
    })
    expect(d.convertPdf).toHaveBeenCalledWith('docx', '/w/a.pdf')
    expect(d.recordRecent).toHaveBeenCalledWith('/w/a.docx')

    const cancelled = deps({ convertPdf: async () => null })
    expect(await runDeskTool({ tool: 'pdf-to-xlsx', inputs: ['/w/a.pdf'] }, cancelled.d)).toEqual({
      ok: false,
      canceled: true,
    })
    expect(cancelled.d.recordRecent).not.toHaveBeenCalled()
  })

  it('merges in the given order into the picked file and frees the tool', async () => {
    const { d, files } = deps()
    const result = await runDeskTool({ tool: 'merge-pdf', inputs: ['/w/b.pdf', '/w/a.pdf'] }, d)
    expect(d.pickSavePath).toHaveBeenCalledWith('/w/b-merged.pdf')
    expect(result).toEqual({ ok: true, outputs: ['/w/b-merged.pdf'] })
    expect([...files.get('/w/b-merged.pdf')!]).toEqual([2, 1])
    expect(d.busy()).toBe(false)
  })

  it('refuses to write over an input or over a PDF open in a tab', async () => {
    const same = deps({ pickSavePath: async () => '/w/a.pdf' })
    expect(
      await runDeskTool({ tool: 'merge-pdf', inputs: ['/w/a.pdf', '/w/b.pdf'] }, same.d),
    ).toEqual({ ok: false, error: 'same-path' })
    // APFS / NTFS are case-insensitive by default: A.pdf would replace a.pdf
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const cased = deps({ pickSavePath: async () => '/w/A.pdf' })
      expect(
        await runDeskTool({ tool: 'merge-pdf', inputs: ['/w/a.pdf', '/w/b.pdf'] }, cased.d),
      ).toEqual({ ok: false, error: 'same-path' })
    }
    const open = deps({ isOpenInTab: () => true })
    expect(await runDeskTool({ tool: 'export-pdf', inputs: ['/w/report.docx'] }, open.d)).toEqual({
      ok: false,
      error: 'target-open',
    })
    expect(open.d.exportPdf).not.toHaveBeenCalled()
    expect(open.d.progress).not.toHaveBeenCalledWith(true)
  })

  it('splits into a fresh folder and never overwrites earlier parts', async () => {
    const { d, dirs } = deps()
    dirs.add('/out/a-parts')
    const result = await runDeskTool({ tool: 'split-pdf', inputs: ['/w/a.pdf'], splitEvery: 3 }, d)
    expect(d.splitPdf).toHaveBeenCalledWith(new Uint8Array([1]), 3)
    expect(d.mkdir).toHaveBeenCalledWith('/out/a-parts 2')
    expect(result).toEqual({
      ok: true,
      outputs: ['/out/a-parts 2/a-1.pdf', '/out/a-parts 2/a-2.pdf'],
    })
  })

  it('an export failure comes back as failed and frees the tool', async () => {
    const { d } = deps({
      exportPdf: async () => {
        throw new Error('renderer gone')
      },
    })
    expect(await runDeskTool({ tool: 'export-pdf', inputs: ['/w/report.docx'] }, d)).toEqual({
      ok: false,
      error: 'failed',
    })
    expect(d.busy()).toBe(false)
  })
})
