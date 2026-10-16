// @vitest-environment jsdom
// "View differences" of the Docs conflict dialog (S5-04): the comparison of my version against the
// head, built in the frame from two real docx byte sets, and its wiring in the web bridge.
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFileResult } from '../../../apps/docs/src/shared/ipc'
import { createWebApi, type WebApi } from './webapi'
import { buildDiff, diffContent } from './conflict-diff'
import { createMockPort, type MockPort } from './testing/mock-port'
import { text } from './notice'
import { webText } from '../../modules/shared/i18n/strings-web'
import { webLanguage } from './browser'

const flush = () => new Promise((r) => setTimeout(r, 0))

/** a minimal but real docx: one paragraph per string */
async function docx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

const asBuffer = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('diffContent', () => {
  it('stats line, a card per difference, unchanged runs collapsed', () => {
    const el = diffContent('Report.docx', [
      { kind: 'same', left: 'a', right: 'a' },
      { kind: 'same', left: 'b', right: 'b' },
      { kind: 'changed', left: 'mine', right: 'theirs' },
      { kind: 'added', right: 'new' },
    ])
    expect(el.querySelector('.ow-dlg-diff-meta')!.textContent).toBe(
      text('appCompareWithPrefix') +
        'Report.docx' +
        text('appCompareStats', { added: 1, removed: 0, changed: 1 }),
    )
    expect(el.querySelector('.ow-dlg-diff-same')!.textContent).toBe(
      text('appCompareSameRun', { n: 2 }),
    )
    const cards = [...el.querySelectorAll<HTMLElement>('.ow-dlg-diff-card')]
    expect(cards.map((c) => c.dataset.kind)).toEqual(['changed', 'added'])
    expect(cards[0]!.querySelector('.ow-dlg-diff-left .ow-dlg-diff-text')!.textContent).toBe('mine')
    expect(cards[0]!.querySelector('.ow-dlg-diff-right .ow-dlg-diff-text')!.textContent).toBe(
      'theirs',
    )
    expect(cards[1]!.querySelector('.ow-dlg-diff-left')).toBeNull()
  })

  it('each card names its side in text: my version = the unsaved bytes, the head = the version on UniWork (UXF-V1-F1)', () => {
    const lang = webLanguage()
    const el = diffContent('Report.docx', [
      { kind: 'changed', left: 'mine', right: 'theirs' },
      { kind: 'removed', left: 'only mine' },
      { kind: 'added', right: 'only theirs' },
    ])
    const sides = (c: HTMLElement) =>
      [...c.querySelectorAll('.ow-dlg-diff-side')].map((n) => n.textContent)
    const cards = [...el.querySelectorAll<HTMLElement>('.ow-dlg-diff-card')]
    expect(sides(cards[0]!)).toEqual([
      webText(lang, 'uwConflictColMine'),
      webText(lang, 'uwConflictColServer'),
    ])
    expect(sides(cards[1]!)).toEqual([webText(lang, 'uwConflictColMine')])
    expect(sides(cards[2]!)).toEqual([webText(lang, 'uwConflictColServer')])
    // the label sits inside its own side, so it follows the text it names in reading order
    expect(cards[0]!.querySelector('.ow-dlg-diff-left')!.textContent).toBe(
      webText(lang, 'uwConflictColMine') + 'mine',
    )
  })

  it('identical documents say so', () => {
    const el = diffContent('Report.docx', [{ kind: 'same', left: 'a', right: 'a' }])
    expect(el.querySelector('.ow-dlg-diff-card')).toBeNull()
    expect(el.textContent).toContain(text('appCompareIdentical'))
  })
})

