// UNI-1013 W4: the web Docs UI with the desktop-only and AI/search/image entries hidden
// (single `window.desktop.capabilities` source, web/docs/bridge/hide.ts), plus the BROWSER
// class print path. The editor runs inside iframe#frame of the protocol test host
// (web/server/test-host), exactly as in production. Screenshots go to
// docs/web-docs/screenshots/w4/.
// Run (serialized lane-wide):
//   flock /home/ubuntu/.uniwork-lane-build.lock npx playwright test -c web/e2e web/e2e/w4-hide.spec.ts
import { test, expect, type Frame, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const SHOTS = resolve(__dirname, '../../docs/web-docs/screenshots/w4')
mkdirSync(SHOTS, { recursive: true })

const EDITOR = '.ProseMirror[contenteditable="true"]'

/** console errors / page errors seen by the page and its frames (reported in the run summary) */
const consoleErrors: string[] = []

/** open the docx through the test host and return the editor iframe */
async function openDoc(page: Page, theme?: 'light' | 'dark'): Promise<Frame> {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  if (theme) {
    // same-origin frame: the bridge reads the stored UI theme at load
    await page.addInitScript((t) => localStorage.setItem('genoffice.web.theme', t), theme)
  }
  await page.goto(`/test-host/?open=${encodeURIComponent('/fixtures/kitchen-sink.docx')}`)
  await page.waitForFunction(() =>
    /index\.html/.test((document.getElementById('frame') as HTMLIFrameElement)?.src ?? ''),
  )
  const ed = (await (await page.waitForSelector('#frame')).contentFrame())!
  await ed
    .locator(EDITOR)
    .first()
    .getByText('普通段落', { exact: false })
    .first()
    .waitFor({ timeout: 30_000 })
  return ed
}

const tab = (ed: Frame, name: string) =>
  ed.locator('.ribbon-tab', { hasText: new RegExp(`^${name}$`) })
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) })
/** visible control labels of the open ribbon tab */
const controls = (ed: Frame) =>
  ed.locator('.ribbon button.rb-big, .ribbon .ribbon-group-label').allTextContents()

test.afterAll(() => {
  // surfaced in the run summary; the specs below fail on a page error, console errors are reported
  console.log(`w4-hide: ${consoleErrors.length} console/page error(s)`)
  for (const line of consoleErrors) console.log(`  ${line}`)
})

