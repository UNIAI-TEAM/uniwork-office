// @vitest-environment node
/**
 * G8-14 (UNI-1409): Save on a bound presentation with server comments, through the real slides
 * main process. The file's own comments (ppt/comments/*, ppt/commentAuthors.xml) come back
 * byte-identical after a reorder + Save (server comments are never written into the pptx), and the
 * slide identity the anchors use survives the reorder, the Save and a reopen, so the post-save
 * anchor round puts each thread on its slide's new position.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { harness, invoke } from './helpers/slides-ipc-harness'
import { anchorUpdatesAfterSave, pptxAnchorFor } from '../src/renderer/server-comments'

vi.mock('electron', async () => (await import('./helpers/slides-ipc-harness')).electronModule)
vi.mock(
  '@genoffice/electron-utils',
  async () => (await import('./helpers/slides-ipc-harness')).electronUtilsModule,
)
// The OS account must not reach any author: pin it low so its appearance in a
// comment is unmistakable.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), username: 'ubuntu' }) }
})
vi.mock('../src/main/fonts', async () => {
  const { HeuristicMetrics } = await import('@genoffice/pptx-render')
  return {
    createSystemFontMetrics: () => new HeuristicMetrics(),
    resetFontRegistry: () => {},
    registerEmbeddedFonts: () => false,
    listPrivateFontFaces: () => [],
    getPrivateFontData: () => null,
  }
})
vi.mock('../src/main/shaped-metrics', () => ({
  refineComplexWidths: async () => false,
  shapedMetricsReady: async () => {},
}))
vi.mock('../src/main/font-store', () => ({
  downloadFontFamily: async () => {},
  initFontStore: () => {},
  installLocalFontFiles: () => [],
  listFontCatalog: () => [],
  missingCatalogFonts: () => [],
}))
vi.mock('../src/main/ai-ipc', () => ({
  registerAiIpc: () => {},
  registerSlidesOnlyAiIpc: () => {},
}))
vi.mock('../src/main/presenter-show', () => ({ registerPresenterIpc: () => {} }))
vi.mock('../src/main/attachments-ipc', () => ({ registerAttachmentIpc: () => {} }))
vi.mock('../src/main/generated-page-temp', () => ({
  cleanupExpiredGeneratedPages: async () => {},
}))
vi.mock('../src/main/pdf-export', () => ({ exportSlidesPdf: async () => ({ ok: false }) }))
vi.mock('@genoffice/ai-search', () => ({
  gskApiKey: () => '',
  gskSlideGenerate: async () => ({ bytes: new Uint8Array(), model: '' }),
  setGskProxyUrl: () => {},
}))
vi.mock('@genoffice/project-store', () => ({ ProjectStore: class {} }))
vi.mock('@genoffice/pipelines/slides', () => ({
  buildPagePptx: async () => ({ bytes: new Uint8Array(), imageFailures: [] }),
  parsePageSpec: () => ({ ok: false, error: 'not in the harness' }),
}))

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '..', '..', '..', 'packages', 'pptx-engine', 'tests', 'fixtures')
const FIT = 1280

let root = ''
const DECK = (): string => join(root, 'in', 'bound.pptx')
let setUniworkDocumentPolicy: typeof import('../src/main/slides-main').setUniworkDocumentPolicy

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'slides-server-comments-'))
  harness.userData = join(root, 'userData')
  harness.draftsDir = join(root, 'drafts')
  harness.tempDir = join(root, 'temp')
  for (const dir of [harness.userData, harness.draftsDir, harness.tempDir, join(root, 'in')]) {
    mkdirSync(dir, { recursive: true })
  }
  copyFileSync(join(FIXTURES, '01_standard_business.pptx'), DECK())
  const main = await import('../src/main/slides-main')
  setUniworkDocumentPolicy = main.setUniworkDocumentPolicy
  main.registerSlidesIpc()
})

afterEach(() => setUniworkDocumentPolicy(null))

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

/** every comment part of the file, by name, as raw bytes */
async function commentParts(path: string): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const out = new Map<string, string>()
  for (const name of Object.keys(zip.files).sort()) {
    if (zip.files[name]!.dir || !/^ppt\/(comments\/|commentAuthors\.xml)/.test(name)) continue
    out.set(name, Buffer.from(await zip.file(name)!.async('uint8array')).toString('base64'))
  }
  return out
}

type Slides = Array<{ partPath?: string }>

describe('Save of a bound deck with server comments', () => {
  it('reorder then Save: the file comments stay byte-identical and anchors follow slide_id', async () => {
    // a deck that already carries a comment of its own (written while it was a local file)
    expect(await invoke(1, 'slides:open-path', DECK(), FIT)).toBeTruthy()
    expect(
      await invoke(1, 'slides:add-comment', { slideIndex: 1, text: 'comment in the file' }),
    ).toBeTruthy()
    expect(await invoke(1, 'slides:save')).toMatchObject({ ok: true })
    const original = await commentParts(DECK())
    expect(original.size).toBeGreaterThanOrEqual(2)

    // now a bound working copy: the editor keeps server threads on slides 2 and 3
    setUniworkDocumentPolicy({
      isBound: (p: string) => p === DECK(),
      isReadOnly: () => false,
    })
    expect(await invoke(2, 'slides:open-path', DECK(), FIT)).toBeTruthy()
    const before = (await invoke(2, 'slides:get-render-slides')) as Slides
    const threads = [1, 2].map((i) => ({
      id: `t${i}`,
      document_id: 'doc',
      body: 'x',
      anchor: pptxAnchorFor(before, i),
    }))
    expect(threads.every((t) => t.anchor)).toBe(true)

    // slide 3 moves to the front, then Save
    expect(await invoke(2, 'slides:move-slide', { fromIndex: 2, toIndex: 0 })).toBeTruthy()
    expect(await invoke(2, 'slides:save')).toMatchObject({ ok: true })
    expect(await commentParts(DECK())).toEqual(original)

    // after the reopen Save does, the identities still name the same slides
    const reopened = (await invoke(2, 'slides:get-render-slides')) as Slides
    expect(reopened[0]?.partPath).toBe(before[2]?.partPath)
    const round = anchorUpdatesAfterSave(threads, reopened)
    expect(round.map((u) => [u.commentId, u.state, u.anchor.slide_index])).toEqual([
      ['t1', 'exact', 2],
      ['t2', 'exact', 0],
    ])
  })
})
