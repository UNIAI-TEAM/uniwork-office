// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { OpenFileResult } from '../../../apps/docs/src/shared/ipc'

type WebApi = typeof import('./webapi').default
type Hook = import('./webapi').DocsWebHook

const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
let api: WebApi
let hook: Hook

beforeAll(async () => {
  // ?open= is read at module load
  window.history.replaceState(null, '', '/?open=/fixtures/simple.docx')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/fixtures/simple.docx')
        ? new Response(DOCX.slice(), { status: 200 })
        : new Response('nope', { status: 404 }),
    ),
  )
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  window.print = vi.fn()
  api = (await import('./webapi')).default
  hook = (window as unknown as { __docsWeb: Hook }).__docsWeb
})

describe('webapi', () => {
  it('serves ?open= through consumePendingOpenDocx once', async () => {
    const first = (await api.consumePendingOpenDocx()) as OpenFileResult
    expect(first.name).toBe('simple.docx')
    expect(first.path).toMatch(/^uniwork:\/\/files\/[^/]+\/simple\.docx$/)
    expect(new Uint8Array(first.data)).toEqual(DOCX)
    expect(await api.consumePendingOpenDocx()).toBeNull()
    expect(await api.getRecentFiles()).toEqual([first.path])
  })

  it('pushes post-boot opens through onOpenDocx', async () => {
    const seen: string[] = []
    const off = api.onOpenDocx((r) => seen.push(r.name))
    await hook.openBytes('a.docx', DOCX)
    off()
    expect(seen).toEqual(['a.docx'])
  })

  it('saves to the backend, downloads, and records lastSaved', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const saved = await api.saveDocxNew('Report', DOCX.slice().buffer)
    expect(saved.ok).toBe(true)
    expect(saved.path).toMatch(/\/Report\.docx$/)
    expect(click).toHaveBeenCalledTimes(1)
    const next = new Uint8Array([9, 9])
    expect((await api.saveDocx(saved.path!, next.buffer, true)).ok).toBe(true)
    expect(click).toHaveBeenCalledTimes(1) // autosave: no download
    expect(hook.lastSaved()).toEqual({ name: 'Report.docx', bytes: next })
    const reopened = (await api.openDocxPath(saved.path!)) as OpenFileResult
    expect(new Uint8Array(reopened.data)).toEqual(next)
    expect((await hook.files()).length).toBe(3)
    click.mockRestore()
  })

  it('defers PDF export to window.print', async () => {
    const part = await api.printPdfBuffer(12240, 15840)
    const r = await api.saveMergedPdf('x.docx', [part.base64!, part.base64!])
    expect(r.ok).toBe(true)
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('projectApi keeps chats per file and rebinds temp chats', async () => {
    const p = api.projectApi
    const temp = await p.resolveChat({ filePath: null, tempChatId: 'unsaved-1' })
    await p.appendChat({ ...temp, role: 'user', text: 'hello\nworld' })
    const bound = await p.rebindChat({
      projectId: temp.projectId,
      tempChatId: 'unsaved-1',
      newFilePath: 'uniwork://files/x/doc.docx',
    })
    expect(await p.resolveChat({ filePath: 'uniwork://files/x/doc.docx' })).toEqual(bound)
    expect((await p.loadChat(bound)).map((m) => m.text)).toEqual(['hello\nworld'])
    const tl = await p.getTimeline({ projectId: bound.projectId })
    expect(tl[0]).toMatchObject({ fileName: 'doc.docx', preview: 'hello' })
    const proj = await p.createProject({ name: 'P' })
    await p.moveFile({ filePath: 'uniwork://files/x/doc.docx', projectId: proj.id })
    const list = await p.listProjects()
    expect(list.find((x) => x.id === proj.id)?.fileCount).toBe(1)
  })
})