describe('buildDiff', () => {
  it('compares the paragraphs of two docx files', async () => {
    const el = await buildDiff(
      asBuffer(await docx(['Intro', 'Mine only', 'Tail'])),
      asBuffer(await docx(['Intro', 'Theirs only', 'Tail'])),
      'Report.docx',
    )
    const card = el.querySelector<HTMLElement>('.ow-dlg-diff-card')!
    expect(card.dataset.kind).toBe('changed')
    expect(card.querySelector('.ow-dlg-diff-left .ow-dlg-diff-text')!.textContent).toBe('Mine only')
    expect(card.querySelector('.ow-dlg-diff-right .ow-dlg-diff-text')!.textContent).toBe(
      'Theirs only',
    )
  })

  it('a file that is not a docx gives the failure line, never a throw', async () => {
    const el = await buildDiff(new Uint8Array([1, 2, 3]).buffer, new Uint8Array([4]).buffer, 'x')
    // one localized sentence, no raw parser message in the copy; the error goes to the log
    expect(el.textContent).toBe(webText(webLanguage(), 'uwConflictDiffFailed'))
    expect(el.querySelector('.ow-dlg-diff-card')).toBeNull()
    const logged = vi.mocked(console.warn).mock.calls.flat()
    const err = logged.find((a): a is Error => a instanceof Error)
    expect(err, 'the error is logged').toBeDefined()
    expect(el.textContent).not.toContain(err!.message)
  })
})

describe('Docs web frame: save conflict dialog', () => {
  let mock: MockPort
  let api: WebApi
  const t = (key: Parameters<typeof webText>[1]) => webText(webLanguage(), key)

  async function dialog(): Promise<HTMLElement> {
    for (let i = 0; i < 100; i++) {
      const el = document.querySelector<HTMLElement>('[data-docs-web="conflict"]')
      if (el?.querySelector('[data-choice]')) return el
      await flush()
    }
    throw new Error('no conflict dialog')
  }

  it('shows "View differences" before Reload; it opens the comparison against the head and Back returns', async () => {
    mock = createMockPort()
    api = createWebApi(mock.port, { session: { pollMs: 0 } })
    const base = await docx(['Intro', 'Original'])
    const meta = mock.seed('Report.docx', base)
    mock.init({ documentId: meta.fileId })
    const doc = (await api.consumePendingOpenDocx()) as OpenFileResult
    // someone else saved a different second paragraph meanwhile
    mock.commit(meta.fileId, await docx(['Intro', 'Their change']))
    const etagBefore = mock.calls.length
    const pending = api.saveDocx(doc.path, asBuffer(await docx(['Intro', 'My change'])))
    const dlg = await dialog()

    const ids = [...dlg.querySelectorAll<HTMLElement>('[data-choice]')].map((b) => b.dataset.choice)
    expect(ids.indexOf('diff')).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf('diff')).toBeLessThan(ids.indexOf('reload'))
    expect(dlg.querySelector('[data-choice="diff"]')!.textContent).toBe(t('uwConflictViewDiff'))

    dlg.querySelector<HTMLButtonElement>('[data-choice="diff"]')!.click()
    for (let i = 0; i < 100 && !dlg.querySelector('.ow-dlg-diff'); i++) await flush()
    const card = dlg.querySelector<HTMLElement>('.ow-dlg-diff-card')!
    expect(card.querySelector('.ow-dlg-diff-left .ow-dlg-diff-text')!.textContent).toBe('My change')
    expect(card.querySelector('.ow-dlg-diff-right .ow-dlg-diff-text')!.textContent).toBe(
      'Their change',
    )
    expect(card.querySelector('.ow-dlg-diff-left .ow-dlg-diff-side')!.textContent).toBe(
      t('uwConflictColMine'),
    )
    expect(card.querySelector('.ow-dlg-diff-right .ow-dlg-diff-side')!.textContent).toBe(
      t('uwConflictColServer'),
    )
    expect(dlg.querySelector('.ow-dlg-diff-meta')!.textContent).toContain('Report.docx')
    // the comparison is a step of the same dialog: still one dialog, Back returns to step 1
    expect(document.querySelectorAll('[data-docs-web="conflict"]')).toHaveLength(1)
    dlg.querySelector<HTMLButtonElement>('[data-choice="back"]')!.click()
    await flush()
    expect(dlg.querySelector('[data-choice="diff"]')).not.toBeNull()
    expect(dlg.querySelector('[data-choice="reload"]')).not.toBeNull()
    // reading the head for the comparison is read-only: nothing was saved
    expect(mock.saved).toHaveLength(0)
    expect(etagBefore).toBeGreaterThan(0)

    dlg.querySelector<HTMLButtonElement>('[data-choice="cancel"]')!.click()
    expect((await pending).ok).toBe(false)
  })
})
