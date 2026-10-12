// G6-12 (UNI-1366) C-ASK for pdf: ask_clarification (same input schema as html),
// the questionnaire card, the panel-side hook that blocks the run until the user
// answers, and the pdf i18n keys.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AGENT_TOOLS as HTML_TOOLS } from '../../html/src/renderer/ai/tools'
import { READ_ONLY_TOOLS, createPdfSkill } from '../src/renderer/ai/pdf-skill'
import { AGENT_TOOLS, executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'
import { ClarifyCard } from '../src/renderer/ai/ClarifyCard'
import { useClarify } from '../src/renderer/ai/use-clarify'
import { strings } from '../src/renderer/i18n/strings'

function makeDeps(over: Record<string, unknown> = {}): PdfAiDeps {
  const target: Record<string, unknown> = {
    fileName: () => 'doc.pdf',
    pageCount: () => 2,
    readOnly: () => false,
    imageGenAvailable: () => true,
    uniworkBound: () => false,
    ...over,
  }
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      return () => {
        throw new Error(`unexpected deps call: ${prop}`)
      }
    },
  }) as unknown as PdfAiDeps
}

const ask = (questions: unknown) => ({ id: 'c1', name: 'ask_clarification', input: { questions } })
const QUESTIONS = [{ id: 'scope', label: 'Which pages?', options: ['All', 'Selection'] }]

describe('ask_clarification tool definition', () => {
  const pdfDef = AGENT_TOOLS.find((t) => t.name === 'ask_clarification')
  const htmlDef = HTML_TOOLS.find((t) => t.name === 'ask_clarification')!

  it('exists with the same input schema as html, byte for byte', () => {
    expect(pdfDef).toBeDefined()
    expect(JSON.stringify(pdfDef!.inputSchema)).toBe(JSON.stringify(htmlDef.inputSchema))
  })

  it('has its own description aimed at meaning/scope, not at creating pages', () => {
    expect(pdfDef!.description).not.toBe(htmlDef.description)
    expect(pdfDef!.description).not.toMatch(/plan_page/)
    expect(pdfDef!.description).toMatch(/scope|meaning|target/i)
  })
})

describe('ask_clarification execution', () => {
  it('hands the answers back to the model and declares mutated: false', async () => {
    let seen: Array<{ id: string; options: string[] }> = []
    const deps = makeDeps({
      askClarification: async (qs: typeof seen) => {
        seen = qs
        return { answers: 'Which pages?: All' }
      },
    })
    const r = await executePdfTool(
      deps,
      ask([
        ...QUESTIONS,
        { label: 'no id', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
        { id: 'empty', label: 'no options', options: [] },
      ]),
    )
    expect(r.isError).toBeFalsy()
    expect(r.output).toContain('User answers:\nWhich pages?: All')
    expect(r.mutated).toBe(false)
    expect(seen).toHaveLength(2)
    expect(seen[1]!.id).toBe('q2')
    expect(seen[1]!.options).toHaveLength(5)
  })

  it('reports a skip exactly like html and still declares mutated: false', async () => {
    const deps = makeDeps({ askClarification: async () => ({ answers: '', cancelled: true }) })
    const r = await executePdfTool(deps, ask(QUESTIONS))
    expect(r.isError).toBeFalsy()
    expect(r.output).toMatch(/skipped/)
    expect(r.mutated).toBe(false)
  })

  it('errors when the card is unavailable or no question has options', async () => {
    const none = await executePdfTool(makeDeps({ askClarification: undefined }), ask(QUESTIONS))
    expect(none.isError).toBe(true)
    expect(none.mutated).toBe(false)
    const empty = await executePdfTool(
      makeDeps({ askClarification: async () => ({ answers: '' }) }),
      ask([{ id: 'x', label: 'q', options: [] }]),
    )
    expect(empty.isError).toBe(true)
    expect(empty.mutated).toBe(false)
  })

  it('passes the run signal to the card so a stop can dismiss it', async () => {
    const askClarification = vi.fn(async () => ({ answers: 'a' }))
    const controller = new AbortController()
    await executePdfTool(makeDeps({ askClarification }), ask(QUESTIONS), controller.signal)
    expect(askClarification.mock.calls[0]![1]).toBe(controller.signal)
  })
})

describe('ask_clarification in the skill', () => {
  it('is offered on an editable document, also when bound', () => {
    expect(createPdfSkill(makeDeps()).tools.map((t) => t.name)).toContain('ask_clarification')
    expect(
      createPdfSkill(makeDeps({ uniworkBound: () => true })).tools.map((t) => t.name),
    ).toContain('ask_clarification')
  })

  it('is dropped on a view-only document (same as html) and refused if called', async () => {
    const deps = makeDeps({ readOnly: () => true })
    expect(createPdfSkill(deps).tools.map((t) => t.name)).not.toContain('ask_clarification')
    expect(READ_ONLY_TOOLS.has('ask_clarification')).toBe(false)
    const r = await createPdfSkill(deps).executeTool(ask(QUESTIONS))
    expect(r.isError).toBe(true)
  })
})

let root: Root | null = null
let host: HTMLElement | null = null
function mount(el: ReactElement): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(el))
  return host
}
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('ClarifyCard', () => {
  const MULTI = [{ id: 'f', label: 'Which parts?', options: ['Intro', 'Totals'], multi: true }]

  it('submits the picked option and the free-text "other" as "question: answer"', () => {
    const onSubmit = vi.fn()
    const el = mount(createElement(ClarifyCard, { questions: MULTI, onSubmit, onSkip: () => {} }))
    const opts = el.querySelectorAll<HTMLButtonElement>('button.ai-clarify-opt')
    act(() => opts[1]!.click())
    const other = el.querySelector<HTMLInputElement>('input.ai-clarify-other')!
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(other, 'page 4 only')
      other.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => el.querySelector<HTMLButtonElement>('button.ai-clarify-submit')!.click())
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0]![0]).toBe('Which parts?: Totals、page 4 only')
    expect(onSubmit.mock.calls[0]![1]).toEqual([{ q: 'Which parts?', a: 'Totals、page 4 only' }])
  })

  it('has a skip button and offers "decide for me" after the options', () => {
    const onSkip = vi.fn()
    const el = mount(createElement(ClarifyCard, { questions: MULTI, onSubmit: vi.fn(), onSkip }))
    expect(el.querySelectorAll('button.ai-clarify-opt')).toHaveLength(3)
    act(() => el.querySelector<HTMLButtonElement>('button.ai-clarify-skip')!.click())
    expect(onSkip).toHaveBeenCalledOnce()
  })
})

