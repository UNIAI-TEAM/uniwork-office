// Shared fixture for the G6-12 #5 tests: the five side-state AI tools wired to
// in-memory stores standing in for the App's React state.
import { Editor } from '@tiptap/core'
import { sectionFromSectPr, type SectionInfo } from '@genoffice/docx-engine'
import { editorExtensions } from '../../src/renderer/editor/extensions'
import { describeSection, type AiPageSetupAccess } from '../../src/renderer/ai/page-setup'
import {
  executeTool,
  type AiCommentsAccess,
  type AiDocExtras,
  type AiHeaderFooterAccess,
  type ToolExecution,
} from '../../src/renderer/ai/tools'

/** a get/set pair over one value, the shape the rollback snapshot reads and writes */
export interface Store<T> {
  value: T
  get(): unknown
  set(value: unknown): void
}

const NUM_IDS = { bullet: null, ordered: null }
const LETTER_SECT_PR =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>'

const editors: Editor[] = []
/** call from afterEach in the test file */
export function destroyEditors(): void {
  for (const e of editors.splice(0)) e.destroy()
}
export function createEditor(text = 'Body'): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'docParagraph', attrs: { docxIndex: null }, content: [{ type: 'text', text }] },
      ],
    },
  })
  editors.push(editor)
  return editor
}

/** an in-memory store standing in for the App's React state */
export function store<T>(initial: T): Store<T> {
  const s = {
    value: initial,
    get: () => s.value,
    set: (v: unknown) => {
      s.value = v as T
    },
  }
  return s
}

export async function call(
  editor: Editor,
  name: string,
  input: Record<string, unknown>,
  access: {
    comments?: AiCommentsAccess
    hf?: AiHeaderFooterAccess
    pageSetup?: AiPageSetupAccess
    extras?: AiDocExtras
  },
): Promise<ToolExecution> {
  return executeTool(
    editor,
    { id: 't1', name, input },
    NUM_IDS,
    undefined,
    undefined,
    null,
    access.comments,
    access.hf,
    undefined,
    access.pageSetup,
    access.extras,
  )
}

/** the five tools wired to the in-memory stores the rollback snapshot covers */
export function fixture() {
  const comments = store([{ id: 'c1', author: 'A', text: 'fix', done: false }])
  const header = store<Record<string, string>>({})
  const styles = store<Record<string, unknown>>({})
  const watermark = store<unknown>(null)
  const sections = store<SectionInfo[]>([sectionFromSectPr(LETTER_SECT_PR, 0, 0)])
  const docKey = { current: {} as object }
  const access = {
    comments: {
      list: () => comments.value as never,
      reply: () => true,
      resolve: (id: string) => {
        comments.value = comments.value.map((c) => (c.id === id ? { ...c, done: true } : c))
        return true
      },
    } satisfies AiCommentsAccess,
    hf: {
      read: () => ({
        header: header.value['header'] ?? '',
        footer: header.value['footer'] ?? '',
        headerFirst: null,
        footerFirst: null,
        headerEven: null,
        footerEven: null,
        titlePg: false,
        evenOddHf: false,
        multiSection: false,
      }),
      set: (kind: string, _view: string, text: string) => {
        header.value = { ...header.value, [kind]: text }
        return null
      },
    } as AiHeaderFooterAccess,
    pageSetup: {
      list: () => sections.value.map((s, i) => describeSection(s, i, 0, 0)),
      current: (i: number) => sections.value[i],
      set: (index: number, resolved) => {
        sections.value = sections.value.map((s, i) =>
          i === index ? { ...s, settings: resolved.settings } : s,
        )
        return null
      },
      insertBreak: () => null,
    } satisfies AiPageSetupAccess,
    extras: {
      styles: {
        list: () => [{ styleId: 'Normal', name: 'Normal', type: 'paragraph' as const }],
        upsert: (up: { styleId: string }) => {
          styles.value = { ...styles.value, [up.styleId]: up }
          return null
        },
      },
      watermark: {
        current: () => null,
        set: (spec: unknown) => {
          watermark.value = spec
          return null
        },
      },
    } as AiDocExtras,
  }
  return { comments, header, styles, watermark, sections, docKey, access }
}

export const RUNS: Array<[string, Record<string, unknown>]> = [
  ['resolve_comment', { id: 'c1' }],
  ['set_header_footer', { kind: 'header', text: 'AI header' }],
  ['define_style', { styleId: 'Callout', basedOn: 'Normal', run: { italic: true } }],
  ['set_page_setup', { paper: 'A4' }],
  ['set_watermark', { text: 'DRAFT' }],
]
