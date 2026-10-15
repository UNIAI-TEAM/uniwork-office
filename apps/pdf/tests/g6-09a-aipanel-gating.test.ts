// G6-09a r1 (RFA-5): the skill gates read the panel's own settings and capability reader. This
// goes through the real AiPanel: flipping the provider in the settings the panel loaded changes
// the tools the skill offers, so the predicate plumbing is pinned by more than the type checker.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
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

const settingsFor = (provider: 'uniwork' | 'anthropic'): AiSettings => {
  const base = defaultAiSettings()
  return { ...base, provider } as AiSettings
}

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
  })

  it('text edit tools follow the panel provider and the capability reader', async () => {
    let settings = settingsFor('anthropic')
    const handlers: (() => void)[] = []
    ;(window as any).pdfApi = {
      getAiSettings: async () => settings,
      onAiSettingsChanged: (cb: () => void) => {
        handlers.push(cb)
        return () => {}
      },
      setAiPanelPrefs: () => {},
      gskStatus: async () => ({ loggedIn: false }),
      onLanguageChanged: () => () => {},
      capabilities: { pdfTextEdit: false },
    }
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
    const offered = () => captured.skill!.tools.map((t) => t.name)
    // BYOK provider: the capability being off changes nothing
    expect(offered()).toContain('edit_text')
    // switch the provider in settings: UniWork AI + pdfTextEdit off hides the text edits
    settings = settingsFor('uniwork')
    await act(async () => {
      for (const h of handlers) h()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(offered()).not.toContain('edit_text')
    expect(offered()).toContain('apply_ops')
    // and back
    settings = settingsFor('anthropic')
    await act(async () => {
      for (const h of handlers) h()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(offered()).toContain('edit_text')
  })
})
