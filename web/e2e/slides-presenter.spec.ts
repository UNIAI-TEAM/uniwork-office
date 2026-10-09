// GO-B5 SP1 (UNI-1015, CONTRACT C15(2)): the Slides presenter view with its audience window, on the
// production build inside the protocol test host. Presenter view in the frame -> "Audience Window"
// opens the frame's own page in audience mode (window.open, same origin, same CSP header) ->
// next / previous / build steps / black screen stay in sync over the private port -> audience
// clicks drive the presenter -> closing the audience leaves the presenter running -> ending the show
// closes the audience. The Window Management API is mocked granted (the window is moved onto the
// second screen) and denied (default size, the user drags it). 0 console errors, 0 page errors,
// 0 CSP violations in the host page, the frame and the audience window. Screenshots (presenter +
// audience, light / dark, vi / en) go to docs/web-modules/screenshots/slides/.
// Run: npm run build:web -- --module slides && npx playwright test -c web/e2e slides-presenter
import { test, expect, type BrowserContext, type Frame, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const SHOTS = resolve(repoRoot, 'docs/web-modules/screenshots/slides')
const HOST = '/test-host/?module=slides&open=/fixtures/sample.pptx'

const LABELS = {
  en: { tab: 'Slide Show', presenter: 'Presenter View', audience: 'Audience Window' },
  vi: { tab: 'Trình chiếu', presenter: 'Chế độ xem của diễn giả', audience: 'Cửa sổ khán giả' },
} as const
type Lang = keyof typeof LABELS

interface SyncState {
  idx: number
  played: number
  playing: boolean
  fresh: boolean
  ended: boolean
  black: boolean
  white?: boolean
}

const built = (): boolean => {
  const root = resolve(repoRoot, 'dist-web/slides')
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

interface Problems {
  console: string[]
  page: string[]
}

function watchPage(p: Page, problems: Problems, label: string): void {
  p.on('console', (m) => {
    if (m.type() === 'error') problems.console.push(`[${label}] ${m.text()} @ ${m.location().url}`)
  })
  p.on('pageerror', (e) => problems.page.push(`[${label}] ${e.message}\n${e.stack ?? ''}`))
}

/**
 * Every page of the context (host, frame, audience window): CSP violation log, moveTo / resizeTo
 * recorder, and the Window Management API mock (`granted` | `denied`).
 */
async function prepare(context: BrowserContext, wm: 'granted' | 'denied'): Promise<Problems> {
  const problems: Problems = { console: [], page: [] }
  context.on('page', (p) => watchPage(p, problems, 'audience'))
  await context.addInitScript((mode) => {
    const w = window as unknown as Record<string, unknown>
    const csp: string[] = []
    w.__cspViolations = csp
    document.addEventListener('securitypolicyviolation', (e) =>
      csp.push(`${e.violatedDirective} blocked ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}`),
    )
    const moves: Array<[string, number, number]> = []
    w.__moves = moves
    const moveTo = window.moveTo.bind(window)
    const resizeTo = window.resizeTo.bind(window)
    window.moveTo = (x: number, y: number) => {
      moves.push(['move', x, y])
      moveTo(x, y)
    }
    window.resizeTo = (x: number, y: number) => {
      moves.push(['size', x, y])
      resizeTo(x, y)
    }
    const laptop = {
      availLeft: 0,
      availTop: 0,
      availWidth: 1440,
      availHeight: 900,
      isPrimary: true,
    }
    const projector = { availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080 }
    w.getScreenDetails = () =>
      // answer after the audience page has loaded (a permission prompt takes the user a moment too)
      new Promise((res, rej) =>
        setTimeout(
          () =>
            mode === 'granted'
              ? res({ screens: [laptop, projector], currentScreen: laptop })
              : rej(new DOMException('Permission denied', 'NotAllowedError')),
          800,
        ),
      )
  }, wm)
  return problems
}

async function cspViolations(...targets: Array<Page | Frame>): Promise<string[]> {
  const out: string[] = []
  for (const t of targets)
    out.push(
      ...(await t.evaluate(
        () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
      )),
    )
  return out
}

async function openDeck(page: Page, query = '&lang=en'): Promise<Frame> {
  await page.goto(HOST + query)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await expect(frame.locator('.thumb')).toHaveCount(5, { timeout: 30_000 })
  return frame
}

/** record what the presenter view broadcasts (the frame's own slidesApi.presenterSync) */
async function recordPresenter(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const api = window.slidesApi as unknown as Record<string, unknown>
    const sent: unknown[] = []
    ;(window as unknown as { __sent: unknown[] }).__sent = sent
    const orig = api.presenterSync as (s: unknown) => void
    api.presenterSync = (s: unknown) => {
      sent.push(s)
      orig(s)
    }
  })
}

