// G6-09 N-1: the UniWork AI disclosure is acknowledged once per account + organisation + document.
// An untitled document's first Save gives it a path, which changed the key and showed the card again
// although the user had just said "Got it". The ack of the untitled document carries to its file.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import { AiPanel } from '../src/renderer/ai/AiPanel'

const settings: AiSettings = {
  provider: 'uniwork',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: 'test-key', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('UniWork AI disclosure ack across the first save of an untitled document', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    act(() => setAiModelNeedHint(null))
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    delete (window as any).desktop
    delete (window as any).uniworkCloudStatus
  })

  async function mount() {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: { type: 'doc', content: [{ type: 'docParagraph', attrs: { docxIndex: 0 } }] },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const stubs: Record<string, unknown> = { capabilities: { platform: 'desktop' } }
    ;(window as any).desktop = new Proxy(stubs, {
      get(target, prop: string) {
        if (!(prop in target)) {
          target[prop] = /^on[A-Z]/.test(prop)
            ? vi.fn(() => () => {})
            : prop === 'getAiSettings'
              ? vi.fn(async () => settings)
              : prop === 'aiGskStatus'
                ? vi.fn(async () => ({ loggedIn: false }))
                : vi.fn(async () => undefined)
        }
        return target[prop]
      },
    })
    ;(window as any).uniworkCloudStatus = {
      get: async () => ({ state: 'ready', signedIn: true, accountId: 'acct-1', orgId: 'org-1' }),
      onChange: () => () => {},
    }
    const render = (filePath: string | null) =>
      act(() =>
        root!.render(
          createElement(AiPanel, {
            editor: editor!,
            blocks: [],
            settings,
            open: true,
            onExpand: vi.fn(),
            filePath,
          } as never),
        ),
      )
    render(null)
    await flush()
    await flush()
    return { render }
  }

  const card = () => container!.querySelector('.ai-uniwork-disclosure')
  const ackBtn = () => container!.querySelector<HTMLButtonElement>('.ai-uniwork-disclosure-ack')

  it('Got it on an untitled document stays acknowledged once the document has a path', async () => {
    const { render } = await mount()
    expect(card(), 'the card shows before the ack').not.toBeNull()
    await act(async () => ackBtn()!.click())
    await flush()
    expect(card(), 'acked').toBeNull()
    render('/docs/first-save.docx')
    await flush()
    await flush()
    expect(card(), 'still acked after the first save').toBeNull()
  })

  it('a different file opened without that ack still asks', async () => {
    const { render } = await mount()
    render('/docs/other.docx')
    await flush()
    await flush()
    expect(card()).not.toBeNull()
  })
})
