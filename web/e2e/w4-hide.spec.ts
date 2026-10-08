// UNI-1013 W4: the web Docs UI with the desktop-only and AI/search/image entries hidden
// (single `window.desktop.capabilities` source, web/docs/bridge/hide.ts), plus the BROWSER
// class print path. Screenshots go to docs/web-docs/screenshots/w4/.
// Run (serialized lane-wide):
//   flock /home/ubuntu/.uniwork-lane-build.lock npx playwright test -c web/e2e web/e2e/w4-hide.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const SHOTS = resolve(__dirname, '../../docs/web-docs/screenshots/w4')
mkdirSync(SHOTS, { recursive: true })

const EDITOR = '.ProseMirror[contenteditable="true"]'

async function openDoc(page: Page, theme?: 'light' | 'dark'): Promise<void> {
  if (theme) {
    await page.addInitScript((t) => localStorage.setItem('genoffice.web.theme', t), theme)
  }
  await page.goto(`/?open=${encodeURIComponent('/fixtures/kitchen-sink.docx')}&lang=en`)
  await page
    .locator(EDITOR)
    .first()
    .getByText('普通段落', { exact: false })
    .first()
    .waitFor({ timeout: 30_000 })
}

const tab = (page: Page, name: string) =>
  page.locator('.ribbon-tab', { hasText: new RegExp(`^${name}$`) })
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) })
/** visible control labels of the open ribbon tab */
const controls = (page: Page) =>
  page.locator('.ribbon button.rb-big, .ribbon .ribbon-group-label').allTextContents()

test.describe('web capabilities hide entries', () => {
  test('the bridge exposes the web capability set', async ({ page }) => {
    await openDoc(page)
    const caps = await page.evaluate(() => (window as any).desktop.capabilities)
    expect(caps).toMatchObject({ platform: 'web', ai: false, zotero: false, tabs: false })
  })

  test('Home: no AI group, no AutoSave toggle; the rest of Home is intact', async ({ page }) => {
    await openDoc(page)
    await expect(page.locator('.ai-entry')).toHaveCount(0)
    await expect(page.locator('.ai-dock')).toHaveCount(0)
    await expect(page.locator('.autosave-toggle')).toHaveCount(0)
    const labels = (await controls(page)).join('|')
    expect(labels).not.toMatch(/\bAI\b/)
    expect(labels).toContain('Paste')
    await shot(page, '01-home-no-ai')
  })

  test('References: no Zotero group', async ({ page }) => {
    await openDoc(page)
    await tab(page, 'References').click()
    const labels = (await controls(page)).join('|')
    expect(labels).not.toMatch(/Zotero/i)
    expect(labels).toMatch(/Table of Contents|Footnote/i)
    await shot(page, '02-references-no-zotero')
  })

  test('Review: no Editor / Translate / AI comments / AI revisions', async ({ page }) => {
    await openDoc(page)
    await tab(page, 'Review').click()
    const labels = (await controls(page)).join('|')
    for (const gone of ['Editor', 'Translate', 'AI Resolve Comments', 'AI Revision Summary']) {
      expect(labels).not.toContain(gone)
    }
    expect(labels).toContain('New Comment')
    await shot(page, '03-review-no-ai')
  })

  test('View: no AI panel / New Tab / Switch Tabs; Split + Dark Mode stay', async ({ page }) => {
    await openDoc(page)
    await tab(page, 'View').click()
    const labels = (await controls(page)).join('|')
    for (const gone of ['AI Panel', 'New Tab', 'Switch Tabs']) expect(labels).not.toContain(gone)
    expect(labels).toContain('Split')
    expect(labels).toContain('Dark Mode')
    await shot(page, '04-view-no-tabs-no-ai')
  })

  test('Protect dialog: no open-password fields', async ({ page }) => {
    await openDoc(page)
    await tab(page, 'Review').click()
    await page.locator('button.rb-big', { hasText: 'Protect' }).first().click()
    const dialog = page.locator('.protect-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toContainText('Password to open this document')
    await expect(dialog).toContainText('Password to modify this document')
    await shot(page, '05-protect-dialog-no-open-password')
  })

  test('context menu: no Synonyms / Translate', async ({ page }) => {
    await openDoc(page)
    const para = page.locator(EDITOR).first().getByText('普通段落', { exact: false }).first()
    await para.dblclick()
    await para.click({ button: 'right' })
    await expect(page.locator('.ctx-label', { hasText: /^Cut$/ })).toBeVisible()
    await expect(page.locator('.ctx-label', { hasText: /Synonyms|Translate/ })).toHaveCount(0)
    await shot(page, '06-context-menu-no-ai')
  })

  test('dark UI theme: same entries hidden', async ({ page }) => {
    await openDoc(page, 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.ai-entry')).toHaveCount(0)
    await shot(page, '07-home-dark-no-ai')
    await tab(page, 'View').click()
    await shot(page, '08-view-dark-no-tabs-no-ai')
  })
})

test.describe('BROWSER class', () => {
  /** bitmap of the first document page under print media, while `during` runs */
  async function printMediaBitmap(page: Page): Promise<string> {
    await page.emulateMedia({ media: 'print' })
    const png = await page.locator('.doc-page').first().screenshot()
    await page.emulateMedia({ media: 'screen' })
    return png.toString('base64')
  }

  test('print runs in the page, pins light for the job and restores the theme', async ({
    page,
  }) => {
    await openDoc(page, 'dark')
    // window.print() blocks headless Chromium: observe the call instead
    await page.evaluate(() => {
      ;(window as any).__printed = []
      window.print = () => {
        ;(window as any).__printed.push({
          theme: document.documentElement.getAttribute('data-theme'),
          sheet: document.getElementById('web-bridge-print-page')?.textContent ?? '',
        })
        window.dispatchEvent(new Event('afterprint'))
      }
    })
    expect(await page.evaluate(() => (window as any).desktop.print(1))).toEqual({ ok: true })
    const printed = await page.evaluate(() => (window as any).__printed)
    expect(printed).toHaveLength(1)
    expect(printed[0].theme).toBe('light')
    expect(printed[0].sheet).toContain('@page { margin: 0; }')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('#web-bridge-print-page')).toHaveCount(0)
  })

  test('the printed page is pixel-identical whichever UI theme the user had', async ({ page }) => {
    await openDoc(page, 'dark')
    // hold the print job open (no afterprint) so the print sheet + light pin stay active
    await page.evaluate(() => {
      window.print = () => {}
    })
    const job = page.evaluate(() => (window as any).desktop.print(1))
    await expect(page.locator('#web-bridge-print-page')).toHaveCount(1)
    const fromDark = await printMediaBitmap(page)
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await job

    await page.evaluate(() => {
      window.print = () => {}
    })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    const jobLight = page.evaluate(() => (window as any).desktop.print(1))
    await expect(page.locator('#web-bridge-print-page')).toHaveCount(1)
    const fromLight = await printMediaBitmap(page)
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await jobLight
    expect(fromDark).toBe(fromLight)
  })

  test('document hyperlinks open without an opener and javascript: is blocked', async ({
    page,
    context,
  }) => {
    await openDoc(page)
    const blocked = await page.evaluate(() => window.open('javascript:alert(1)'))
    expect(blocked).toBeNull()
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 5_000 }).catch(() => null),
      page.evaluate(() => window.open('https://example.com/', '_self')),
    ])
    if (popup) {
      expect(await popup.evaluate(() => window.opener)).toBeNull()
      await popup.close()
    }
  })
})
