// UNI-2264: a preset from outside the panel (the desktop shell's, or the job a web host hands over
// with `ai.start`) is sent word for word: the frame recognises the job's question by its text and
// tags it with the job id. One that cannot run now waits in the composer, never dropped; one that
// arrives before the document has loaded runs once it has.
import { Buffer } from 'node:buffer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { aiUniworkText, clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AI_PROVIDERS, type AiPresetPayload, type AiSettings } from '../src/shared/ipc'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'

const harness = vi.hoisted(() => ({ runs: [] as string[] }))
vi.mock('@genoffice/agent-core', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  class FakeLoop {
    busy = false
    async run(instruction: string): Promise<void> {
      harness.runs.push(instruction)
      this.busy = true
    }
    cancel(): void {}
    reset(): void {}
    restore(): void {}
  }
  return { ...real, AgentLoop: FakeLoop }
})

import { AiPanel } from '../src/renderer/ai/AiPanel'
import { App } from '../src/renderer/App'

/** a job's text with the line ends and spacing a host may send: it must reach the loop unchanged */
const JOB = 'Draft this document from the job:  Plan\r\n- Goals'

const settingsFor = (provider: AiSettings['provider']): AiSettings => ({
  provider,
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: 'test-key', model: p.defaultModel }]),
  ) as AiSettings['providers'],
})

const tick = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
const settle = async (n = 12): Promise<void> => {
  for (let i = 0; i < n; i++) await tick()
}

/** window.desktop where every unknown `on*` member is a disposer and every other one resolves */
function stubDesktop(members: Record<string, unknown>): void {
  ;(window as unknown as { desktop?: unknown }).desktop = new Proxy(members, {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = /^on[A-Z]/.test(prop) ? vi.fn(() => () => {}) : vi.fn(async () => undefined)
      }
      return target[prop]
    },
  })
}

/** the UniWork AI disclosure's acknowledge button, by role and name (no LocaleProvider: zh) */
function ackButton(within: HTMLElement): HTMLButtonElement {
  const region = [...within.querySelectorAll<HTMLElement>('[role="region"]')].find(
    (r) => r.getAttribute('aria-label') === aiUniworkText('zh', 'aiUniworkDisclosureLabel'),
  )
  const button = [...(region?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === aiUniworkText('zh', 'aiUniworkAck'),
  )
  if (!button) throw new Error('no UniWork AI disclosure to acknowledge')
  return button
}

let root: Root | null = null
let container: HTMLElement | null = null
let editor: Editor | null = null

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  editor?.destroy()
  root = null
  container = null
  editor = null
  harness.runs.length = 0
  act(() => setAiModelNeedHint(null))
  clearUniworkAcks()
  setUniworkAiAvailable(false)
  localStorage.clear()
  resetCapabilitiesForTest()
  delete (window as unknown as { desktop?: unknown }).desktop
})

