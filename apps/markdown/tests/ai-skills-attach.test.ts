/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { AI_SKILLS_LABELS, clearUniworkAcks, setAiModelNeedHint } from '@genoffice/ui'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { usableAiSettings } from './helpers/ai-settings'

const harness = vi.hoisted(() => ({
  runs: [] as string[],
  finishRun: null as (() => void) | null,
  failRun: null as ((err: string) => void) | null,
  settingsFail: false,
  onToggle: null as ((name: string) => void) | null,
}))
// expose the panel's own onToggle so the cap can be driven past the menu's disabled button
vi.mock('@genoffice/ui', async (orig) => {
  const real: Record<string, unknown> = await orig()
  const RealMenu = real.AiSkillsMenu as (p: {
    onToggle: (name: string) => void
  }) => ReturnType<typeof createElement>
  return {
    ...real,
    AiSkillsMenu: (p: { onToggle: (name: string) => void }) => {
      harness.onToggle = p.onToggle
      return createElement(RealMenu, p as never)
    },
  }
})
vi.mock('@genoffice/agent-core', async (orig) => {
  const real: Record<string, unknown> = await orig()
  class FakeLoop {
    busy = false
    private events:
      | {
          onDone?: (r: {
            text: string
            cancelled: boolean
            turnLimit: boolean
            truncated: boolean
          }) => void
          onError?: (err: string) => void
        }
      | undefined
    constructor(opts?: { events?: FakeLoop['events'] }) {
      this.events = opts?.events
    }
    async run(instruction: string): Promise<void> {
      harness.runs.push(instruction)
      this.busy = true
      harness.finishRun = () => {
        this.busy = false
        this.events?.onDone?.({
          text: 'reply',
          cancelled: false,
          turnLimit: false,
          truncated: false,
        })
      }
      harness.failRun = (err: string) => {
        this.busy = false
        this.events?.onError?.(err)
      }
    }
    cancel(): void {}
    reset(): void {}
    restore(): void {}
  }
  return { ...real, AgentLoop: FakeLoop }
})

import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const click = (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  if (el instanceof HTMLElement) act(() => el.click())
}

