// A view-only document (a UniWork member copy, an encrypted file) gives the
// assistant no way to edit it: read-only tools only, and the reason is shown.
// The PDF app has no AutoSave switch; its autosave paths are gated in
// uniwork-save.test.ts (main refuses origin 'auto' on a bound file).
import { beforeAll, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { READ_ONLY_TOOLS, createPdfSkill } from '../src/renderer/ai/pdf-skill'
import { AGENT_TOOLS } from '../src/renderer/ai/tools'
import type { PdfAiDeps } from '../src/renderer/ai/tools'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { strings } from '../src/renderer/i18n/strings'

function makeDeps(readOnly: boolean): PdfAiDeps {
  const target: Record<string, unknown> = {
    fileName: () => 'doc.pdf',
    pageCount: () => 3,
    currentPage: () => 1,
    readOnly: () => readOnly,
    imageGenAvailable: () => true,
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

describe('assistant tools on a view-only document', () => {
  it('keeps only read-only tools and says the document is view-only', () => {
    const skill = createPdfSkill(makeDeps(true))
    const names = skill.tools.map((t) => t.name)
    expect(names).toContain('read_pages')
    expect(names).toContain('search_text')
    expect(names.every((n) => READ_ONLY_TOOLS.has(n))).toBe(true)
    for (const editing of [
      'markup_text',
      'edit_text',
      'insert_text',
      'apply_ops',
      'insert_blank_page',
      'replace_pages',
      'set_watermark',
    ]) {
      expect(names).not.toContain(editing)
    }
    expect(skill.systemPrompt).toContain('view-only')
  })

  it('refuses an edit tool call before it reaches the document', async () => {
    const skill = createPdfSkill(makeDeps(true))
    const exec = await skill.executeTool({
      id: 't1',
      name: 'markup_text',
      input: { page: 1, text: 'hello', type: 'highlight' },
    })
    expect(exec.isError).toBe(true)
    expect(exec.mutated).toBeFalsy()
    expect(exec.output).toContain('view-only')
  })

  it('keeps the full tool set on an editable document', () => {
    const skill = createPdfSkill(makeDeps(false))
    expect(skill.tools.map((t) => t.name)).toContain('markup_text')
    expect(skill.systemPrompt).not.toContain('view-only')
  })

  it('only allowlists tools that exist', () => {
    const all = new Set(AGENT_TOOLS.map((t) => t.name))
    for (const name of READ_ONLY_TOOLS) expect(all.has(name), name).toBe(true)
  })
})

describe('assistant panel notice', () => {
  beforeAll(() => {
    Element.prototype.scrollTo ??= () => {}
  })

  function render(readOnly: boolean) {
    const api = new Proxy(
      { fileName: () => 'doc.pdf', readOnly: () => readOnly },
      { get: (t, p: string) => (p in t ? (t as never)[p] : () => null) },
    )
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(AiPanel, { api: api as never, onCollapse: () => {}, open: true, readOnly }),
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

  it('shows the reason above the composer only when view-only', () => {
    const view = render(true)
    expect(view.container.querySelector('.ai-readonly-notice')).not.toBeNull()
    view.cleanup()
    const edit = render(false)
    expect(edit.container.querySelector('.ai-readonly-notice')).toBeNull()
    edit.cleanup()
  })
})

describe('view-only AI notice strings', () => {
  const dicts = strings as unknown as Record<string, Record<string, string>>

  it('is English in en and Vietnamese in vi', () => {
    expect(dicts.en!.aiViewOnlyNotice).toContain('View-only')
    expect(dicts.vi!.aiViewOnlyNotice).toContain('chỉ xem')
  })

  it('is translated in every shipped locale', () => {
    const en = dicts.en!.aiViewOnlyNotice
    const missing = Object.entries(dicts)
      .filter(([lang]) => lang !== 'en')
      .filter(([, dict]) => !dict.aiViewOnlyNotice || dict.aiViewOnlyNotice === en)
      .map(([lang]) => lang)
    expect(missing).toEqual([])
  })
})