describe('docs AI panel: a preset that cannot run waits in the composer', () => {
  it('UniWork AI not acknowledged: the text sits in the composer, nothing is sent; Send after the ack sends it', async () => {
    setUniworkAiAvailable(true)
    const settings = settingsFor('uniwork')
    stubDesktop({
      capabilities: { platform: 'desktop' },
      getAiSettings: vi.fn(async () => settings),
      aiGskStatus: vi.fn(async () => ({ loggedIn: false })),
    })
    editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            attrs: { docxIndex: 0 },
            content: [{ type: 'text', text: 'Saved document' }],
          },
        ],
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (preset: { text: string; nonce: number; autoRun: boolean } | null) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings,
            open: true,
            ...(preset ? { preset } : {}),
          } as never),
        ),
      )
    render(null)
    await settle(2)
    render({ text: JOB, nonce: 1, autoRun: true })
    await settle(2)

    expect(harness.runs).toEqual([])
    expect(container.querySelector('.ai-msg-user')).toBeNull()
    const box = container.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
    // a textarea keeps LF line ends; the frame compares the text with line ends and spacing normalized
    expect(box.value).toBe(JOB.replace(/\r\n/g, '\n'))

    // the person acknowledges the disclosure and sends the kept text
    act(() => ackButton(container!).click())
    await settle(2)
    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await settle(2)
    expect(harness.runs).toEqual([JOB.trim()])
  })

  it('a host job runs only while the panel is on UniWork AI when it would run; held, it waits in the focused composer', async () => {
    setUniworkAiAvailable(true)
    const settings = settingsFor('uniwork')
    // the provider the panel reads right before the job would run
    let live = settingsFor('anthropic')
    stubDesktop({
      capabilities: { platform: 'desktop' },
      getAiSettings: vi.fn(async () => live),
      aiGskStatus: vi.fn(async () => ({ loggedIn: false })),
    })
    editor = new Editor({ element: document.createElement('div'), extensions: editorExtensions })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (preset: Record<string, unknown> | null) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings,
            open: true,
            ...(preset ? { preset } : {}),
          } as never),
        ),
      )
    const box = () => container!.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
    render(null)
    await settle(2)
    act(() => ackButton(container!).click())
    await settle(2)

    // the person switched to another provider after the job arrived: nothing goes to it
    render({ text: JOB, nonce: 1, autoRun: true, uniworkOnly: true })
    await settle(2)
    expect(harness.runs).toEqual([])
    expect(box().value).toBe(JOB.replace(/\r\n/g, '\n'))
    expect(document.activeElement).toBe(box())

    // back on UniWork AI, the job runs
    live = settingsFor('uniwork')
    render({ text: JOB, nonce: 2, autoRun: true, uniworkOnly: true })
    await settle(2)
    expect(harness.runs).toEqual([JOB])

    // an auto-run preset refused while that run is going waits in the composer, which takes focus
    act(() => box().blur())
    render({ text: 'Summarise it', nonce: 3, autoRun: true })
    await settle(2)
    expect(harness.runs).toEqual([JOB])
    expect(box().value).toBe('Summarise it')
    expect(document.activeElement).toBe(box())
  })
})

describe('docs AI panel: one question per preset', () => {
  it('a panel remounted for another document key does not run the preset it already took', async () => {
    const settings = settingsFor('anthropic')
    stubDesktop({
      capabilities: { platform: 'desktop' },
      getAiSettings: vi.fn(async () => settings),
      aiGskStatus: vi.fn(async () => ({ loggedIn: false })),
    })
    editor = new Editor({ element: document.createElement('div'), extensions: editorExtensions })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const seen = { current: null as number | null }
    const render = (key: number) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            key,
            editor: editor!,
            blocks: [],
            settings,
            open: true,
            preset: { text: JOB, nonce: 7, autoRun: true },
            presetSeen: seen,
          } as never),
        ),
      )
    render(1)
    await settle(2)
    expect(harness.runs).toEqual([JOB])
    render(2)
    await settle(2)
    expect(harness.runs).toEqual([JOB])
  })
})

