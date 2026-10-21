/**
 * UNI-1993 (UW-SOURCE-RO) contract 3.7 item 3: a source view is a temporary
 * plaintext copy, not a file the user opened, so it never reaches a recent-files
 * list. The temp file lives under the draft-preview root on purpose: the three
 * existing recents guards (shell index.ts, docs-main, slides-main) all test
 * `isDraftPreviewPath`, so they apply with no change to any editor.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DRAFT_PREVIEW_DIR, isDraftPreviewPath } from '@genoffice/electron-utils/draft-preview'
import { SourceViewRegistry, createSourceViewOpener } from '../src/main/uniwork-docs/source-view'

// paths are relative to apps/
const SRC = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

let userData = ''
afterEach(() => rmSync(userData, { recursive: true, force: true }))

async function openOne(name: string, extension: string): Promise<string> {
  userData = mkdtempSync(join(tmpdir(), 'uw-source-recents-'))
  const registry = new SourceViewRegistry()
  const opener = createSourceViewOpener({
    previewRoot: join(userData, DRAFT_PREVIEW_DIR),
    startupSweep: Promise.resolve(),
    registry,
    identity: () => ({ deploymentId: 'd' }),
    profile: () => ({ deploymentId: 'd' }),
    storeLocked: () => false,
    documentMaxBytes: () => 1e9,
    downloadSource: async () => ({ bytes: new Uint8Array([1]) }),
    openPath: () => true,
    isPathOpen: () => false,
  })
  const res = await opener.openSource({
    workspaceId: 'w',
    sourceId: 'chat:1',
    name,
    extension,
    mimeType: '',
    sizeBytes: 1,
    updatedAt: 't',
    origin: 'chat',
    parent: { kind: 'chat_channel', title: 'x' },
  })
  opener.disposeSync()
  if (!res.ok) throw new Error(res.error)
  return res.value.path
}

describe('a source view path is never a recent file', () => {
  it.each([
    ['Plan.docx', 'docx'],
    ['Data.xlsx', 'xlsx'],
    ['Deck.pptx', 'pptx'],
    ['Paper.pdf', 'pdf'],
    ['Notes.md', 'md'],
    ['Page.html', 'html'],
    ['Log.txt', 'txt'],
  ])('isDraftPreviewPath is true for the temp copy of %s', async (name, extension) => {
    const path = await openOne(name, extension)
    expect(isDraftPreviewPath(userData, path)).toBe(true)
  })

  it('the three recents writers test isDraftPreviewPath before they record', () => {
    const shell = SRC('shell/src/main/index.ts')
    const guard = shell.slice(shell.indexOf('function recordRecentFile('))
    expect(guard.slice(0, guard.indexOf('function routeDocumentPath('))).toContain(
      "if (isDraftPreviewPath(app.getPath('userData'), filePath)) return",
    )
    const docs = SRC('docs/src/main/docs-main.ts')
    const pushDocs = docs.slice(docs.indexOf('function pushRecent('))
    expect(pushDocs.slice(0, 400)).toContain(
      "if (isDraftPreviewPath(app.getPath('userData'), filePath)) return",
    )
    const slides = SRC('slides/src/main/slides-main.ts')
    const pushSlides = slides.slice(slides.indexOf('async function pushRecent('))
    expect(pushSlides.slice(0, 400)).toContain(
      "if (isDraftPreviewPath(app.getPath('userData'), path)) return",
    )
  })

  it('the source folder sits under the draft-preview root, not beside it', async () => {
    const path = await openOne('Plan.docx', 'docx')
    expect(
      path.startsWith(
        join(userData, DRAFT_PREVIEW_DIR) + (process.platform === 'win32' ? '\\' : '/'),
      ),
    ).toBe(true)
    expect(path.includes(`${DRAFT_PREVIEW_DIR}-`)).toBe(false)
  })
})
