// Shared helpers of the Markdown / HTML module e2e (GO-B4, UNI-1014): production builds
// (`npm run build:web -- --module <m>`) in the protocol test host, under the module's exact CSP header.
import { expect, type Frame, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const repoRoot = resolve(__dirname, '../..')

export const built = (m: string): boolean => {
  const root = resolve(repoRoot, 'dist-web', m)
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

export interface Problems {
  console: string[]
  page: string[]
  http: string[]
  /** requests to anything but the test server (nothing may leave the frame) */
  external: string[]
}

/** collect console errors, page errors, HTTP errors, CSP violations and off-origin requests */
export async function watch(page: Page): Promise<Problems> {
  const p: Problems = { console: [], page: [], http: [], external: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') p.console.push(`${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => p.page.push(`${e.message}\n${e.stack ?? ''}`))
  page.on('response', (r) => {
    if (r.status() >= 400) p.http.push(`${r.status()} ${r.url()}`)
  })
  page.on('request', (r) => {
    const url = r.url()
    if (/^(data|blob|about):/.test(url)) return
    if (
      !url.startsWith(new URL(page.url() || 'http://localhost').origin) &&
      !/^http:\/\/localhost:\d+\//.test(url)
    ) {
      p.external.push(url)
    }
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

export async function cspViolations(page: Page, frame: Frame): Promise<string[]> {
  return [
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
    ...(await frame.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )),
  ]
}

/** serve `bytes` at `path` (the test host fetches `?open=` from its own origin) */
export async function serveFixture(page: Page, path: string, bytes: Uint8Array, type: string) {
  await page.route(`**${path}`, (route) =>
    route.fulfill({ status: 200, body: Buffer.from(bytes), headers: { 'content-type': type } }),
  )
}

export interface HostView {
  lastSaved: { fileId: string; name: string; versionId: string; bytes: number[] } | null
  files: Array<{ fileId: string; name: string; versionId: string }>
}

export async function hostState(page: Page): Promise<HostView> {
  return page.evaluate(() => {
    const h = (window as unknown as { __host: { lastSaved: () => unknown; files: () => unknown } })
      .__host
    return { lastSaved: h.lastSaved(), files: h.files() } as HostView
  })
}

export async function bumpRemote(page: Page, fileId: string): Promise<void> {
  await page.evaluate(
    (id) =>
      (window as unknown as { __host: { bumpRemote: (id: string) => unknown } }).__host.bumpRemote(
        id,
      ),
    fileId,
  )
}

/** open the module in the test host and wait for the handshake + the renderer */
export async function openModule(
  page: Page,
  module: string,
  query: Record<string, string>,
): Promise<Frame> {
  const qs = new URLSearchParams({ module, ...query })
  await page.goto(`/test-host/?${qs}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await frame.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0)
  return frame
}

/** reload only the frame: the test host re-runs the handshake and the renderer opens the latest version */
export async function reloadFrame(page: Page): Promise<Frame> {
  const readyCount = () =>
    page.evaluate(
      () =>
        (window as unknown as { __host: { events: Array<{ type: string }> } }).__host.events.filter(
          (e) => e.type === 'ready',
        ).length,
    )
  const before = await readyCount()
  await page.evaluate(() => {
    ;(document.getElementById('frame') as HTMLIFrameElement).contentWindow!.location.reload()
  })
  await expect.poll(readyCount, { timeout: 30_000 }).toBeGreaterThan(before)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await frame.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0)
  return frame
}

export function screenshotPath(module: string, name: string): string {
  const dir = resolve(repoRoot, 'docs/web-modules/screenshots', module)
  mkdirSync(dir, { recursive: true })
  return resolve(dir, `${name}.png`)
}

export const encode = (s: string): Uint8Array => new TextEncoder().encode(s)
export const BOM = new Uint8Array([0xef, 0xbb, 0xbf])

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