const lastSent = (frame: Frame) =>
  frame.evaluate(() => {
    const sent = (window as unknown as { __sent: SyncState[] }).__sent
    return sent[sent.length - 1] ?? null
  })

/** record what the audience window receives */
async function recordAudience(audience: Page): Promise<void> {
  await audience.evaluate(() => {
    const got: unknown[] = []
    ;(window as unknown as { __got: unknown[] }).__got = got
    window.slidesApi.onShowSync((s) => got.push(s))
  })
}

const lastGot = (audience: Page) =>
  audience.evaluate(() => {
    const got = (window as unknown as { __got: SyncState[] }).__got
    return got[got.length - 1] ?? null
  })

async function startPresenter(frame: Frame, lang: Lang = 'en'): Promise<void> {
  await frame.getByRole('button', { name: LABELS[lang].tab, exact: true }).click()
  await frame.getByRole('button', { name: LABELS[lang].presenter }).first().click()
  await expect(frame.locator('.presenter')).toBeVisible()
  await expect(frame.locator('.presenter .pv-uncovered')).toHaveCount(0)
}

async function openAudience(page: Page, frame: Frame, lang: Lang = 'en'): Promise<Page> {
  const [audience] = await Promise.all([
    page.context().waitForEvent('page'),
    frame.getByRole('button', { name: LABELS[lang].audience, exact: true }).click(),
  ])
  await audience.waitForLoadState('domcontentloaded')
  await expect(audience.locator('.slideshow .ss-stagebox')).toBeVisible({ timeout: 30_000 })
  return audience
}

