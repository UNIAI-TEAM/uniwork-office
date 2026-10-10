// GO-B4/B5/B6 (UNI-1014/1015/1016): one smoke per web module. The module bundle
// (`npm run build:web -- --module <m>`, served at /office-frame/<m>/latest/ with its own
// headers.json, i.e. under its exact CSP header) boots inside the protocol test host, the
// handshake completes with the right module on both sides, the renderer mounts, and nothing
// is logged as a console error, page error or CSP violation.
// Run: npx playwright test -c web/e2e modules-smoke   (E2E_MODULES=pdf,slides for a subset)
import { test, expect, type Page } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const ALL = ['pdf', 'markdown', 'html', 'slides', 'sheets']
const MODULES = process.env.E2E_MODULES
  ? process.env.E2E_MODULES.split(',').map((m) => m.trim())
  : ALL

const built = (m: string): boolean => {
  const root = resolve(repoRoot, 'dist-web', m)
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

interface Problems {
  console: string[]
  page: string[]
  http: string[]
}

async function watch(page: Page): Promise<Problems> {
  const p: Problems = { console: [], page: [], http: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') p.console.push(`${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => p.page.push(`${e.message}\n${e.stack ?? ''}`))
  page.on('response', (r) => {
    if (r.status() >= 400) p.http.push(`${r.status()} ${r.url()}`)
  })
  // runs in every frame (host page and the module frame): collect violations where they happen
  await page.addInitScript(() => {
    const list: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = list
    document.addEventListener('securitypolicyviolation', (e) =>
      list.push(`${e.violatedDirective} blocked ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}`),
    )
  })
  return p
}

for (const module of MODULES) {
  test(`${module}: bundle boots in the test host, handshake completes, no console errors`, async ({
    page,
  }) => {
    test.skip(
      !built(module),
      `no dist-web/${module} build: npm run build:web -- --module ${module}`,
    )
    const problems = await watch(page)

    const html = await page.request.get(`/office-frame/${module}/latest/index.html`)
    expect(html.status()).toBe(200)
    // header-only CSP from the module's own headers.json
    expect(html.headers()['content-security-policy']).toContain("frame-ancestors 'self'")
    expect(await html.text()).not.toContain('http-equiv="Content-Security-Policy"')

    await page.goto(`/test-host/?module=${module}&lang=en`)
    await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })

    const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
    expect(frame.url()).toContain(`/office-frame/${module}/latest/index.html`)
    // the bridge ran first and the renderer mounted something into #root
    expect(
      await frame.evaluate(
        () => (window as unknown as { __officeWebModule?: string }).__officeWebModule,
      ),
    ).toBe(module)
    await frame.waitForFunction(
      () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
      null,
      {
        timeout: 30_000,
      },
    )
    // host-authoritative locale reached the renderer (lang=en in the test host's init)
    await expect.poll(() => frame.evaluate(() => document.documentElement.lang)).toMatch(/^en/)

    const ready = (await page.evaluate(() =>
      (
        window as unknown as {
          __host: { events: Array<{ type: string; payload: { module?: string } }> }
        }
      ).__host.events.find((e) => e.type === 'ready'),
    ))!
    expect(ready.payload.module).toBe(module)

    // let deferred boot work (lazy chunks, fonts, effects) run before judging
    await page.waitForTimeout(2_000)
    await page.screenshot({
      path: resolve(repoRoot, `web/e2e/.results/modules-smoke-${module}.png`),
    })

    const csp = [
      ...(await page.evaluate(
        () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
      )),
      ...(await frame.evaluate(
        () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
      )),
    ]
    expect({ csp, ...problems }).toEqual({ csp: [], console: [], page: [], http: [] })
  })
}

test('the host refuses a frame of another module (docs frame for a pdf document)', async ({
  page,
}) => {
  test.skip(!built('docs'), 'no dist-web/docs build: npm run build:web')
  await page.goto('/test-host/?module=pdf&frame=/index.html')
  await expect(page.locator('#status')).toHaveText('module mismatch: frame docs, document pdf', {
    timeout: 30_000,
  })
  const types = await page.evaluate(() =>
    (window as unknown as { __host: { events: Array<{ type: string }> } }).__host.events.map(
      (e) => e.type,
    ),
  )
  expect(types).toContain('ready')
})