test.describe('web capabilities hide entries', () => {
  test('the bridge exposes the web capability set', async ({ page }) => {
    const ed = await openDoc(page)
    const caps = await ed.evaluate(() => (window as any).desktop.capabilities)
    expect(caps).toMatchObject({ platform: 'web', ai: false, zotero: false, tabs: false })
  })

  test('Home: no AI group, no AutoSave toggle; the rest of Home is intact', async ({ page }) => {
    const ed = await openDoc(page)
    await expect(ed.locator('.ai-entry')).toHaveCount(0)
    await expect(ed.locator('.ai-dock')).toHaveCount(0)
    await expect(ed.locator('.autosave-toggle')).toHaveCount(0)
    const labels = (await controls(ed)).join('|')
    expect(labels).not.toMatch(/\bAI\b/)
    expect(labels).toContain('Paste')
    await shot(page, '01-home-no-ai')
  })

  test('References: no Zotero group', async ({ page }) => {
    const ed = await openDoc(page)
    await tab(ed, 'References').click()
    const labels = (await controls(ed)).join('|')
    expect(labels).not.toMatch(/Zotero/i)
    expect(labels).toMatch(/Table of Contents|Footnote/i)
    await shot(page, '02-references-no-zotero')
  })

  test('Review: no Editor / Translate / AI comments / AI revisions', async ({ page }) => {
    const ed = await openDoc(page)
    await tab(ed, 'Review').click()
    const labels = (await controls(ed)).join('|')
    for (const gone of ['Editor', 'Translate', 'AI Resolve Comments', 'AI Revision Summary']) {
      expect(labels).not.toContain(gone)
    }
    expect(labels).toContain('New Comment')
    await shot(page, '03-review-no-ai')
  })

  test('View: no AI panel / New Tab / Switch Tabs; Split + Dark Mode stay', async ({ page }) => {
    const ed = await openDoc(page)
    await tab(ed, 'View').click()
    const labels = (await controls(ed)).join('|')
    for (const gone of ['AI Panel', 'New Tab', 'Switch Tabs']) expect(labels).not.toContain(gone)
    expect(labels).toContain('Split')
    expect(labels).toContain('Dark Mode')
    await shot(page, '04-view-no-tabs-no-ai')
  })

  test('Protect dialog: no open-password fields', async ({ page }) => {
    const ed = await openDoc(page)
    await tab(ed, 'Review').click()
    await ed.locator('button.rb-big', { hasText: 'Protect' }).first().click()
    const dialog = ed.locator('.protect-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toContainText('Password to open this document')
    await expect(dialog).toContainText('Password to modify this document')
    await expect(dialog.locator('.modal-desc')).not.toContainText(/open/i)
    await shot(page, '05-protect-dialog-no-open-password')
  })

  test('context menu: no Synonyms / Translate', async ({ page }) => {
    const ed = await openDoc(page)
    const para = ed.locator(EDITOR).first().getByText('普通段落', { exact: false }).first()
    await para.dblclick()
    await para.click({ button: 'right' })
    await expect(ed.locator('.ctx-label', { hasText: /^Cut$/ })).toBeVisible()
    await expect(ed.locator('.ctx-label', { hasText: /Synonyms|Translate/ })).toHaveCount(0)
    await shot(page, '06-context-menu-no-ai')
  })

  test('dark UI theme: same entries hidden', async ({ page }) => {
    const ed = await openDoc(page, 'dark')
    await expect(ed.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(ed.locator('.ai-entry')).toHaveCount(0)
    await shot(page, '07-home-dark-no-ai')
    await tab(ed, 'View').click()
    await shot(page, '08-view-dark-no-tabs-no-ai')
  })
})

test.describe('BROWSER class', () => {
  /** bitmap of the first document page under print media, while `during` runs */
  async function printMediaBitmap(page: Page, ed: Frame): Promise<string> {
    await page.emulateMedia({ media: 'print' })
    const png = await ed.locator('.doc-page').first().screenshot()
    await page.emulateMedia({ media: 'screen' })
    return png.toString('base64')
  }

  test('print runs in the page, pins light for the job and restores the theme', async ({
    page,
  }) => {
    const ed = await openDoc(page, 'dark')
    // window.print() blocks headless Chromium: observe the call instead
    await ed.evaluate(() => {
      ;(window as any).__printed = []
      window.print = () => {
        ;(window as any).__printed.push({
          theme: document.documentElement.getAttribute('data-theme'),
          sheet: document.getElementById('web-bridge-print-page')?.textContent ?? '',
        })
        window.dispatchEvent(new Event('afterprint'))
      }
    })
    expect(await ed.evaluate(() => (window as any).desktop.print(1))).toEqual({ ok: true })
    const printed = await ed.evaluate(() => (window as any).__printed)
    expect(printed).toHaveLength(1)
    expect(printed[0].theme).toBe('light')
    expect(printed[0].sheet).toContain('@page { margin: 0; }')
    await expect(ed.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(ed.locator('#web-bridge-print-page')).toHaveCount(0)
  })

  test('the printed page is pixel-identical whichever UI theme the user had', async ({ page }) => {
    const ed = await openDoc(page, 'dark')
    // hold the print job open (no afterprint) so the print sheet + light pin stay active
    await ed.evaluate(() => {
      window.print = () => {}
    })
    const job = ed.evaluate(() => (window as any).desktop.print(1))
    await expect(ed.locator('#web-bridge-print-page')).toHaveCount(1)
    const fromDark = await printMediaBitmap(page, ed)
    await ed.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await job

    await ed.evaluate(() => {
      window.print = () => {}
    })
    await ed.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    const jobLight = ed.evaluate(() => (window as any).desktop.print(1))
    await expect(ed.locator('#web-bridge-print-page')).toHaveCount(1)
    const fromLight = await printMediaBitmap(page, ed)
    await ed.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await jobLight
    expect(fromDark).toBe(fromLight)
  })

  // The host's print request (W2 `print`, mode 'print') is answered by webapi.ts. It must go
  // through the BROWSER print (window.desktop.print: light pin, print sheet, afterprint) and not
  // call window.print() directly. Known integration gap reported to the lane lead: this is
  // expected to fail until webapi.ts handlePrint delegates to window.desktop.print().
  test.fail('a host print request runs the BROWSER print path', async ({ page }) => {
    const ed = await openDoc(page, 'dark')
    await ed.evaluate(() => {
      ;(window as any).__printed = []
      window.print = () => {
        ;(window as any).__printed.push({
          theme: document.documentElement.getAttribute('data-theme'),
          sheet: !!document.getElementById('web-bridge-print-page'),
        })
        window.dispatchEvent(new Event('afterprint'))
      }
    })
    await page.evaluate(() => (window as any).__host.request('print', { mode: 'print' }))
    const printed = await ed.evaluate(() => (window as any).__printed)
    expect(printed).toEqual([{ theme: 'light', sheet: true }])
  })

  // The host passes theme + locale in `init` (W2). The frame side must apply them through
  // setWebTheme / setWebLanguage (browser.ts). Known integration gap reported to the lane lead:
  // nothing consumes init.theme yet, so this is expected to fail until session/frame wiring lands.
  test.fail('the host init theme is applied to the frame', async ({ page }) => {
    await page.goto(
      `/test-host/?theme=dark&open=${encodeURIComponent('/fixtures/kitchen-sink.docx')}`,
    )
    await page.waitForFunction(() =>
      /index\.html/.test((document.getElementById('frame') as HTMLIFrameElement)?.src ?? ''),
    )
    const ed = (await (await page.waitForSelector('#frame')).contentFrame())!
    await ed.locator(EDITOR).first().waitFor({ timeout: 30_000 })
    await expect(ed.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 3_000 })
  })

  test('document hyperlinks open without an opener and javascript: is blocked', async ({
    page,
    context,
  }) => {
    const ed = await openDoc(page)
    const blocked = await ed.evaluate(() => window.open('javascript:alert(1)'))
    expect(blocked).toBeNull()
    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 5_000 }).catch(() => null),
      ed.evaluate(() => window.open('https://example.com/', '_self')),
    ])
    if (popup) {
      expect(await popup.evaluate(() => window.opener)).toBeNull()
      await popup.close()
    }
  })
})
