// G6-09a r1 (RFA-5): the skill gates read the panel's capability reader. This goes through the
// real AiPanel: the capability the host reports changes the tools the skill offers, so the
// predicate plumbing is pinned by more than the type checker. Every turn runs on UniWork AI
// (UNI-2309), so the capability alone decides.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type { AgentSkill } from '@genoffice/agent-core'
import type { PdfAiDeps } from '../src/renderer/ai/tools'

const captured: { skill: AgentSkill | null } = { skill: null }
vi.mock('../src/renderer/ai/pdf-skill', async (importActual) => {
  const actual = await importActual<typeof import('../src/renderer/ai/pdf-skill')>()
  return {
    ...actual,
    createPdfSkill: (deps: PdfAiDeps) => {
      captured.skill = actual.createPdfSkill(deps)
      return captured.skill
    },
  }
})

const { AiPanel } = await import('../src/renderer/ai/AiPanel')
const { LocaleProvider } = await import('../src/renderer/i18n/locale')
const { resetForTest } = await import('../src/renderer/capabilities')

describe('AiPanel feeds the skill gates (pdf)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    delete (window as any).pdfApi
    resetForTest()
  })

  async function offeredWith(pdfTextEdit: boolean): Promise<string[]> {
    if (root) act(() => root!.unmount())
    container?.remove()
    ;(window as any).pdfApi = {
      getAiSettings: async () => defaultAiSettings(),
      onAiSettingsChanged: () => () => {},
      setAiPanelPrefs: () => {},
      gskStatus: async () => ({ loggedIn: false }),
      onLanguageChanged: () => () => {},
      capabilities: { pdfTextEdit },
    }
    resetForTest()
    const api = new Proxy(
      { fileName: () => 'doc.pdf', readOnly: () => false, selection: () => null },
      { get: (t, p: string) => (p in t ? (t as never)[p] : () => null) },
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AiPanel, { api: api as never, onCollapse: () => {}, open: true }),
        ),
      )
    })
    return captured.skill!.tools.map((t) => t.name)
  }

  it('text edit tools follow the capability reader', async () => {
    const off = await offeredWith(false)
    expect(off).not.toContain('edit_text')
    expect(off).toContain('apply_ops')
    expect(await offeredWith(true)).toContain('edit_text')
  })
})
