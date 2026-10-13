// @vitest-environment node
/**
 * G8-02 (UNI-1397): the author a slide comment carries comes from the host's
 * single source — the signed-in UniWork display name for a bound deck, else
 * the neutral constant "User". It is never the OS account name (pinned here to
 * "ubuntu" so a regression that reads the OS account shows up), and the value
 * reaches the saved pptx: ppt/commentAuthors.xml, read back through the engine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSlideComments, openPptx } from '@genoffice/pptx-engine'
import { harness, invoke } from './helpers/slides-ipc-harness'

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
const NEUTRAL = 'User'
const DISPLAY_NAME = 'Nguyễn An'

let root = ''
const LOCAL_DECK = (): string => join(root, 'in', 'local.pptx')
const BOUND_DECK = (): string => join(root, 'in', 'bound.pptx')
let setUniworkDocumentPolicy: typeof import('../src/main/slides-main').setUniworkDocumentPolicy

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'slides-comment-author-'))
  harness.userData = join(root, 'userData')
  harness.draftsDir = join(root, 'drafts')
  harness.tempDir = join(root, 'temp')
  for (const dir of [harness.userData, harness.draftsDir, harness.tempDir, join(root, 'in')]) {
    mkdirSync(dir, { recursive: true })
  }
  for (const deck of [LOCAL_DECK(), BOUND_DECK()]) {
    copyFileSync(join(FIXTURES, '01_standard_business.pptx'), deck)
  }
  const main = await import('../src/main/slides-main')
  setUniworkDocumentPolicy = main.setUniworkDocumentPolicy
  main.registerSlidesIpc()
})

afterEach(() => setUniworkDocumentPolicy(null))

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

/** Open a deck, comment on slide 1, save, and read the authors back from the file. */
async function commentAndReadBack(
  wc: number,
  path: string,
): Promise<{ live: string[]; saved: string[] }> {
  expect(await invoke(wc, 'slides:open-path', path, FIT)).toBeTruthy()
  expect(
    await invoke(wc, 'slides:add-comment', { slideIndex: 0, text: 'G8-02 author' }),
  ).toBeTruthy()
  const comments = (await invoke(wc, 'slides:get-comments', 0)) as Array<{ author: string }>
  expect(await invoke(wc, 'slides:save')).toMatchObject({ ok: true })
  const reopened = await openPptx(new Uint8Array(readFileSync(path)))
  const saved = reopened.deck.slides.flatMap((slide) =>
    getSlideComments(reopened.archive, slide.path).map((comment) => comment.author),
  )
  return { live: comments.map((comment) => comment.author), saved }
}

describe('slide comment author', () => {
  it('a local deck (no UniWork policy) writes the neutral constant, not the OS account', async () => {
    const { live, saved } = await commentAndReadBack(1, LOCAL_DECK())
    expect(live).toEqual([NEUTRAL])
    expect(saved).toEqual([NEUTRAL])
    expect(saved).not.toContain('ubuntu')
  })

  it('a bound deck writes the signed-in UniWork display name', async () => {
    setUniworkDocumentPolicy({
      isBound: (path: string) => path === BOUND_DECK(),
      isReadOnly: () => false,
      commentAuthor: (path: string) => (path === BOUND_DECK() ? DISPLAY_NAME : NEUTRAL),
    })
    const { live, saved } = await commentAndReadBack(2, BOUND_DECK())
    expect(live).toEqual([DISPLAY_NAME])
    expect(saved).toEqual([DISPLAY_NAME])
    expect(saved).not.toContain('ubuntu')
  })
})
