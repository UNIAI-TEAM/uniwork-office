// G6-09 W8 (docs): after an AI run changed a never-saved document the panel asks before anything
// is written: one shared ask card (AiSaveDraftCard) under the answer with the name the first save
// would use; Save runs the normal first save with that name, Not now leaves the document unsaved,
// a new run replaces an unanswered card, a titled document gets no card. App and panel talk
// through window events (the run-done event carries offerSave; Save fires the save-offer event).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { AI_SAVE_DRAFT_LABELS } from '@genoffice/ui'
import {
  AI_RUN_DONE_EVENT,
  AI_SAVE_OFFER_EVENT,
  type AiRunDoneDetail,
  type AiSaveOfferDetail,
} from '../src/renderer/ai/save-offer'
import { firstSaveName } from '../src/renderer/file-actions'
import { t } from '../src/renderer/i18n/locale'
import {
  createDocsEditor,
  mountDocsAiPanel,
  type DocsAiHarness,
} from './helpers/docs-ai-run-harness'

const BOLD = {
  name: 'apply_ops',
  input: { ops: [{ op: 'setFont', target: { blockIndexes: [0] }, bold: true }] },
}
const labels = AI_SAVE_DRAFT_LABELS.zh

let h: DocsAiHarness | null = null
let offered: string | null
let runDone: AiRunDoneDetail[]
let saves: AiSaveOfferDetail[]
const onRunDone = (e: Event) => {
  const detail = (e as CustomEvent<AiRunDoneDetail>).detail
  runDone.push(detail)
  // the App's side: untitled + changed -> offer the first-save name
  if (detail.mutated && offered !== null) detail.offerSave(offered)
}
const onSaveOffer = (e: Event) => saves.push((e as CustomEvent<AiSaveOfferDetail>).detail)

beforeEach(() => {
  localStorage.removeItem('ai-docs-track-changes')
  offered = 'Quarterly report.docx'
  runDone = []
  saves = []
  window.addEventListener(AI_RUN_DONE_EVENT, onRunDone)
  window.addEventListener(AI_SAVE_OFFER_EVENT, onSaveOffer)
})
afterEach(() => {
  window.removeEventListener(AI_RUN_DONE_EVENT, onRunDone)
  window.removeEventListener(AI_SAVE_OFFER_EVENT, onSaveOffer)
  h?.cleanup()
  h = null
})

const card = () => h!.container.querySelector<HTMLElement>('.ai-save-draft')

async function editRun(): Promise<void> {
  await h!.send('bold the title')
  await h!.toolTurn([BOLD])
  await h!.textTurn('Done.')
}

describe('docs: ask before saving an untitled document after an AI run', () => {
  it('shows one card with the suggested name and writes nothing before the click', async () => {
    h = await mountDocsAiPanel(['Quarterly report', 'body'], { filePath: null })
    await editRun()
    expect(runDone.map((d) => d.mutated)).toEqual([true])
    expect(h.container.querySelectorAll('.ai-save-draft')).toHaveLength(1)
    expect(card()!.textContent).toContain(labels.saveAs('Quarterly report.docx'))
    expect(saves).toEqual([])
  })

  it('Save asks the App to save once with that name, and the card goes', async () => {
    h = await mountDocsAiPanel(['Quarterly report', 'body'], { filePath: null })
    await editRun()
    await act(async () => card()!.querySelector<HTMLButtonElement>('.ai-save-draft-save')!.click())
    expect(saves).toEqual([{ name: 'Quarterly report.docx' }])
    expect(card()).toBeNull()
  })

  it('Not now dismisses the card and saves nothing', async () => {
    h = await mountDocsAiPanel(['Quarterly report', 'body'], { filePath: null })
    await editRun()
    await act(async () => card()!.querySelector<HTMLButtonElement>('.ai-save-draft-later')!.click())
    expect(card()).toBeNull()
    expect(saves).toEqual([])
  })

  it('a new run replaces an unanswered card', async () => {
    h = await mountDocsAiPanel(['Quarterly report', 'body'], { filePath: null })
    await editRun()
    await h.send('and again')
    expect(card(), 'the card goes when the next run starts').toBeNull()
    // a change of its own (bold again would change nothing)
    await h.toolTurn([
      {
        name: 'apply_ops',
        input: { ops: [{ op: 'setFont', target: { blockIndexes: [1] }, italic: true }] },
      },
    ])
    await h.textTurn('Done.')
    expect(h.container.querySelectorAll('.ai-save-draft')).toHaveLength(1)
  })

  it('a run that changed nothing reports mutated=false and gets no card', async () => {
    h = await mountDocsAiPanel(['Quarterly report', 'body'], { filePath: null })
    await h.send('what is this?')
    await h.textTurn('A report.')
    expect(runDone.map((d) => d.mutated)).toEqual([false])
    expect(card()).toBeNull()
  })

  it('a titled document gets no card (the App offers nothing)', async () => {
    offered = null
    h = await mountDocsAiPanel(['Quarterly report', 'body'])
    await editRun()
    expect(card()).toBeNull()
  })

  it('the card is reachable by keyboard and takes no focus when it appears', async () => {
    h = await mountDocsAiPanel(['Quarterly report', 'body'], { filePath: null })
    const before = document.activeElement
    await editRun()
    expect(document.activeElement).toBe(before)
    const save = card()!.querySelector<HTMLButtonElement>('.ai-save-draft-save')!
    save.focus()
    expect(document.activeElement).toBe(save)
  })
})

describe('docs first-save name', () => {
  const ctx = (texts: string[], doc: { filePath: string | null; fileName: string }) => {
    const editor = createDocsEditor([])
    editor.commands.setContent({
      type: 'doc',
      content: texts.map((text, i) =>
        i === 0
          ? { type: 'docHeading', attrs: { level: 1 }, content: [{ type: 'text', text }] }
          : { type: 'docParagraph', content: [{ type: 'text', text }] },
      ),
    })
    return { editor, ctx: { editor, doc } as unknown as Parameters<typeof firstSaveName>[0] }
  }

  it('an untitled document takes the first heading, as its first save does', () => {
    const { editor, ctx: c } = ctx(['Quarterly report', 'body'], {
      filePath: null,
      fileName: t('appUntitledDocx'),
    })
    try {
      expect(firstSaveName(c)).toBe('Quarterly report.docx')
    } finally {
      editor.destroy()
    }
  })

  it('a titled document has no first-save name', () => {
    const { editor, ctx: c } = ctx(['Quarterly report'], {
      filePath: '/docs/a.docx',
      fileName: 'a.docx',
    })
    try {
      expect(firstSaveName(c)).toBeNull()
    } finally {
      editor.destroy()
    }
  })
})

describe('App wiring', () => {
  it('the run-done listener no longer saves by itself', () => {
    const app = readFileSync(join(__dirname, '../src/renderer/App.tsx'), 'utf8')
    const at = app.indexOf('addEventListener(AI_RUN_DONE_EVENT')
    expect(at, 'App listens to the run-done event').toBeGreaterThan(0)
    const effect = app.slice(app.lastIndexOf('useEffect(', at), at)
    expect(effect).toContain('offerSave(')
    expect(effect).not.toMatch(/save\(false, true\)/)
    expect(app).toContain('addEventListener(AI_SAVE_OFFER_EVENT')
  })
})
