/**
 * G8-15 fix r1 (V15-01): the assistant panel must forward the server-comments hooks of the
 * app deps to the tool loop. The unit tests call `executePdfTool` with hand-made deps and
 * missed that `AiPanel` builds its own getter table: this goes through the real panel.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { PdfAiDeps, PdfAppDeps } from '../src/renderer/ai/tools'

const captured: { deps: PdfAiDeps | null } = { deps: null }
vi.mock('../src/renderer/ai/pdf-skill', async (importActual) => {
  const actual = await importActual<typeof import('../src/renderer/ai/pdf-skill')>()
  return {
    ...actual,
    createPdfSkill: (deps: PdfAiDeps) => {
      captured.deps = deps
      return actual.createPdfSkill(deps)
    },
  }
})

const { AiPanel } = await import('../src/renderer/ai/AiPanel')
const { executePdfTool } = await import('../src/renderer/ai/tools')

function mountPanel(api: Record<string, unknown>) {
  captured.deps = null
  const proxy = new Proxy(api, { get: (t, p: string) => (p in t ? t[p] : () => null) })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(AiPanel, { api: proxy as unknown as PdfAppDeps, onCollapse: () => {} }),
    ),
  )
  return () => {
    act(() => root.unmount())
    container.remove()
  }
}

describe('AiPanel forwards the server-comments deps (V15-01)', () => {
  beforeAll(() => {
    Element.prototype.scrollTo ??= () => {}
  })

  const baseApi = () => ({
    fileName: () => 'bound.pdf',
    pageCount: () => 1,
    currentPage: () => 1,
    readOnly: () => false,
    isDeleted: () => false,
    pageOrder: () => [0],
    pageGeom: () => ({ pw: 600, ph: 800, rot: 0 }),
    gotoPage: () => true,
    addNote: vi.fn(() => ({ key: 'Pn1' })),
  })

  it('add_note on a bound PDF only drafts into the composer through the panel deps', async () => {
    const draftServerComment = vi.fn(() => true)
    const api = { ...baseApi(), serverComments: () => true, draftServerComment }
    const unmount = mountPanel(api)
    const deps = captured.deps!
    expect(deps.serverComments?.()).toBe(true)
    const result = await executePdfTool(deps, {
      id: 't1',
      name: 'add_note',
      input: { page: 1, text: 'Check spelling', x: 100, y: 100 },
    })
    expect(result.mutated).toBeUndefined()
    expect(draftServerComment).toHaveBeenCalledWith(0, expect.any(Array), 'Check spelling')
    expect(api.addNote).not.toHaveBeenCalled()
    unmount()
  })

  it('a local PDF keeps today’s file note', async () => {
    const api = { ...baseApi(), serverComments: () => false }
    const unmount = mountPanel(api)
    const result = await executePdfTool(captured.deps!, {
      id: 't1',
      name: 'add_note',
      input: { page: 1, text: 'Check spelling', x: 100, y: 100 },
    })
    expect(result.mutated).toBe(true)
    expect(api.addNote).toHaveBeenCalled()
    unmount()
  })

  it('an app without the hooks (older host) is a local file', () => {
    const unmount = mountPanel(baseApi())
    expect(captured.deps!.serverComments?.() ?? false).toBe(false)
    unmount()
  })

  it('forwards uniworkBound too', () => {
    const unmount = mountPanel({ ...baseApi(), uniworkBound: () => true })
    expect(captured.deps!.uniworkBound?.()).toBe(true)
    unmount()
  })
})
