// GO-B4 M-1/M-2 (UNI-1014): the Markdown module frame end to end on the production build
// (`npm run build:web -- --module markdown`) in the protocol test host, under its CSP header:
// open a BOM + CRLF document with raw HTML -> save without edits = the input bytes -> type ->
// save (only the edited line changes) -> reopen (raw HTML still byte-identical) -> conflict
// dialog -> view only. Zero console errors, CSP violations or off-origin requests; screenshots
// light + dark, vi + en into docs/web-modules/screenshots/markdown/.
// Run: npx playwright test -c web/e2e markdown-web
import { test, expect, type Frame, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BOM,
  built,
  bumpRemote,
  concat,
  cspViolations,
  encode,
  hostState,
  openModule,
  reloadFrame,
  repoRoot,
  screenshotPath,
  serveFixture,
  watch,
  type Problems,
} from './text-modules'

// the M0 raw-HTML fixture (comments, <div>/<details>/<table> blocks, inline <span>/<kbd>/<br>),
// served with a BOM and CRLF line endings: every byte must survive open -> save
const BODY = readFileSync(
  resolve(repoRoot, 'apps/markdown/tests/fixtures/raw-html.md.txt'),
  'utf8',
).replace(/\n/g, '\r\n')
const FIXTURE = concat(BOM, encode(BODY))
const EDITED = concat(
  BOM,
  encode(BODY.replace('Nearby paragraph to edit.', 'Nearby paragraph to edit. Edited on the web.')),
)
const FIXTURE_PATH = '/e2e-fixtures/Notes.md'

test.skip(!built('markdown'), 'no dist-web/markdown build: npm run build:web -- --module markdown')

async function editor(frame: Frame) {
  const el = frame.locator('.doc-editor')
  await expect(el).toBeVisible({ timeout: 30_000 })
  await expect(frame.locator('.doc-editor')).toContainText('Raw HTML survives')
  return el
}

async function save(page: Page) {
  await page.keyboard.press('Control+s')
}

async function expectClean(page: Page, frame: Frame, problems: Problems) {
  const csp = await cspViolations(page, frame)
  expect({ csp, ...problems }).toEqual({ csp: [], console: [], page: [], http: [], external: [] })
}