describe('docs app: a preset that arrives before the document has loaded', () => {
  async function mountApp(consumed: AiPresetPayload | null, web = false) {
    setModuleLang('en')
    window.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0)
    window.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    window.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    } as unknown as typeof IntersectionObserver
    window.CSS ??= {
      escape: (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
    } as typeof CSS
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loaded',
        ready: Promise.resolve(),
        addEventListener() {},
        removeEventListener() {},
      },
    })
    const bytes = await buildDocx({ bodyXml: '<w:p><w:r><w:t>one two</w:t></w:r></w:p>' })
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${Buffer.from(bytes).toString('base64')}`
    let open!: () => void
    const opened = new Promise<unknown>((resolve) => {
      open = () => resolve({ path: '/docs/job.docx', name: 'job.docx', dataUrl, hash: 'h' })
    })
    let listener: ((preset: AiPresetPayload) => void) | null = null
    const settings = settingsFor('anthropic')
    ;(window as unknown as { desktop?: unknown }).desktop = {
      ...(web ? { capabilities: { platform: 'web' } } : {}),
      consumePendingOpenDocx: () => opened,
      consumeNewBlankDoc: () => Promise.resolve(false),
      consumeAiDocContent: () => Promise.resolve(null),
      consumeAiPreset: () => Promise.resolve(consumed),
      consumeHeadlessExport: () => Promise.resolve(null),
      onOpenDocx: () => () => {},
      onRenamedDocx: () => () => {},
      onAiPreset: (handler: (preset: AiPresetPayload) => void) => {
        listener = handler
        return () => {
          listener = null
        }
      },
      getAiSettings: () => Promise.resolve(settings),
      onAiSettingsChanged: () => () => {},
      getRecentFiles: () => Promise.resolve([]),
      docPasswordIntentRevision: () => Promise.resolve(0),
      discardDocPasswordIntents: () => Promise.resolve(),
      onZoteroRequest: () => () => {},
      provideDocBytes: () => () => {},
      onMenuCommand: () => () => {},
      onTeardown: () => () => {},
      onViewImage: () => () => {},
      getCommentAuthor: () => Promise.resolve(null),
      onCommentAuthorChanged: () => () => {},
      onContextMenuRequest: () => () => {},
      armContextMenu: () => {},
      confirmDocumentReplace: () => Promise.resolve(true),
      respellKick: () => Promise.resolve(),
      spellLanguages: () => Promise.resolve(['en']),
      onLanguageChanged: () => () => {},
      getPathForFile: () => '',
      onAiStream: () => () => {},
      aiStream: () => Promise.resolve(),
      aiStreamCancel: () => Promise.resolve(),
      saveDocx: () => Promise.resolve({ ok: true }),
      saveDocxAs: () => Promise.resolve({ ok: false }),
      saveDocxCopy: () => Promise.resolve({ ok: false }),
      openDocx: () => Promise.resolve(null),
      openDocxPath: () => Promise.resolve(null),
      openDocxDecrypt: () => Promise.resolve({ ok: false, reason: 'error' }),
      print: () => {},
      pickImage: () => Promise.resolve(null),
      fetchImage: () => Promise.resolve(null),
      saveImageAs: () => {},
      noteDocumentMounted: () => {},
      headlessExportDone: () => {},
      reportViewMenuState: () => {},
      reportCloseCheck: () => {},
      reportCloseSaveResult: () => {},
      onCloseCheck: () => () => {},
      onCloseSaveRequest: () => () => {},
      claimContextMenu: () => {},
      respondToZotero: () => {},
      setDocPassword: () => Promise.resolve({ ok: true }),
      aiGskStatus: () => Promise.resolve(null),
      spellDiag: () => {},
      spellAddWord: () => {},
      spellIgnoreWord: () => {},
      spellReplace: () => {},
      spellSetLanguages: () => {},
      setAiSettings: () => Promise.resolve(),
      setAiPanelPrefs: () => {},
      openInApp: () => {},
      openNewTab: () => {},
      listDocsTabs: () => Promise.resolve([]),
      focusDocsTab: () => {},
      zoteroCommand: () => Promise.resolve(null),
      uniworkState: () => Promise.resolve(null),
    }
    resetCapabilitiesForTest()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(LocaleProvider, { initial: 'en', children: createElement(App) }))
    })
    await settle()
    return { open, fire: (preset: AiPresetPayload) => act(() => listener!(preset)) }
  }

  it('a preset pushed while the document still opens runs once it has loaded, word for word', async () => {
    const app = await mountApp(null)
    app.fire({ text: JOB, autoRun: true, displayText: 'Draft the plan' })
    await settle()
    expect(harness.runs).toEqual([])
    expect(document.querySelector('.ai-msg-user')).toBeNull()

    app.open()
    for (let i = 0; i < 200 && harness.runs.length === 0; i++) await tick()
    await settle()
    expect(harness.runs).toEqual([JOB])
    // the bubble shows the display words, the loop got the text
    expect(document.querySelector('.ai-msg-user')?.textContent).toContain('Draft the plan')
  })

  it('in a web frame a job on another provider than UniWork AI waits in the composer, not sent', async () => {
    const app = await mountApp(null, true)
    app.fire({ text: JOB, autoRun: true })
    app.open()
    for (let i = 0; i < 200 && !document.querySelector('textarea.ai-input'); i++) await tick()
    await settle()
    expect(harness.runs).toEqual([])
    expect(document.querySelector('.ai-msg-user')).toBeNull()
    expect(document.querySelector<HTMLTextAreaElement>('textarea.ai-input')!.value).toBe(
      JOB.replace(/\r\n/g, '\n'),
    )
  })

  it('a preset buffered before the panel subscribed runs once the document has loaded', async () => {
    const app = await mountApp({ text: JOB, autoRun: true })
    await settle()
    expect(harness.runs).toEqual([])
    app.open()
    for (let i = 0; i < 200 && harness.runs.length === 0; i++) await tick()
    await settle()
    expect(harness.runs).toEqual([JOB])
  })
})
