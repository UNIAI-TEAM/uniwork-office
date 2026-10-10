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
async function openDoc(
  page: Page,
  theme?: 'light' | 'dark',
  lang: string = 'en',
  extra: Record<string, string> = {},
): Promise<Frame> {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  // the host is authoritative for the theme and language (init.theme / init.locale)
  const themeParam = theme ? `theme=${theme}&` : ''
  const extraParams = Object.entries(extra)
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join('')
  await page.goto(
    `/test-host/?${themeParam}lang=${lang}&open=${encodeURIComponent('/fixtures/kitchen-sink.docx')}${extraParams}`,
  )
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
/**
 * control labels of the open ribbon tab: the text, else the aria-label (an
 * icon-only big button such as Paste, whose caption sits on its split caret)
 */
const controls = (ed: Frame) =>
  ed
    .locator('.ribbon button.rb-big, .ribbon .ribbon-group-label')
    .evaluateAll((els) =>
      els.map((el) => el.textContent?.trim() || el.getAttribute('aria-label') || ''),
    )

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

  test('References: no Zotero actions; the Zotero entry stays and says to use the app (A7 / B)', async ({
    page,
  }) => {
    const ed = await openDoc(page)
    await tab(ed, 'References').click()
    const labels = await controls(ed)
    // none of the four desktop actions, one entry that explains
    expect(labels.join('|')).not.toMatch(/Zotero (Citation|Bibliography|Refresh|Document)/i)
    expect(labels.filter((l) => l === 'Zotero').length).toBeGreaterThan(0)
    expect(labels.join('|')).toMatch(/Table of Contents|Footnote/i)
    await ed.locator('button.rb-big', { hasText: 'Zotero' }).first().click()
    const note = ed.locator('[data-testid="docs-zotero-app-only"]')
    await expect(note).toContainText('Zotero citations are not available here.')
    await expect(note).toContainText('Open in the UniWork Office app to use this feature')
    // no grant: no action, nothing sent
    await expect(note.locator('button')).toHaveCount(0)
    await shot(page, '02-references-zotero-use-the-app')
  })

  test('References: Open in app sends one app.open when the host grants desktopOpen', async ({
    page,
  }) => {
    const ed = await openDoc(page, undefined, 'en', { desktopopen: '1' })
    await tab(ed, 'References').click()
    await ed.locator('button.rb-big', { hasText: 'Zotero' }).first().click()
    const note = ed.locator('[data-testid="docs-zotero-app-only"]')
    await note.getByRole('button', { name: 'Open in app' }).click()
    await expect
      .poll(() => page.evaluate(() => (window as any).__host.appOpens()))
      .toEqual([{ feature: 'docs.zotero' }])
  })

  test('References in Vietnamese: the exact hint wording', async ({ page }) => {
    const ed = await openDoc(page, undefined, 'vi')
    await ed.locator('.ribbon-tab', { hasText: 'Tham khảo' }).first().click()
    await ed.locator('button.rb-big', { hasText: 'Zotero' }).first().click()
    await expect(ed.locator('[data-testid="docs-zotero-app-only"]')).toContainText(
      'Mở trong ứng dụng UniWork Office để dùng tính năng này',
    )
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

  test('Protect dialog: no open-password fields, a note says to use the app', async ({ page }) => {
    const ed = await openDoc(page)
    await tab(ed, 'Review').click()
    await ed.locator('button.rb-big', { hasText: 'Protect' }).first().click()
    const dialog = ed.locator('.protect-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toContainText('Password to open this document')
    await expect(dialog).toContainText('Password to modify this document')
    await expect(dialog.locator('.modal-desc')).not.toContainText(/open/i)
    await expect(dialog.locator('[data-testid="docs-open-password-app-only"]')).toContainText(
      'Open in the UniWork Office app to use this feature',
    )
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

test.describe('password-protected document (A7 / B)', () => {
  /** a compound file whose directory names an EncryptedPackage stream: what Word writes for "encrypt with password" */
  const LOCKED = (() => {
    const bytes = new Uint8Array(4096)
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0)
    const name = 'EncryptedPackage'
    for (let i = 0; i < name.length; i += 1) bytes[1024 + i * 2] = name.charCodeAt(i)
    return Buffer.from(bytes)
  })()

  async function openLocked(page: Page, lang: string, extra = ''): Promise<Frame> {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/e2e-fixtures/Locked.docx', (route) =>
      route.fulfill({
        status: 200,
        body: LOCKED,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      }),
    )
    await page.goto(
      `/test-host/?lang=${lang}&open=${encodeURIComponent('/e2e-fixtures/Locked.docx')}${extra}`,
    )
    await page.waitForFunction(() =>
      /index\.html/.test((document.getElementById('frame') as HTMLIFrameElement)?.src ?? ''),
    )
    return (await (await page.waitForSelector('#frame')).contentFrame())!
  }

  test('says so with the hint instead of a raw error; OK closes it', async ({ page }) => {
    const ed = await openLocked(page, 'en')
    const note = ed.locator('[data-testid="docs-encrypted-app-only"]')
    await expect(note).toBeVisible({ timeout: 30_000 })
    await expect(note).toContainText(
      '"Locked.docx" is password protected and cannot be opened here.',
    )
    await expect(note).toContainText('Open in the UniWork Office app to use this feature')
    await expect(note.locator('button')).toHaveCount(0)
    // not the password prompt (the web build cannot decrypt) and not a raw open-failure toast
    await expect(ed.locator('.pwd-dialog')).toHaveCount(0)
    await expect(ed.getByText(/Open failed/)).toHaveCount(0)
    await shot(page, '09-encrypted-docx-use-the-app')
    await ed.locator('.modal-actions').getByRole('button', { name: 'OK', exact: true }).click()
    await expect(note).toHaveCount(0)
  })

  test('Open in app with the desktopOpen grant (vi)', async ({ page }) => {
    const ed = await openLocked(page, 'vi', '&desktopopen=1')
    const note = ed.locator('[data-testid="docs-encrypted-app-only"]')
    await expect(note).toContainText('Mở trong ứng dụng UniWork Office để dùng tính năng này', {
      timeout: 30_000,
    })
    await note.getByRole('button', { name: 'Mở trong ứng dụng' }).click()
    await expect
      .poll(() => page.evaluate(() => (window as any).__host.appOpens()))
      .toEqual([{ feature: 'docs.encrypted' }])
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

  test('a host print request runs the BROWSER print path and answers after it settles', async ({
    page,
  }) => {
    const ed = await openDoc(page, 'dark')
    await ed.evaluate(() => {
      ;(window as any).__printed = []
      window.print = () => {
        ;(window as any).__printed.push({
          theme: document.documentElement.getAttribute('data-theme'),
          sheet: !!document.getElementById('web-bridge-print-page'),
        })
        // the dialog is still open: afterprint comes later
        setTimeout(() => window.dispatchEvent(new Event('afterprint')), 300)
      }
    })
    const t0 = Date.now()
    const res = await page.evaluate(() =>
      (window as any).__host.request('print', { mode: 'dialog' }),
    )
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250)
    expect(res).toEqual({ printed: true })
    expect(await ed.evaluate(() => (window as any).__printed)).toEqual([
      { theme: 'light', sheet: true },
    ])
    // the host's dark theme is back after the job
    await expect(ed.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(ed.locator('#web-bridge-print-page')).toHaveCount(0)
  })

  test('the host theme wins over localStorage, follows host events, never writes storage', async ({
    page,
  }) => {
    // a stale stored theme from a standalone run must not override init.theme
    await page.addInitScript(() => localStorage.setItem('genoffice.web.theme', 'light'))
    const ed = await openDoc(page, 'dark')
    await expect(ed.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.evaluate(() => (window as any).__host.send('theme', { theme: 'light' }))
    await expect(ed.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.evaluate(() => (window as any).__host.send('theme', { theme: 'dark' }))
    await expect(ed.locator('html')).toHaveAttribute('data-theme', 'dark')
    // the dark UI follows through to the document page (screen dark page)
    await shot(page, '09-host-theme-dark-event')
    expect(await page.evaluate(() => localStorage.getItem('genoffice.web.theme'))).toBe('light')
  })

  test('the host language is applied at init and switches live on a language event', async ({
    page,
  }) => {
    const ed = await openDoc(page, undefined, 'vi')
    await expect(tab(ed, 'Trang đầu')).toBeVisible()
    await expect(ed.locator('html')).toHaveAttribute('lang', /vi/)
    await shot(page, '10-host-language-vi')
    await page.evaluate(() => (window as any).__host.send('language', { locale: 'en' }))
    await expect(tab(ed, 'Home')).toBeVisible()
    await expect(tab(ed, 'Trang đầu')).toHaveCount(0)
    await page.evaluate(() => (window as any).__host.send('language', { locale: 'vi' }))
    await expect(tab(ed, 'Trang đầu')).toBeVisible()
    // still hidden in Vietnamese: no AI group, same capability set
    await expect(ed.locator('.ai-entry')).toHaveCount(0)
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