/** state equality the audience must reach after each presenter action */
async function inSync(frame: Frame, audience: Page): Promise<SyncState> {
  // settled: the presenter sent nothing new for a moment and the audience holds that same state
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const norm = (s: SyncState | null) =>
    s && Object.fromEntries(Object.entries(s).sort(([x], [y]) => x.localeCompare(y)))
  let settled: SyncState | null = null
  await expect
    .poll(
      async () => {
        const before = norm(await lastSent(frame))
        await new Promise((r) => setTimeout(r, 400))
        const after = norm(await lastSent(frame))
        const got = norm(await lastGot(audience))
        settled = after as SyncState | null
        return same(before, after) && same(after, got)
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  return settled!
}

test.describe('slides presenter view + audience window', () => {
  test.skip(!built(), 'no dist-web/slides build: npm run build:web -- --module slides')

  test('granted: audience on the second screen, in sync both ways, closes cleanly', async ({
    page,
    context,
  }) => {
    const problems = await prepare(context, 'granted')
    watchPage(page, problems, 'host')
    const frame = await openDeck(page)
    await recordPresenter(frame)
    await startPresenter(frame)

    // single screen until the user opens the audience window
    await expect(frame.locator('.pv-top-hint')).toContainText('Open the audience window')
    const audience = await openAudience(page, frame)

    // the frame's own page in audience mode, no handle back to the frame / UniWork page
    const url = new URL(audience.url())
    expect(url.pathname).toMatch(/^\/office-frame\/slides\/[^/]+\/index\.html$/)
    expect(url.searchParams.get('mode')).toBe('audience')
    expect(await audience.evaluate(() => window.opener)).toBeNull()
    const csp = (await page.request.get(audience.url())).headers()['content-security-policy']!
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain('media-src blob:')

    // Window Management granted: moved + sized onto the projector screen
    await expect
      .poll(() => audience.evaluate(() => (window as unknown as { __moves: unknown[] }).__moves))
      .toEqual([
        ['move', 1440, 0],
        ['size', 1920, 1080],
      ])

    await recordAudience(audience)
    await expect(frame.getByRole('button', { name: 'Close Audience Window' })).toBeVisible()
    await expect(frame.locator('.pv-top-hint')).toHaveCount(0)

    // next / builds / previous / black / white from the presenter
    // the audience got this state at connect time (before the recorder subscribed)
    const start = (await lastSent(frame))!
    expect(await audience.evaluate(() => window.slidesApi.audienceReady())).toEqual(start)
    await frame.locator('.pv-round').last().focus()
    const states: SyncState[] = [start]
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight')
      states.push(await inSync(frame, audience))
    }
    // three steps forward: page and / or build step advanced every time
    for (let i = 1; i < states.length; i++) {
      const [a, b] = [states[i - 1]!, states[i]!]
      expect(b.idx > a.idx || (b.idx === a.idx && b.played > a.played)).toBe(true)
    }
    const forward = states[states.length - 1]!
    await page.keyboard.press('ArrowLeft')
    const back = await inSync(frame, audience)
    expect(back.idx).toBeLessThan(forward.idx)

    await page.keyboard.press('b')
    expect((await inSync(frame, audience)).black).toBe(true)
    await expect(audience.locator('.ss-black')).toBeVisible()
    await page.keyboard.press('b')
    expect((await inSync(frame, audience)).black).toBe(false)
    await expect(audience.locator('.ss-black')).toHaveCount(0)
    await page.keyboard.press('w')
    expect((await inSync(frame, audience)).white).toBe(true)
    await expect(audience.locator('.ss-white')).toBeVisible()
    await page.keyboard.press('w')
    await inSync(frame, audience)

    // the audience window: first click = fullscreen (no navigation), then clicks drive the show
    await expect(audience.locator('.ss-fs-hint')).toBeVisible()
    const before = (await lastSent(frame))!
    await audience.mouse.click(400, 300)
    await expect.poll(() => audience.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await expect(audience.locator('.ss-fs-hint')).toHaveCount(0)
    expect(await lastSent(frame)).toEqual(before)
    await audience.mouse.click(400, 300)
    const clicked = await inSync(frame, audience)
    expect(clicked.idx > before.idx || clicked.played > before.played).toBe(true)
    await audience.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await lastSent(frame))!.idx).toBeLessThan(clicked.idx + 1)
    await inSync(frame, audience)

    // the user closes the audience window: the presenter view keeps working
    await audience.close()
    await expect(frame.getByRole('button', { name: 'Audience Window', exact: true })).toBeVisible()
    const label = await frame.locator('.pv-nav-label').textContent()
    await frame.locator('.pv-round').last().click()
    await frame.locator('.pv-round').last().click()
    await expect(frame.locator('.pv-nav-label')).not.toHaveText(label!)

    // reopen: the new window starts at the presenter's current state; End Show closes it
    const again = await openAudience(page, frame)
    await expect
      .poll(() => again.evaluate(() => window.slidesApi.audienceReady()))
      .toEqual(await lastSent(frame))
    await frame.locator('.pv-top-exit').click()
    await expect(frame.locator('.presenter')).toHaveCount(0)
    await expect.poll(() => again.isClosed()).toBe(true)

    expect(await cspViolations(page, frame)).toEqual([])
    expect(problems.page).toEqual([])
    expect(problems.console).toEqual([])
  })

  test('denied: default-size window the user drags, still in sync', async ({ page, context }) => {
    const problems = await prepare(context, 'denied')
    watchPage(page, problems, 'host')
    const frame = await openDeck(page)
    await recordPresenter(frame)
    await startPresenter(frame)
    const audience = await openAudience(page, frame)
    await recordAudience(audience)
    expect(await audience.evaluate(() => [window.outerWidth, window.outerHeight])).toEqual([
      960, 540,
    ])
    await page.waitForTimeout(1200)
    expect(
      await audience.evaluate(() => (window as unknown as { __moves: unknown[] }).__moves),
    ).toEqual([])
    // swap has nowhere to go without screen details
    await frame.getByRole('button', { name: /Swap Displays/ }).click()
    await frame.locator('.pv-round').last().click()
    await inSync(frame, audience)
    await page.keyboard.press('b')
    expect((await inSync(frame, audience)).black).toBe(true)
    expect(await cspViolations(page, frame, audience)).toEqual([])
    // Escape in the audience ends the whole show
    await audience.keyboard.press('Escape')
    await expect(frame.locator('.presenter')).toHaveCount(0)
    await expect.poll(() => audience.isClosed()).toBe(true)
    expect(problems.page).toEqual([])
    expect(problems.console).toEqual([])
  })

  test('screenshots: presenter + audience, light + dark, vi + en', async ({ page, context }) => {
    mkdirSync(SHOTS, { recursive: true })
    const problems = await prepare(context, 'denied')
    watchPage(page, problems, 'host')
    for (const lang of ['en', 'vi'] as const) {
      for (const theme of ['light', 'dark']) {
        const frame = await openDeck(page, `&lang=${lang}&theme=${theme}`)
        await startPresenter(frame, lang)
        await page.waitForTimeout(800)
        await page.screenshot({ path: resolve(SHOTS, `presenter-${lang}-${theme}.png`) })
        const audience = await openAudience(page, frame, lang)
        await page.waitForTimeout(800)
        await page.screenshot({
          path: resolve(SHOTS, `presenter-audience-open-${lang}-${theme}.png`),
        })
        if (theme === 'light')
          await audience.screenshot({ path: resolve(SHOTS, `audience-${lang}.png`) })
        await frame.locator('.pv-top-exit').click()
        await expect.poll(() => audience.isClosed()).toBe(true)
        expect(await cspViolations(page, frame)).toEqual([])
      }
    }
    expect(problems.page).toEqual([])
    expect(problems.console).toEqual([])
  })
})