test('markdown: open -> save byte-identical -> type -> save -> reopen -> conflict', async ({
  page,
}) => {
  const problems = await watch(page)
  await serveFixture(page, FIXTURE_PATH, FIXTURE, 'text/markdown')
  let frame = await openModule(page, 'markdown', { open: FIXTURE_PATH, lang: 'en' })
  const ed = await editor(frame)
  // raw HTML is shown as text, never rendered into the editor DOM
  await expect(frame.locator('.md-raw-html').first()).toBeVisible()
  expect(await frame.locator('.doc-editor .hero, .doc-editor details').count()).toBe(0)
  // web: no AI, no AutoSave toggle
  expect(await frame.locator('.ai-dock, .ai-entry, .autosave-toggle').count()).toBe(0)

  // 1. save without edits: exactly the input bytes
  await ed.click()
  await save(page)
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v2')
  expect((await hostState(page)).lastSaved!.bytes).toEqual(Array.from(FIXTURE))

  // 2. type into the nearby paragraph and save: only that line changes
  await frame.locator('.doc-editor p', { hasText: 'Nearby paragraph to edit.' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Edited on the web.')
  await expect(frame.locator('.status-save')).toHaveText(/unsaved/i)
  await save(page)
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v3')
  expect((await hostState(page)).lastSaved!.bytes).toEqual(Array.from(EDITED))
  const fileId = (await hostState(page)).lastSaved!.fileId

  // 3. reopen (frame reload -> new handshake -> api.open of the latest version)
  frame = await reloadFrame(page)
  await editor(frame)
  await expect(frame.locator('.doc-editor')).toContainText('Edited on the web.')
  await frame.locator('.doc-editor').click()
  await save(page)
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v4')
  // the raw-HTML fixture is still byte-identical after a reopen
  expect((await hostState(page)).lastSaved!.bytes).toEqual(Array.from(EDITED))

  // 4. conflict: someone else saved meanwhile
  await bumpRemote(page, fileId)
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Mine.')
  await save(page)
  const dialog = frame.locator('[data-office-web="conflict"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-choice]')).toHaveText(['Reload latest', 'Overwrite', 'Cancel'])
  await page.screenshot({ path: screenshotPath('markdown', 'conflict-light-en') })
  await dialog.locator('[data-choice="overwrite"]').click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v6')
  expect(Buffer.from((await hostState(page)).lastSaved!.bytes).toString('utf8')).toContain(
    'abbreviation. Mine.',
  )

  await page.waitForTimeout(1_000)
  await expectClean(page, frame, problems)
})

test('markdown: view only without the save grant', async ({ page }) => {
  const problems = await watch(page)
  await serveFixture(page, FIXTURE_PATH, FIXTURE, 'text/markdown')
  const frame = await openModule(page, 'markdown', {
    open: FIXTURE_PATH,
    lang: 'en',
    readonly: '1',
  })
  const ed = await editor(frame)
  // the host announces view-only (banner + live region); the frame adds no third copy
  await expect(frame.locator('.status-view-only')).toHaveCount(0)
  await expect(ed).toHaveAttribute('contenteditable', 'false')
  await ed.click()
  await page.keyboard.type('x')
  await save(page)
  await page.waitForTimeout(1_000)
  expect((await hostState(page)).lastSaved).toBeNull()
  expect(await frame.locator('.doc-editor').textContent()).not.toContain('xRaw')
  await page.screenshot({ path: screenshotPath('markdown', 'view-only-light-en') })
  await expectClean(page, frame, problems)
})

for (const theme of ['light', 'dark'] as const) {
  for (const lang of ['en', 'vi'] as const) {
    test(`markdown: screenshot ${theme} ${lang}`, async ({ page }) => {
      const problems = await watch(page)
      await serveFixture(page, FIXTURE_PATH, FIXTURE, 'text/markdown')
      const frame = await openModule(page, 'markdown', { open: FIXTURE_PATH, lang, theme })
      await editor(frame)
      await expect
        .poll(() => frame.evaluate(() => document.documentElement.lang))
        .toMatch(new RegExp(`^${lang}`))
      await page.waitForTimeout(1_500)
      await page.screenshot({ path: screenshotPath('markdown', `editor-${theme}-${lang}`) })
      await expectClean(page, frame, problems)
    })
  }
}

// visual r2 polish (UNI-1232): the placeholder explains itself, raw HTML says it is inert, a broken
// diagram leads with the UI-language sentence, and the page keeps phone-sized gutters
const POLISH = [
  '# Polish fixture',
  '',
  '![sơ đồ](assets/missing.png)',
  '',
  '<div class="x">raw</div>',
  '',
  '```mermaid',
  'graph TD',
  '  A -->',
  '```',
  '',
  'thư tiếng Việt',
  '',
].join('\n')
const POLISH_PATH = '/e2e-fixtures/Polish.md'

test('markdown: placeholder, raw HTML label and a broken diagram speak the UI language', async ({
  page,
}) => {
  await serveFixture(page, POLISH_PATH, encode(POLISH), 'text/markdown')
  const frame = await openModule(page, 'markdown', { open: POLISH_PATH, lang: 'vi' })
  await expect(frame.locator('.doc-editor')).toContainText('Polish fixture', { timeout: 30_000 })

  // a relative picture without an asset: named for assistive tech, explained inside the picture
  const img = frame.locator('.doc-editor img[src^="data:image/svg+xml"]')
  await expect(img).toHaveAttribute('aria-label', /Ảnh không khả dụng: sơ đồ\. .*chưa được tải lên/)
  const svg = decodeURIComponent((await img.getAttribute('src'))!.split('#')[0]!.slice(33))
  expect(svg).toContain('assets/missing.png')
  expect(svg.replace(/<[^>]+>/g, '')).toContain('Chưa hiển thị')

  // raw HTML is kept as written and says so
  const label = await frame
    .locator('.doc-editor .md-raw-html')
    .first()
    .evaluate((el) => getComputedStyle(el, '::before').content)
  expect(label).toContain('HTML giữ nguyên, không hiển thị')

  // the parser's own English message is detail, behind the UI-language sentence
  const error = frame.locator('.md-diagram-error')
  await expect(error).toBeVisible({ timeout: 45_000 })
  await expect(error.locator('.md-diagram-error-lead')).toHaveText('Lỗi cú pháp sơ đồ')
  await expect(error.locator('details')).not.toHaveAttribute('open', '')
  await expect(error.locator('summary')).toHaveText('Chi tiết kỹ thuật')
  await page.screenshot({ path: screenshotPath('markdown', 'polish-light-vi') })
})

test('markdown: a phone keeps small page gutters (no 72 px margins), no sideways page scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await serveFixture(page, POLISH_PATH, encode(POLISH), 'text/markdown')
  const frame = await openModule(page, 'markdown', { open: POLISH_PATH, lang: 'en' })
  await expect(frame.locator('.doc-editor')).toContainText('Polish fixture', { timeout: 30_000 })
  const { pad, scroll, text } = await frame.locator('.doc-page').evaluate((el) => ({
    pad: parseFloat(getComputedStyle(el).paddingLeft),
    scroll: document.documentElement.scrollWidth,
    text: el.querySelector('p')!.getBoundingClientRect().width,
  }))
  expect(pad).toBeLessThanOrEqual(16)
  expect(scroll).toBeLessThanOrEqual(390)
  // 390 minus two 16 px gutters (the old 72 px gutters left ~212 px)
  expect(text).toBeGreaterThan(300)
  await page.screenshot({ path: screenshotPath('markdown', 'narrow-390-light-en') })
})
