// G6-12 #7 (C-ASK): markdown gets html's ask_clarification — same input schema,
// a questionnaire card in the markdown AI panel that blocks the run until the
// user answers, `cancelled` when skipped, and mutated: false.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { AGENT_TOOLS, executeTool, type ClarifyQuestion } from '../src/renderer/ai/tools'
import { createMarkdownSkill } from '../src/renderer/ai/markdown-skill'
import { ClarifyCard } from '../src/renderer/components/ClarifyCard'
import { strings } from '../src/renderer/i18n/strings'

/** html's ask_clarification inputSchema at e6862e53 (apps/html/src/renderer/ai/tools.ts) */
const HTML_SCHEMA = {
  type: 'object',
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        required: ['id', 'label', 'options'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          multi: { type: 'boolean' },
        },
      },
    },
  },
}

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})
function createEditor(): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: {
        onOpen: () => {},
        onUpdate: () => {},
        onKeyDown: () => false,
        onClose: () => {},
      },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent('Body text', { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

type Ask = (q: ClarifyQuestion[]) => Promise<{ answers: string; cancelled?: boolean }>

function run(input: Record<string, unknown>, ask?: Ask) {
  const editor = createEditor()
  const before = JSON.stringify(editor.getJSON())
  const out = executeTool(
    editor,
    { id: 't1', name: 'ask_clarification', input },
    undefined,
    undefined,
    undefined,
    ask,
  )
  return { out: Promise.resolve(out), unchanged: () => JSON.stringify(editor.getJSON()) === before }
}

const QUESTIONS = {
  questions: [
    {
      id: 'scope',
      label: 'Which part should change?',
      options: ['Intro', 'Whole document', 'a', 'b', 'c', 'dropped'],
    },
    { id: 'empty', label: 'No options', options: [] },
  ],
}

describe('ask_clarification tool (markdown)', () => {
  it('has html’s input schema and a markdown-specific description', () => {
    const def = AGENT_TOOLS.find((t) => t.name === 'ask_clarification')
    expect(def).toBeDefined()
    expect(JSON.stringify(def!.inputSchema)).toBe(JSON.stringify(HTML_SCHEMA))
    expect(def!.description).not.toContain('plan_page')
  })

  it('blocks on the card and returns the answers, mutated: false', async () => {
    let seen: ClarifyQuestion[] = []
    const ask = vi.fn<Ask>(async (q) => {
      seen = q
      return { answers: 'Which part should change?: Intro' }
    })
    const { out, unchanged } = run(QUESTIONS, ask)
    const exec = await out
    expect(ask).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.options).toEqual(['Intro', 'Whole document', 'a', 'b', 'c'])
    expect(exec.isError).toBeFalsy()
    expect(exec.mutated).toBe(false)
    expect(exec.output).toBe(
      'User answers:\nWhich part should change?: Intro\nNow continue with the request following these answers.',
    )
    expect(unchanged()).toBe(true)
  })

  it('returns the skipped result when the card is cancelled', async () => {
    const exec = await run(QUESTIONS, async () => ({ answers: '', cancelled: true })).out
    expect(exec.isError).toBeFalsy()
    expect(exec.mutated).toBe(false)
    expect(exec.output).toBe(
      'The user skipped the questionnaire. Decide sensible defaults yourself and continue.',
    )
  })

  it('errors without a card host or without usable questions', async () => {
    const none = await run(QUESTIONS).out
    expect(none.isError).toBe(true)
    expect(none.mutated).toBe(false)
    const bad = await run({ questions: [{ id: 'x', label: 'L', options: [] }] }, async () => ({
      answers: '',
    })).out
    expect(bad.isError).toBe(true)
    expect(bad.output).toBe('questions must be non-empty and every question needs options')
  })

  it('is offered by the skill when the panel hosts the card, also on a view-only document', async () => {
    const editor = createEditor()
    const ask: Ask = async () => ({ answers: 'A: b' })
    const skill = (readOnly: boolean, withAsk = true) =>
      createMarkdownSkill(
        () => editor,
        undefined,
        undefined,
        undefined,
        () => readOnly,
        withAsk ? () => ask : undefined,
      )
    expect(skill(false).tools.map((t) => t.name)).toContain('ask_clarification')
    expect(skill(true).tools.map((t) => t.name)).toContain('ask_clarification')
    expect(skill(false, false).tools.map((t) => t.name)).not.toContain('ask_clarification')
    const exec = await skill(true).executeTool(
      { id: 't1', name: 'ask_clarification', input: QUESTIONS },
      undefined as never,
    )
    expect(exec.isError).toBeFalsy()
    expect(exec.output).toContain('User answers:')
  })
})

describe('ClarifyCard (markdown)', () => {
  function render(onSubmit: (a: string) => void, onSkip: () => void) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(ClarifyCard, {
          questions: [{ id: 'q', label: 'Which section?', options: ['Intro', 'Summary'] }],
          onSubmit,
          onSkip,
        }),
      ),
    )
    return {
      container,
      cleanup: () => {
        act(() => root.unmount())
        container.remove()
      },
    }
  }

  it('submits the picked option and skips on Skip', () => {
    vi.useFakeTimers()
    try {
      const onSubmit = vi.fn()
      const onSkip = vi.fn()
      const { container, cleanup } = render(onSubmit, onSkip)
      expect(container.querySelector('.ai-clarify-card')).not.toBeNull()
      const intro = [...container.querySelectorAll<HTMLButtonElement>('.ai-clarify-opt')].find(
        (b) => b.textContent?.includes('Intro'),
      )!
      act(() => intro.click())
      act(() => vi.advanceTimersByTime(300))
      expect(onSubmit).toHaveBeenCalledWith('Which section?: Intro', [
        { q: 'Which section?', a: 'Intro' },
      ])
      act(() => container.querySelector<HTMLButtonElement>('.ai-clarify-skip')!.click())
      expect(onSkip).toHaveBeenCalled()
      cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('has its strings in every locale', () => {
    const dicts = strings as unknown as Record<string, Record<string, string>>
    const keys = ['aiClarifyTitle', 'aiClarifySkip', 'aiClarifySubmit', 'aiToolClarify']
    for (const [lang, dict] of Object.entries(dicts))
      for (const key of keys) expect(dict[key], `${lang}.${key}`).toBeTruthy()
    expect(dicts.vi!.aiClarifyTitle).not.toBe(dicts.en!.aiClarifyTitle)
  })
})
