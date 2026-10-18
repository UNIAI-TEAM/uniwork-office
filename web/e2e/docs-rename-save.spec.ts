// UNI-1909 (SAVE-01 follow-up, test host web/server/test-host):
// (a) S01B-V1: the host emits file.renamed and its reissued api.save succeeds; the
//     frame's "Save as" then proposes the NEW name, not the stale "untitled".
// (b) S01-V2: the host declines the frame's api.save with code "cancelled" to open
//     its own name dialog; the frame stays silent — no "Lưu thất bại" in the status
//     bar and no toast.
// Run: npx playwright test -c web/e2e docs-rename-save
import { test, expect, type Page, type Frame } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const EDITOR = '.ProseMirror[contenteditable="true"]'
const NEW_NAME = 'Kế hoạch Q4.docx'

// the spec needs the docs web build (the test host iframes /index.html)
test.skip(
  !existsSync(resolve(repoRoot, 'dist-web/docs/index.html')) &&
    !existsSync(resolve(repoRoot, 'dist-web/index.html')),
  'no dist-web docs build',
)

interface HostApi {
  documentId: string
  rename: (fileId: string, name: string) => unknown
  cancelNextSave: () => void
  saveCalls: () => number
  lastSaved: () => { name: string } | null
  request: (type: string, payload: unknown) => Promise<unknown>
  events: Array<{ type: string; payload: unknown }>
}
type HostMethod = 'rename' | 'cancelNextSave' | 'saveCalls' | 'lastSaved' | 'request'

/**
 * Call one test-host method inside the page. page.evaluate serializes its result, so
 * returning window.__host itself would drop every function: each call is its own evaluate
 * and only its (serializable) return value crosses back. A Promise result is awaited.
 */
function hostCall<T>(page: Page, name: HostMethod, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([n, a]) => {
      const h = (window as unknown as { __host: Record<string, (...x: unknown[]) => unknown> })
        .__host
      return h[n as string]!(...(a as unknown[]))
    },
    [name, args] as const,
  ) as Promise<T>
}

const hostDocumentId = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __host: HostApi }).__host.documentId)

/** open the simple fixture through the test host (vi locale = the reported symptom) */
async function openDoc(page: Page): Promise<Frame> {
  await page.goto(`/test-host/?open=${encodeURIComponent('/fixtures/simple.docx')}&lang=vi`)
  await page.waitForFunction(() =>
    /index\.html/.test((document.getElementById('frame') as HTMLIFrameElement)?.src ?? ''),
  )
  const ed = (await (await page.waitForSelector('#frame')).contentFrame())!
  await ed
    .locator(EDITOR)
    .first()
    .getByText('第一段', { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  return ed
}

/** Ctrl+S in the editor; api.save reaches the test host */
async function ctrlS(page: Page, ed: Frame): Promise<void> {
  await ed
    .locator(EDITOR)
    .first()
    .click({ position: { x: 5, y: 5 }, force: true })
    .catch(() => {})
  await page.keyboard.press('Control+s')
}

test('a rename before the save is the name Save as proposes', async ({ page }) => {
  const ed = await openDoc(page)
  const fileId = await hostDocumentId(page)

  // an edit so the save has something to persist
  await ed.locator(EDITOR).first().click()
  await page.keyboard.type(' rename-marker')
  await hostCall(page, 'rename', fileId, NEW_NAME)
  // the frame's document title follows the rename before any save result could teach it
  await expect.poll(() => ed.evaluate(() => document.title)).toBe(NEW_NAME)

  await ctrlS(page, ed)
  await expect.poll(() => hostCall<number>(page, 'saveCalls')).toBe(1)
  await expect
    .poll(async () => (await hostCall<{ name: string } | null>(page, 'lastSaved'))?.name)
    .toBe(NEW_NAME)

  // File -> Save as: the name the frame proposes to the host's api.saveAs
  const result = await hostCall<{
    ok: boolean
    file?: { name: string }
  }>(page, 'request', 'saveAs', {})
  expect(result.ok).toBe(true)
  expect(result.file?.name).toBe(NEW_NAME)
})

test('a host-declined save (api.save "cancelled") shows no failure in the status bar', async ({
  page,
}) => {
  const ed = await openDoc(page)

  await ed.locator(EDITOR).first().click()
  await page.keyboard.type(' cancel-marker')
  await hostCall(page, 'cancelNextSave')

  await ctrlS(page, ed)
  await expect.poll(() => hostCall<number>(page, 'saveCalls')).toBe(1)
  // settle signal: the declined save left the document dirty, so the frame's save-state
  // item reads "unsaved" once the save round trip is over (no sleep before the negatives)
  await expect(ed.locator('.status-save-state.unsaved')).toBeVisible()
  // the declined save wrote nothing
  expect(await hostCall<{ name: string } | null>(page, 'lastSaved')).toBeNull()
  // silent: no "Lưu thất bại" status line, no error toast (doc stays dirty)
  await expect(ed.locator('.status-bar')).not.toContainText('Lưu thất bại')
  await expect(ed.locator('.status-msg')).not.toContainText('Lưu thất bại')
  await expect(ed.locator('.toast, [role="alert"]').filter({ hasText: 'Lưu' })).toHaveCount(0)
})
