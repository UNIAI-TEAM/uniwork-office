// UNI-1232 FX2 (R2-08 / N3-02): after a failed save the host header shows "Save could not be
// confirmed"; the next edit must reach the host as a dirty event again so the header goes back to
// "Unsaved". The frame's own dirty flag never changed (still dirty), so the Markdown and HTML
// renderers have to report that first edit explicitly.
// Run: npx playwright test -c web/e2e save-failed-edit-web
import { test, expect, type Page } from '@playwright/test'
import { BOM, built, concat, encode, openModule, serveFixture } from './text-modules'

const MD = concat(BOM, encode('# Title\r\n\r\nParagraph to edit.\r\n'))
const HTML = concat(
  BOM,
  encode(
    '<!doctype html>\r\n<html><body><h1>Title</h1><p>Paragraph to edit.</p></body></html>\r\n',
  ),
)

async function dirtyEvents(page: Page): Promise<boolean[]> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __host: { events: Array<{ type: string; payload: { dirty?: boolean } }> }
      }
    ).__host.events
      .filter((e) => e.type === 'dirty')
      .map((e) => e.payload.dirty === true),
  )
}

async function failNextSave(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { __host: { failNextSave: () => void } }).__host.failNextSave(),
  )
}

async function saveCalls(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __host: { saveCalls: () => number } }).__host.saveCalls(),
  )
}

test.describe('markdown', () => {
  test.skip(!built('markdown'), 'no dist-web/markdown build')

  test('an edit after a failed save is reported dirty again', async ({ page }) => {
    await serveFixture(page, '/e2e-fixtures/Notes.md', MD, 'text/markdown')
    const frame = await openModule(page, 'markdown', {
      open: '/e2e-fixtures/Notes.md',
      lang: 'en',
    })
    const editor = frame.locator('.doc-editor')
    await expect(editor).toContainText('Paragraph to edit.')
    await editor.locator('p').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' one')
    await expect.poll(async () => (await dirtyEvents(page)).at(-1)).toBe(true)

    await failNextSave(page)
    await page.keyboard.press('Control+s')
    await expect.poll(() => saveCalls(page)).toBe(1)

    const before = (await dirtyEvents(page)).length
    await page.keyboard.type(' two')
    await expect.poll(async () => (await dirtyEvents(page)).length).toBe(before + 1)
    expect((await dirtyEvents(page)).at(-1)).toBe(true)
    // only the first edit since the failure: typing on stays quiet
    await page.keyboard.type(' three')
    await page.waitForTimeout(300)
    expect((await dirtyEvents(page)).length).toBe(before + 1)
  })
})

test.describe('html', () => {
  test.skip(!built('html'), 'no dist-web/html build')

  test('an edit after a failed save is reported dirty again', async ({ page }) => {
    await serveFixture(page, '/e2e-fixtures/Page.html', HTML, 'text/html')
    const frame = await openModule(page, 'html', { open: '/e2e-fixtures/Page.html', lang: 'en' })
    await expect(frame.locator('.workspace')).toBeVisible({ timeout: 30_000 })
    await frame.getByRole('tab', { name: /^Source$/ }).click()
    await frame.locator('.cm-line', { hasText: 'Paragraph to edit.' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' one')
    await expect.poll(async () => (await dirtyEvents(page)).at(-1)).toBe(true)

    await failNextSave(page)
    await page.keyboard.press('Control+s')
    await expect.poll(() => saveCalls(page)).toBe(1)

    const before = (await dirtyEvents(page)).length
    await page.keyboard.type(' two')
    await expect.poll(async () => (await dirtyEvents(page)).length).toBe(before + 1)
    expect((await dirtyEvents(page)).at(-1)).toBe(true)
    await page.keyboard.type(' three')
    await page.waitForTimeout(300)
    expect((await dirtyEvents(page)).length).toBe(before + 1)
  })
})
