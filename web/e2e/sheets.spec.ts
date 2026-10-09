// UNI-1016 (GO-B6): the Sheets frame in the protocol test host, built with
// `npm run build:web -- --module sheets` and served under its own CSP header.
// GO-D3 = C: the xlsx engine runs as WASM in a frame Worker (follow-up), so this build ships the
// engine seam with its `engine-unavailable` stub. Checked here: the bundle boots, the handshake
// completes, the styled "cannot be opened on the web yet" screen renders in vi + en, light + dark
// (screenshots in docs/web-modules/screenshots/sheets/), the host hears the typed error once, the
// grid chunk is never downloaded, view-only follows the save grant, and nothing is logged as a
// console error, page error, failed request or CSP violation.
// Run: npx playwright test -c web/e2e sheets
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const shots = resolve(repoRoot, 'docs/web-modules/screenshots/sheets')

const built = (): boolean => {
  const root = resolve(repoRoot, 'dist-web', 'sheets')
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

interface Problems {
  console: string[]
  page: string[]
  http: string[]
  scripts: string[]
}

async function watch(page: Page): Promise<Problems> {
  const p: Problems = { console: [], page: [], http: [], scripts: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') p.console.push(`${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => p.page.push(`${e.message}\n${e.stack ?? ''}`))
  page.on('response', (r) => {
    if (r.status() >= 400) p.http.push(`${r.status()} ${r.url()}`)
    if (r.url().includes('/office-frame/sheets/') && r.url().endsWith('.js'))
      p.scripts.push(r.url())
  })
  await page.addInitScript(() => {
    const list: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = list
    document.addEventListener('securitypolicyviolation', (e) =>
      list.push(`${e.violatedDirective} blocked ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}`),
    )
  })
  return p
}

async function openFrame(page: Page, query: string): Promise<Frame> {
  await page.goto(`/test-host/?module=sheets&${query}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  return (await (await page.waitForSelector('#frame')).contentFrame())!
}

async function cspViolations(page: Page, frame: Frame): Promise<string[]> {
  return [
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
    ...(await frame.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )),
  ]
}

type HostEvent = { type: string; payload: Record<string, unknown> }
const hostEvents = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __host: { events: HostEvent[] } }).__host.events,
  ) as Promise<HostEvent[]>

const TITLES: Record<string, RegExp> = {
  en: /can't be opened on the web yet/,
  vi: /Chưa thể mở sổ làm việc này trên web/,
}

test.beforeAll(() => mkdirSync(shots, { recursive: true }))

for (const lang of ['en', 'vi'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`engine-unavailable screen: ${lang}, ${theme}`, async ({ page }) => {
      test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
      const problems = await watch(page)
      const frame = await openFrame(page, `lang=${lang}&theme=${theme}`)

      expect(
        await frame.evaluate(
          () => (window as unknown as { __officeWebModule?: string }).__officeWebModule,
        ),
      ).toBe('sheets')
      const screen = frame.getByTestId('sheets-engine-unavailable')
      await expect(screen).toBeVisible({ timeout: 30_000 })
      await expect(screen.locator('h1')).toHaveText(TITLES[lang]!)
      await expect
        .poll(() => frame.evaluate(() => document.documentElement.lang))
        .toMatch(new RegExp(`^${lang}`))
      expect(await frame.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
        theme,
      )

      // styled, not raw DOM: the card sits on the themed canvas with its own surface and border
      const style = await screen.locator('.engine-unavailable-card').evaluate((el) => {
        const cs = getComputedStyle(el)
        const page = getComputedStyle(el.parentElement!)
        return {
          card: cs.backgroundColor,
          page: page.backgroundColor,
          radius: cs.borderTopLeftRadius,
          text: getComputedStyle(el.querySelector('h1')!).color,
        }
      })
      expect(style.radius).not.toBe('0px')
      expect(style.card).not.toBe(style.page)
      const darkText = theme === 'dark'
      const [r, g, b] = style.text.match(/\d+/g)!.map(Number)
      // light text on the dark theme, dark text on the light one
      expect((r! + g! + b!) / 3 > 128).toBe(darkText)

      // the host hears the typed failure once, non-fatal
      await expect
        .poll(
          async () =>
            (await hostEvents(page)).filter(
              (e) =>
                e.type === 'error' &&
                (e.payload.error as { code?: string })?.code === 'unsupported',
            ).length,
        )
        .toBe(1)

      await page.waitForTimeout(1_500)
      await page.screenshot({ path: resolve(shots, `engine-unavailable-${lang}-${theme}.png`) })

      // only the small boot chunk: the grid (App + Univer) is never downloaded
      expect(problems.scripts.length).toBeLessThanOrEqual(3)
      expect({ csp: await cspViolations(page, frame), ...problems, scripts: [] }).toEqual({
        csp: [],
        console: [],
        page: [],
        http: [],
        scripts: [],
      })
    })
  }
}

test('view-only follows the host save grant; live theme switch reaches the screen', async ({
  page,
}) => {
  test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
  const problems = await watch(page)

  let frame = await openFrame(page, 'lang=en&theme=light')
  await expect(frame.getByTestId('sheets-engine-unavailable')).toBeVisible({ timeout: 30_000 })
  const grants = () =>
    frame.evaluate(() => {
      const caps = (window as unknown as { desktopApi: { capabilities: Record<string, unknown> } })
        .desktopApi.capabilities
      return {
        save: caps.save,
        saveAs: caps.saveAs,
        ai: caps.ai,
        autoSave: caps.autoSave,
        recoveryCopy: caps.recoveryCopy,
        recalcFallback: caps.recalcFallback,
        mergeWorkbooks: caps.mergeWorkbooks,
        xlsxEngine: caps.xlsxEngine,
      }
    })
  expect(await grants()).toEqual({
    save: true,
    saveAs: true,
    ai: false,
    autoSave: false,
    recoveryCopy: false,
    recalcFallback: false,
    mergeWorkbooks: false,
    xlsxEngine: false,
  })
  await page.evaluate(() =>
    (window as unknown as { __host: { send: (t: string, p: unknown) => void } }).__host.send(
      'theme',
      { theme: 'dark' },
    ),
  )
  await expect
    .poll(() => frame.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe('dark')

  frame = await openFrame(page, 'lang=en&theme=light&readonly=1')
  await expect(frame.getByTestId('sheets-engine-unavailable')).toBeVisible({ timeout: 30_000 })
  expect((await grants()).save).toBe(false)

  expect({ csp: await cspViolations(page, frame), ...problems, scripts: [] }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
    scripts: [],
  })
})