function typeInComposer(container: HTMLElement, text: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function pressEnterInComposer(container: HTMLElement): void {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

describe('markdown AI panel skills attach (X4)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let editor: Editor | null = null

  beforeAll(() => {
    const actEnv: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis
    actEnv.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    editor?.destroy()
    root = null
    container = null
    editor = null
    harness.runs.length = 0
    harness.finishRun = null
    harness.failRun = null
    harness.settingsFail = false
    act(() => setAiModelNeedHint(null))
    clearUniworkAcks()
    setUniworkAiAvailable(false)
    vi.unstubAllGlobals()
  })

  async function mountPanel(
    opts: {
      provider?: 'openai' | 'uniwork'
      skills?: Array<{ name: string; description: string; relevant: boolean }>
      bodies?: Record<string, string | Error>
      onOpenSkillsSettings?: () => Promise<void>
    } = {},
  ) {
    Element.prototype.scrollTo = () => {}
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const provider = opts.provider ?? 'openai'
    if (provider === 'uniwork') setUniworkAiAvailable(true)
    const skills = opts.skills ?? [
      { name: 'tables', description: 'Header rows and totals', relevant: true },
      { name: 'tone', description: 'Write plainly', relevant: true },
      { name: 'citations', description: 'Footnotes and sources', relevant: true },
      { name: 'summary', description: 'Executive summary', relevant: true },
    ]
    const bodies: Record<string, string | Error> = opts.bodies ?? {
      tables: 'Always add a header row.',
      tone: 'Write plainly.',
      citations: 'Use footnotes.',
      summary: 'Keep it brief.',
    }
    const openSkillsSettings = vi.fn(opts.onOpenSkillsSettings ?? (async () => {}))
    const skillsList = vi.fn(async () => skills)
    const skillText = vi.fn(async (name: string) => {
      const val = bodies[name]
      if (val instanceof Error) throw val
      if (val === undefined) throw new Error(`no installed skill named "${name}"`)
      return val
    })
    const stubs: Record<string, unknown> = {
      openSkillsSettings,
      skillsList,
      skillText,
      getAiSettings: vi.fn(async () => {
        if (harness.settingsFail) throw new Error('settings unavailable')
        return { ...usableAiSettings(), provider }
      }),
    }
    vi.stubGlobal(
      'markdownApi',
      new Proxy(stubs, {
        get(target, prop: string) {
          if (!(prop in target)) {
            target[prop] = /^on[A-Z]/.test(prop)
              ? vi.fn(() => () => {})
              : vi.fn(async () => undefined)
          }
          return target[prop]
        },
      }),
    )
    editor = new Editor({
      extensions: buildExtensions({
        slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
        slashItems: () => [],
      }),
      content: '<p>Saved document</p>',
    })
    const deps: MarkdownAiDeps = {
      getEditor: () => editor,
      getFrontmatter: () => '',
      setFrontmatter: () => {},
      getSnapshot: () => ({ body: 'Saved document', frontmatter: '' }),
      restoreSnapshot: () => {},
      onRunDone: () => null,
      onSaveOffer: () => {},
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AiPanel, {
            deps,
            filePath: '/docs/a.md',
            onCollapse: () => {},
          }),
        ),
      )
    })
    await flush()
    await flush()
    return { openSkillsSettings, skillsList, skillText }
  }

  it('withSkillBodies: keeps selected skill bodies in order, skips a vanished skill without throwing, and echoes only chip names on the user bubble', async () => {
    await mountPanel({
      bodies: {
        tables: 'First body.',
        tone: new Error('vanished from disk'),
        citations: 'Third body.',
      },
    })
    click(container!.querySelector('.ai-plus-btn'))
    await flush()
    const items = [...container!.querySelectorAll<HTMLButtonElement>('.ai-plus-skill')]
    click(items[0]) // tables
    click(items[1]) // tone (will reject in skillText)
    click(items[2]) // citations

    // Draft chips appear in composer header
    const draftChips = [...container!.querySelectorAll('.ai-composer .ai-skill-chip-name')].map(
      (n) => n.textContent,
    )
    expect(draftChips).toEqual(['tables', 'tone', 'citations'])

    typeInComposer(container!, 'Draft the report')
    pressEnterInComposer(container!)
    await flush()
    await flush()

    expect(harness.runs).toHaveLength(1)
    const sent = harness.runs[0]!
    expect(sent.indexOf('<skill name="tables">')).toBeLessThan(
      sent.indexOf('<skill name="citations">'),
    )
    expect(sent).toContain('<skill name="tables">\nFirst body.\n</skill>')
    expect(sent).toContain('<skill name="citations">\nThird body.\n</skill>')
    expect(sent).not.toContain('tone')
    expect(sent.endsWith('User request:\nDraft the report')).toBe(true)

    // User bubble shows the chips, never the skill bodies; composer chips cleared
    expect(container!.querySelectorAll('.ai-composer .ai-skill-chip-name')).toHaveLength(0)
    const bubbleChips = [...container!.querySelectorAll('.ai-msg-user .ai-skill-chip-name')].map(
      (n) => n.textContent,
    )
    expect(bubbleChips).toEqual(['tables', 'tone', 'citations'])
    expect(container!.querySelector('.ai-msg-user')?.textContent).not.toContain('First body.')
  })

  it('enforces the 3-skill cap in the panel state and menu', async () => {
    await mountPanel()
    click(container!.querySelector('.ai-plus-btn'))
    await flush()
    const items = [...container!.querySelectorAll<HTMLButtonElement>('.ai-plus-skill')]
    click(items[0])
    click(items[1])
    click(items[2])
    expect(items[3]!.disabled).toBe(true)
    click(items[3])
    const draftChips = [...container!.querySelectorAll('.ai-composer .ai-skill-chip-name')].map(
      (n) => n.textContent,
    )
    expect(draftChips).toEqual(['tables', 'tone', 'citations'])
  })

  it('never attaches or sends more than 3 skills even when onToggle is driven past the cap', async () => {
    await mountPanel()
    click(container!.querySelector('.ai-plus-btn'))
    await flush()
    const items = [...container!.querySelectorAll<HTMLButtonElement>('.ai-plus-skill')]
    click(items[0])
    click(items[1])
    click(items[2])
    // call the panel's own toggle past the cap: the state guard, not the menu button, must hold
    act(() => harness.onToggle?.('summary'))
    const draftChips = [...container!.querySelectorAll('.ai-composer .ai-skill-chip-name')].map(
      (n) => n.textContent,
    )
    expect(draftChips).toEqual(['tables', 'tone', 'citations'])
    typeInComposer(container!, 'Go')
    pressEnterInComposer(container!)
    await flush()
    await flush()
    expect(harness.runs).toHaveLength(1)
    expect(harness.runs[0]!.match(/<skill name=/g)).toHaveLength(3)
    expect(harness.runs[0]).not.toContain('Keep it brief.')
  })

  it('a failing settings read does not overwrite the previous reply and still sends', async () => {
    await mountPanel()
    typeInComposer(container!, 'First')
    pressEnterInComposer(container!)
    await flush()
    act(() => harness.finishRun?.())
    await flush()
    expect(container!.querySelector('.ai-msg-assistant')?.textContent).toContain('reply')
    harness.settingsFail = true

    click(container!.querySelector('.ai-plus-btn'))
    await flush()
    click(container!.querySelector('.ai-plus-skill'))
    typeInComposer(container!, 'Second')
    pressEnterInComposer(container!)
    await flush()
    await flush()
    expect(harness.runs).toHaveLength(2)
    expect(harness.runs[1]).toContain('<skill name="tables">')
    expect(container!.textContent).not.toContain('settings unavailable')
    expect(container!.querySelector('.ai-msg-assistant')?.textContent).toContain('reply')
  })

  it('carries skills only from composer send: queued messages and retries never carry skills', async () => {
    await mountPanel()
    // 1. Start a first run without skills so we can enqueue while busy
    typeInComposer(container!, 'First turn')
    pressEnterInComposer(container!)
    await flush()
    expect(harness.runs).toEqual(['First turn'])

    // Attach a skill while busy and enqueue a draft
    click(container!.querySelector('.ai-plus-btn'))
    await flush()
    click(container!.querySelector('.ai-plus-skill')) // tables
    typeInComposer(container!, 'Queued turn')
    pressEnterInComposer(container!)
    expect(container!.querySelector('.ai-queue-strip')).not.toBeNull()

    // Finish first turn -> queue pump submits 'Queued turn' without consuming attachedSkills
    act(() => harness.finishRun?.())
    await flush()
    await flush()
    expect(harness.runs).toEqual(['First turn', 'Queued turn'])
    // Attached skill is still waiting on the composer draft
    expect(
      [...container!.querySelectorAll('.ai-composer .ai-skill-chip-name')].map(
        (n) => n.textContent,
      ),
    ).toEqual(['tables'])

    // Fail the second turn so we can retry it while 'tables' is still attached in composer
    act(() => harness.failRun?.('network failed'))
    await flush()
    click(container!.querySelector('.ai-retry-btn'))
    await flush()
    expect(harness.runs).toEqual(['First turn', 'Queued turn', 'Queued turn'])
  })

  it('resets attached skills on New chat and wires Manage skills to openSkillsSettings', async () => {
    const { openSkillsSettings } = await mountPanel()
    typeInComposer(container!, 'Hello')
    pressEnterInComposer(container!)
    await flush()
    act(() => harness.finishRun?.())
    await flush()

    click(container!.querySelector('.ai-plus-btn'))
    await flush()
    click(container!.querySelector('.ai-plus-skill')) // tables
    expect(container!.querySelectorAll('.ai-composer .ai-skill-chip')).toHaveLength(1)

    click(container!.querySelector('.ai-plus-manage'))
    expect(openSkillsSettings).toHaveBeenCalledTimes(1)

    // Click New chat button in header
    const newChatBtn = container!.querySelector<HTMLButtonElement>(
      '.ai-panel-header .ai-header-btn[aria-label="New chat"]',
    )
    click(newChatBtn)
    expect(container!.querySelectorAll('.ai-composer .ai-skill-chip')).toHaveLength(0)
  })

  it('UniWork AI 8,000-rune pre-send check: refuses 2 long skills on uniwork (keeps text & chips, shows notice), sends on BYOK, and sends 1 short skill on uniwork', async () => {
    const longA = 'A'.repeat(4500)
    const longB = 'B'.repeat(4500)
    // 1. UniWork AI with 2 long skills (> 8,000 runes total)
    await mountPanel({
      provider: 'uniwork',
      bodies: {
        tables: longA,
        tone: longB,
        citations: 'Short skill body.',
      },
    })
    // Acknowledge UniWork AI disclosure first
    const ackBtn = container!.querySelector<HTMLButtonElement>('[role="region"] button')
    if (ackBtn) click(ackBtn)
    await flush()

    click(container!.querySelector('.ai-plus-btn'))
    await flush()
    const items = [...container!.querySelectorAll<HTMLButtonElement>('.ai-plus-skill')]
    click(items[0]) // tables (4500)
    click(items[1]) // tone (4500)

    typeInComposer(container!, 'Summarize this')
    pressEnterInComposer(container!)
    await flush()
    await flush()

    // Not sent; notice shown; prompt and chips preserved
    expect(harness.runs).toEqual([])
    expect(container!.querySelector('.ai-skills-too-long-notice')?.textContent).toBe(
      AI_SKILLS_LABELS.en.uniworkTooLongNotice,
    )
    expect(container!.querySelector<HTMLTextAreaElement>('textarea.ai-input')?.value).toBe(
      'Summarize this',
    )
    expect(
      [...container!.querySelectorAll('.ai-composer .ai-skill-chip-name')].map(
        (n) => n.textContent,
      ),
    ).toEqual(['tables', 'tone'])

    // Removing one long skill clears the notice and allows sending when under 8,000 runes
    click(container!.querySelectorAll('.ai-composer .ai-skill-chip-remove')[1]) // remove tone
    expect(container!.querySelector('.ai-skills-too-long-notice')).toBeNull()
    pressEnterInComposer(container!)
    await flush()
    await flush()
    expect(harness.runs).toHaveLength(1)
    expect(harness.runs[0]).toContain(longA)

    // 2. BYOK with the same 2 long skills sends without refusal
    act(() => root!.unmount())
    container!.remove()
    harness.runs.length = 0
    await mountPanel({
      provider: 'openai',
      bodies: {
        tables: longA,
        tone: longB,
      },
    })
    click(container!.querySelector('.ai-plus-btn'))
    await flush()
    const byokItems = [...container!.querySelectorAll<HTMLButtonElement>('.ai-plus-skill')]
    click(byokItems[0])
    click(byokItems[1])
    typeInComposer(container!, 'Summarize this')
    pressEnterInComposer(container!)
    await flush()
    await flush()
    expect(harness.runs).toHaveLength(1)
    expect(harness.runs[0]).toContain(longA)
    expect(harness.runs[0]).toContain(longB)
  })
})