describe('useClarify (panel side of the blocking card)', () => {
  type Api = ReturnType<typeof useClarify>
  function probe(): { api: () => Api } {
    let current: Api | null = null
    function Probe() {
      current = useClarify()
      return null
    }
    mount(createElement(Probe))
    return { api: () => current! }
  }
  const Q = QUESTIONS.map((q) => ({ ...q, description: undefined, multi: false }))

  it('shows the card until the user answers, then resolves with the answers and a receipt', async () => {
    const p = probe()
    let reply: unknown = null
    act(() => {
      void p
        .api()
        .ask(Q)
        .then((r) => (reply = r))
    })
    expect(p.api().active).toEqual(Q)
    await act(async () => p.api().submit('Which pages?: All', [{ q: 'Which pages?', a: 'All' }], 3))
    expect(reply).toEqual({ answers: 'Which pages?: All' })
    expect(p.api().active).toBeNull()
    expect(p.api().receipts).toEqual([{ afterIdx: 3, qa: [{ q: 'Which pages?', a: 'All' }] }])
  })

  it('skip, dismiss (stop / new chat) and an aborted run all resolve as cancelled', async () => {
    const p = probe()
    const replies: unknown[] = []
    act(() => {
      void p
        .api()
        .ask(Q)
        .then((r) => replies.push(r))
    })
    await act(async () => p.api().skip())
    act(() => {
      void p
        .api()
        .ask(Q)
        .then((r) => replies.push(r))
    })
    await act(async () => p.api().dismiss())
    const controller = new AbortController()
    act(() => {
      void p
        .api()
        .ask(Q, controller.signal)
        .then((r) => replies.push(r))
    })
    await act(async () => controller.abort())
    expect(replies).toEqual(Array(3).fill({ answers: '', cancelled: true }))
    expect(p.api().active).toBeNull()
  })

  it('answers an already-aborted run immediately without opening a card', async () => {
    const p = probe()
    const controller = new AbortController()
    controller.abort()
    const r = await p.api().ask(Q, controller.signal)
    expect(r).toEqual({ answers: '', cancelled: true })
    expect(p.api().active).toBeNull()
  })
})

describe('questionnaire strings', () => {
  const dicts = strings as unknown as Record<string, Record<string, string>>
  const KEYS = [
    'aiClarifyTitle',
    'aiClarifyDecide',
    'aiClarifyDecideAnswer',
    'aiClarifyMulti',
    'aiClarifyNext',
    'aiClarifyPrev',
    'aiClarifyOther',
    'aiClarifySelected',
    'aiClarifySkip',
    'aiClarifySubmit',
    'aiToolClarify',
    'aiToolClarifySkipped',
  ]

  it.each(Object.keys(dicts))('locale %s defines every questionnaire key', (lang) => {
    for (const key of KEYS) expect(dicts[lang]![key], `${lang}.${key}`).toBeTruthy()
  })

  it('is translated, not English, in the other locales', () => {
    for (const key of ['aiClarifyTitle', 'aiClarifySkip', 'aiClarifySubmit', 'aiToolClarify']) {
      const missing = Object.entries(dicts)
        .filter(([lang]) => lang !== 'en')
        .filter(([, dict]) => dict[key] === dicts.en![key])
        .map(([lang]) => lang)
      expect(missing, key).toEqual([])
    }
  })

  it('keeps the {n} placeholder of the selected counter in every locale', () => {
    for (const [lang, dict] of Object.entries(dicts)) {
      expect(dict.aiClarifySelected, lang).toContain('{n}')
    }
  })
})
