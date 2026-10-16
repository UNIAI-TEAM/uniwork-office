// UXF-03 (S5-04): the Docs frame's save conflict dialog offers "Xem khác biệt" / "View differences"
// before Reload, and it opens the comparison of the user's version against the head inside the
// dialog (the production Docs build in the protocol test host).
// Run alone: npx playwright test -c web/e2e docs-conflict-diff
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const docsRoot = resolve(repoRoot, 'dist-web', 'docs')
const built =
  existsSync(docsRoot) &&
  readdirSync(docsRoot).some((v) => existsSync(resolve(docsRoot, v, 'manifest.json')))
test.skip(!built, 'dist-web/docs is not built (npm run build:web)')

const EDITOR = '.ProseMirror[contenteditable="true"]'
const TEXT = '第一段'

async function openDoc(page: Page, lang: string): Promise<Frame> {
  await page.goto(`/test-host/?open=${encodeURIComponent('/fixtures/simple.docx')}&lang=${lang}`)
  const ed = (await (await page.waitForSelector('#frame')).contentFrame())!
  await ed
    .locator('.ProseMirror')
    .first()
    .getByText(TEXT, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  return ed
}

for (const [lang, label] of [
  ['vi', 'Xem khác biệt'],
  ['en', 'View differences'],
] as const) {
  test(`docs conflict dialog (${lang}): "${label}" before Reload opens the comparison with the head`, async ({
    page,
  }) => {
    const ed = await openDoc(page, lang)
    const editor = ed.locator(EDITOR).first()
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('x')
    await page.keyboard.press('Control+s')
    await expect
      .poll(() => page.evaluate(() => (window as any).__host.lastSaved()?.fileId ?? null))
      .not.toBeNull()
    const fileId = await page.evaluate(() => (window as any).__host.lastSaved().fileId)
    await page.evaluate((id) => (window as any).__host.bumpRemote(id), fileId)
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('MINEONLY')
    await page.keyboard.press('Control+s')

    const dialog = ed.locator('[data-docs-web="conflict"]')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    const link = dialog.locator('[data-choice="diff"]')
    await expect(link).toHaveText(label)
    const before = await dialog.evaluate((d) => {
      const diff = d.querySelector('[data-choice="diff"]')!
      const reload = d.querySelector('[data-choice="reload"]')!
      return !!(diff.compareDocumentPosition(reload) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(before, 'the link comes before Reload in DOM order').toBe(true)

    await link.click()
    const view = dialog.locator('.ow-dlg-diff')
    await expect(view).toBeVisible({ timeout: 20_000 })
    // my version carries the unsaved text, the head does not
    await expect(view.locator('.ow-dlg-diff-card').first()).toBeVisible()
    await expect(view).toContainText('MINEONLY')
    // the comparison is a step of the same dialog; Back returns to step 1 with the link focused
    await expect(dialog).toHaveCount(1)
    await dialog.locator('[data-choice="back"]').click()
    await expect(dialog.locator('[data-choice="reload"]')).toBeVisible()
    await expect(link).toBeFocused()
    await dialog.locator('[data-choice="cancel"]').click()
    await expect(dialog).toHaveCount(0)
  })
}
