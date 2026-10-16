// G6-09 W3: Roll back after a Save in the middle of a run. A save re-reads the file, so the
// state beside the text (header/footer, styles, page setup, watermark, comments) the run changed
// can no longer be put back; the panel says which parts stayed instead of restoring silently in
// part. Without a save, Roll back restores everything and says nothing.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import type { Lang } from '@genoffice/i18n'
import { createAiSideState, sidePartOf } from '../src/renderer/ai/run-snapshot'
import { t } from '../src/renderer/i18n/locale'
import { fixture } from './helpers/g6-12-side-fixture'
import { mountDocsAiPanel, type DocsAiHarness } from './helpers/docs-ai-run-harness'

const BOLD = {
  name: 'apply_ops',
  input: { ops: [{ op: 'setFont', target: { blockIndexes: [0] }, bold: true }] },
}
const HEADER = { name: 'set_header_footer', input: { kind: 'header', text: 'AI header' } }
const WATERMARK = { name: 'set_watermark', input: { text: 'DRAFT' } }

let h: DocsAiHarness | null = null
beforeEach(() => localStorage.removeItem('ai-docs-track-changes'))
afterEach(() => {
  h?.cleanup()
  h = null
})

async function mountWired(lang?: Lang) {
  const f = fixture()
  const sideState = createAiSideState(
    {
      comments: f.comments,
      header: f.header,
      styles: f.styles,
      watermark: f.watermark,
      sections: f.sections,
    },
    () => f.docKey.current,
  )
  h = await mountDocsAiPanel(['first block', 'second block'], {
    sideState,
    commentsAccess: f.access.comments,
    hfAccess: f.access.hf,
    pageSetupAccess: f.access.pageSetup,
    docExtras: f.access.extras,
    lang,
  })
  return f
}

/** what a save does to the side state: the pre-save event, then every slice re-read from the file */
async function save(f: ReturnType<typeof fixture>): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event('ai-docs-commit-tables'))
  })
  f.docKey.current = {}
  f.header.value = { ...f.header.value }
  f.watermark.value = f.watermark.value === null ? null : { ...(f.watermark.value as object) }
  f.sections.value = f.sections.value.map((s) => ({ ...s }))
  f.styles.value = { ...f.styles.value }
  f.comments.value = f.comments.value.map((c) => ({ ...c }))
}

async function rollBack(): Promise<void> {
  const btn = h!.container.querySelector<HTMLButtonElement>('.ai-rollback-btn')
  expect(btn, 'Roll back offered').not.toBeNull()
  await act(async () => btn!.click())
}

const notice = () => h!.container.querySelector('.ai-rollback-kept')

describe('Roll back after a mid-run Save (docs)', () => {
  it('names the parts it could not put back: changed before and after the save', async () => {
    const f = await mountWired()
    await h!.send('add a header, bold the title, then a watermark')
    await h!.toolTurn([HEADER, BOLD])
    await save(f)
    await h!.toolTurn([WATERMARK])
    await h!.textTurn('Done.')

    await rollBack()
    // the text is back...
    expect(h!.editor.state.doc.child(0).firstChild?.marks ?? []).toEqual([])
    // ...the header and watermark stayed, and the panel says so
    expect(f.header.value).toEqual({ header: 'AI header' })
    expect(f.watermark.value).not.toBeNull()
    const el = notice()
    expect(el, 'kept-parts notice').not.toBeNull()
    expect(el!.getAttribute('role')).toBe('status')
    expect(el!.textContent).toBe(
      t('aiRollbackKept', {
        parts: [t('aiSidePartHeaderFooter'), t('aiSidePartWatermark')].join(t('aiSidePartSep')),
      }),
    )
  })

  it('renders the notice and the parts list in the interface language', async () => {
    const f = await mountWired('vi')
    await h!.send('add a header, bold the title, then a watermark')
    await h!.toolTurn([HEADER, BOLD])
    await save(f)
    await h!.toolTurn([WATERMARK])
    await h!.textTurn('Done.')
    await rollBack()
    expect(notice()!.textContent).toBe(
      'Đã khôi phục nội dung. Tài liệu đã được lưu trong lúc AI trả lời nên không khôi phục được các phần sau: đầu trang và chân trang, hình mờ',
    )
  })

  it('a save that came after nothing beside the text changed: no notice', async () => {
    const f = await mountWired()
    await h!.send('bold the title')
    await h!.toolTurn([BOLD])
    await save(f)
    await h!.textTurn('Done.')
    await rollBack()
    expect(h!.editor.state.doc.child(0).firstChild?.marks ?? []).toEqual([])
    expect(notice()).toBeNull()
  })

  it('an older run rolled back after saves: names what later runs changed and a save kept', async () => {
    const f = await mountWired()
    await h!.send('bold the title')
    await h!.toolTurn([BOLD])
    await h!.textTurn('Done.')
    // an autosave between the runs
    await save(f)
    await h!.send('add a header')
    await h!.toolTurn([HEADER])
    // the user's Save in the middle of the second run
    await save(f)
    await h!.textTurn('Done.')

    // the first run's Roll back (the oldest button) rewinds past the second run too
    await rollBack()
    expect(h!.editor.state.doc.child(0).firstChild?.marks ?? []).toEqual([])
    expect(f.header.value).toEqual({ header: 'AI header' })
    expect(notice()?.textContent).toBe(t('aiRollbackKept', { parts: t('aiSidePartHeaderFooter') }))
  })

  it('no save: Roll back restores the header too and shows no notice', async () => {
    const f = await mountWired()
    await h!.send('add a header and bold the title')
    await h!.toolTurn([HEADER, BOLD])
    await h!.textTurn('Done.')
    await rollBack()
    expect(f.header.value).toEqual({})
    expect(notice()).toBeNull()
  })
})

describe('side-state parts', () => {
  it('every slice the App hands to the rollback snapshot belongs to a part the notice can name', () => {
    const app = readFileSync(join(__dirname, '../src/renderer/App.tsx'), 'utf8')
    const block = app.slice(
      app.indexOf('return createAiSideState('),
      app.indexOf('() => fileCtxRef.current.doc,'),
    )
    const names = [...block.matchAll(/^ {8}(\w+): /gm)].map((m) => m[1]!)
    expect(names.length).toBeGreaterThan(20)
    expect(names.filter((n) => sidePartOf(n) === null)).toEqual([])
    expect(sidePartOf('sectionHfEdits')).toBe('headerFooter')
    expect(sidePartOf('sections')).toBe('pageSetup')
    expect(sidePartOf('styleUpserts')).toBe('styles')
  })
})
