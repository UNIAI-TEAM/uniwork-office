// UNI-1013 B2: the Docs frame must run under the exact Content-Security-Policy delivered as an HTTP
// header (csp.json from `npm run build:web`), with no <meta> CSP and zero violations while opening,
// editing, opening the font picker (the heaviest font-loading path) and saving.
import { test, expect, type Page } from '@playwright/test'

const EDITOR = '.ProseMirror[contenteditable="true"]'

interface CspManifest {
  header: string
  value: string
  directives: Record<string, string[]>
}

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)
}

test('csp: served as a header, no meta CSP, manifest consistent', async ({ request, baseURL }) => {
  const csp = (await (await request.get('/csp.json')).json()) as CspManifest
  const html = await request.get('/')
  expect(html.status()).toBe(200)
  expect(html.headers()['content-security-policy']).toBe(csp.value)
  expect(await html.text()).not.toMatch(/http-equiv=["']Content-Security-Policy/i)
  expect(csp.directives['frame-ancestors']).toContain("'self'")
  expect(csp.directives['script-src']).toEqual(["'self'"])
  expect(csp.directives['connect-src']).not.toContain('data:')

  const manifest = await (await request.get('/manifest.json')).json()
  expect(manifest.entry).toBe('index.html')
  expect(manifest.files.some((f: { path: string }) => f.path === 'index.html')).toBe(true)
  expect(manifest.initial.bytes).toBeLessThan(manifest.totalBytes / 3)
  void baseURL
})

for (const doc of [
  { name: 'simple', text: '第一段' },
  { name: 'kitchen-sink', text: '普通段落' },
]) {
  test(`csp: no violations - ${doc.name} (open, type, bold, font picker, save)`, async ({
    page,
  }) => {
    const consoleCsp: string[] = []
    const pageErrors: string[] = []
    page.on('console', (m) => {
      if (/content security policy|violates the following/i.test(m.text()))
        consoleCsp.push(m.text())
    })
    page.on('pageerror', (e) => pageErrors.push(e.message))
    await page.addInitScript(() => {
      const list: string[] = []
      ;(window as unknown as { __cspViolations: string[] }).__cspViolations = list
      document.addEventListener('securitypolicyviolation', (e) =>
        list.push(
          `${e.violatedDirective} blocked ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}`,
        ),
      )
    })

    await page.goto(`/?open=${encodeURIComponent(`/fixtures/${doc.name}.docx`)}`)
    const editor = page.locator(EDITOR).first()
    await editor
      .getByText(doc.text, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })

    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' csp-marker')
    await page.keyboard.press('Control+b')

    // font picker: every family name is rendered in its own face -> exercises font-src
    await page.locator('.rb-combo-caret').first().click()
    await page.waitForSelector('.rb-font-family-menu')
    await page.waitForLoadState('networkidle')
    await page.keyboard.press('Escape')

    // save goes through the bridge (Blob download): must not need data:/blob: connect-src
    const download = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null)
    await page.keyboard.press('Control+s')
    await download
    await page.waitForTimeout(500)

    expect(await violations(page)).toEqual([])
    expect(consoleCsp).toEqual([])
    expect(pageErrors).toEqual([])
  })
}
