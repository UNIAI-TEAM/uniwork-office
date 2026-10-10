// Web AI (CONTRACT C16, GO-A7 web AI contract) end to end on production builds in the protocol
// test host, against the fake frame-token AI routes (web/server/fake-ai.mjs):
//   grant on  -> AI panel visible -> a reply streams through the BYOK proxy (Bearer frame token,
//                no cookies, 401 -> token refresh) -> AI settings = UniWork credentials (PUT/DELETE,
//                masked key_hint) -> every typed error state renders (402/403/404/424/429/502/503)
//   grant off -> no AI UI anywhere and no AI request.
// Docs (`npm run build:web`) and Markdown (`npm run build:web -- --module markdown`). Zero console
// errors and CSP violations; the only HTTP errors are the ones a test injects on the AI routes.
// Screenshots (settings dialog + a state card, light/dark, en/vi): docs/web-modules/screenshots/ai/.
// Run: npx playwright test -c web/e2e ai-web
import { test, expect, type APIRequestContext, type Frame, type Page } from '@playwright/test'
import { built, cspViolations, screenshotPath, watch, type Problems } from './text-modules'

const REPLY = 'Hello from the UniWork AI proxy.'
const KEY_CODES = [
  { status: 402, code: 'credits_exhausted', title: 'AI credits used up' },
  { status: 403, code: 'entitlement_required', title: 'AI is not in your plan' },
  { status: 404, code: 'credential_missing', title: 'No OpenAI key' },
  { status: 424, code: 'provider_auth_failed', title: 'OpenAI refused the key' },
  { status: 429, code: 'rate_limited', title: 'Too many AI requests', retryAfter: 7 },
  { status: 502, code: 'provider_unreachable', title: 'AI provider unreachable' },
] as const

interface LogEntry {
  method: string
  path: string
  authorization: string | null
  cookie: string | null
  body: Record<string, unknown>
}

async function fake(request: APIRequestContext, control?: Record<string, unknown>) {
  if (!control) {
    expect((await request.post('/__fake-ai/reset')).ok()).toBe(true)
    return
  }
  expect((await request.post('/__fake-ai/control', { data: control })).ok()).toBe(true)
}

async function aiLog(request: APIRequestContext): Promise<LogEntry[]> {
  return (await (await request.get('/__fake-ai/log')).json()) as LogEntry[]
}

const OPENAI_KEY = [{ provider: 'openai', api_key: 'sk-test-openai-abcd' }]

/** open a module in the test host (docs: the site-root build) and wait for the renderer */
async function open(
  page: Page,
  module: 'docs' | 'markdown',
  query: Record<string, string>,
): Promise<Frame> {
  const qs = new URLSearchParams(
    module === 'docs' ? { open: '/fixtures/simple.docx', ...query } : { module, ...query },
  )
  await page.goto(`/test-host/?${qs}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await frame.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0)
  return frame
}

const panel = (frame: Frame) => frame.locator('.ai-panel-header')

async function ask(frame: Frame, text: string) {
  const box = frame.locator('.ai-input-box textarea').first()
  await expect(box).toBeVisible({ timeout: 30_000 })
  await box.fill(text)
  await box.press('Enter')
}

/** problems minus the AI-route HTTP errors a test injected on purpose */
async function expectClean(page: Page, frame: Frame, problems: Problems, allowAiHttp = false) {
  const csp = await cspViolations(page, frame)
  const http = allowAiHttp
    ? problems.http.filter((h) => !/\/office-frame\/documents\/[^/]+\/ai\//.test(h))
    : problems.http
  // a failed fetch is logged by Chromium as a console error for the injected statuses only
  const console = allowAiHttp
    ? problems.console.filter((c) => !/status of (40[0-4]|424|429|50[23])/.test(c))
    : problems.console
  expect({ csp, console, page: problems.page, http, external: problems.external }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
    external: [],
  })
}

for (const module of ['docs', 'markdown'] as const) {
  test.describe(`${module}: web AI`, () => {
    test.skip(
      !built(module),
      `no dist-web/${module} build: npm run build:web${module === 'docs' ? '' : ` -- --module ${module}`}`,
    )

    test('grant off: no AI UI anywhere and no AI request', async ({ page, request }) => {
      await fake(request)
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en' })
      await frame.waitForTimeout(1500)
      await expect(panel(frame)).toHaveCount(0)
      await expect(frame.locator('.ai-input-box')).toHaveCount(0)
      await expect(frame.locator('[data-ai-state], .ow-ai-dialog')).toHaveCount(0)
      const caps = await frame.evaluate(
        (g) =>
          (window as unknown as Record<string, { capabilities: Record<string, unknown> }>)[g]!
            .capabilities,
        module === 'docs' ? 'desktop' : 'markdownApi',
      )
      expect(caps).toMatchObject({
        ai: false,
        aiCredentials: false,
        webSearch: false,
        imageGeneration: false,
      })
      expect(await aiLog(request)).toEqual([])
      await expectClean(page, frame, problems)
    })

    test('grant on: panel visible, reply streams through the proxy with the frame token', async ({
      page,
      request,
    }) => {
      await fake(request)
      await fake(request, { credentials: OPENAI_KEY })
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en', ai: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await ask(frame, 'Say hello')
      await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
        timeout: 60_000,
      })
      const log = await aiLog(request)
      const chat = log.find((l) => l.path.endsWith('/byok/openai/chat/completions'))!
      expect(chat, JSON.stringify(log)).toBeTruthy()
      expect(chat.method).toBe('POST')
      expect(chat.authorization).toBe('Bearer test-token')
      expect(chat.cookie).toBeNull()
      expect(chat.body.stream).toBe(true)
      expect(JSON.stringify(chat.body)).not.toContain('sk-test')
      for (const l of log) expect(l.path).toMatch(/^\/api\/v1\/office-frame\/documents\/f1\/ai\//)
      await expectClean(page, frame, problems)
    })

    for (const s of KEY_CODES) {
      test(`grant on: HTTP ${s.status} renders the ${s.code} state`, async ({ page, request }) => {
        await fake(request)
        await fake(request, {
          credentials: OPENAI_KEY,
          fail: [
            {
              status: s.status,
              ...(s.status === 429 ? {} : { code: s.code }),
              ...('retryAfter' in s ? { retryAfter: s.retryAfter } : {}),
              path: '/byok/',
            },
          ],
        })
        const problems = await watch(page)
        const frame = await open(page, module, { lang: 'en', ai: '1' })
        await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
        await ask(frame, 'Say hello')
        const card = frame.locator(`.ow-ai-state[data-ai-state="${s.code}"]`)
        await expect(card).toBeVisible({ timeout: 30_000 })
        await expect(card).toContainText(s.title)
        if (s.status === 429) await expect(card).toContainText('7 s')
        await expect(frame.locator('.ai-msg-assistant').last()).toContainText(s.title)
        const settingsButton = card.getByRole('button', { name: 'AI settings' })
        await expect(settingsButton).toHaveCount(
          s.code === 'credential_missing' || s.code === 'provider_auth_failed' ? 1 : 0,
        )
        await expectClean(page, frame, problems, true)
      })
    }

    test('grant on: 503 cloud_unavailable from a cloud tool, 401 -> token refresh', async ({
      page,
      request,
    }) => {
      await fake(request)
      await fake(request, {
        credentials: OPENAI_KEY,
        fail: [{ status: 503, code: 'cloud_unavailable', path: '/cloud/search' }],
      })
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en', ai: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      const global = module === 'docs' ? 'desktop' : 'markdownApi'
      const r = await frame.evaluate(
        (g) =>
          (
            window as unknown as Record<
              string,
              { webSearch(q: string): Promise<{ method: string; error?: string }> }
            >
          )[g]!.webSearch('cats'),
        global,
      )
      expect(r.method).toBe('error')
      await expect(frame.locator('.ow-ai-state[data-ai-state="cloud_unavailable"]')).toBeVisible()
      // the next AI call gets a 401: the frame refreshes its token (host token.refresh) and retries once
      await fake(request, { unauthorizedOnce: true })
      await ask(frame, 'Say hello')
      await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
        timeout: 60_000,
      })
      const chats = (await aiLog(request)).filter((l) => l.path.endsWith('/chat/completions'))
      expect(chats.map((c) => c.authorization)).toEqual([
        'Bearer test-token',
        expect.stringMatching(/^Bearer t-\d+$/),
      ])
      await expectClean(page, frame, problems, true)
    })

    test('AI settings = UniWork credentials: add a key from the missing-key state, reply, remove it', async ({
      page,
      request,
    }) => {
      await fake(request)
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en', ai: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      // no key stored yet: the turn ends in the credential_missing state
      await ask(frame, 'Say hello')
      const card = frame.locator('.ow-ai-state[data-ai-state="credential_missing"]')
      await expect(card).toBeVisible({ timeout: 30_000 })
      await card.getByRole('button', { name: 'AI settings' }).click()
      const dialog = frame.locator('.ow-ai-dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('No key saved')
      await expect(dialog).toContainText('Credits left: 98,500 of 100,000')
      await dialog.locator('select[name="provider"]').selectOption('openai')
      await dialog.locator('input[name="api_key"]').fill('sk-live-key-9876')
      await dialog.getByRole('button', { name: 'Save key' }).click()
      await expect(dialog).toContainText('Saved key …9876')
      await expect(dialog.locator('input[name="api_key"]')).toHaveValue('')
      const html = await dialog.innerHTML()
      expect(html).not.toContain('sk-live-key')
      await page.screenshot({ path: screenshotPath('ai', `${module}-settings-light-en`) })
      await dialog.getByRole('button', { name: 'Done' }).click()
      await expect(dialog).toHaveCount(0)
      await ask(frame, 'Say hello again')
      await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
        timeout: 60_000,
      })
      // the header entry opens the same dialog; remove the key there
      await frame.locator('.ai-panel-header').getByRole('button', { name: 'AI settings' }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Remove key' }).click()
      await expect(dialog).toContainText('No key saved')
      const log = await aiLog(request)
      const put = log.find((l) => l.method === 'PUT')!
      expect(put.path).toMatch(/\/ai\/credentials\/openai$/)
      expect(put.body.api_key).toBe('<set>')
      expect(log.some((l) => l.method === 'DELETE' && l.path.endsWith('/credentials/openai'))).toBe(
        true,
      )
      await expectClean(page, frame, problems, true)
    })
  })
}

// visual evidence for tester_visual: the state card and the settings dialog in both themes and languages
for (const theme of ['light', 'dark'] as const) {
  for (const lang of ['en', 'vi'] as const) {
    test(`docs: AI screenshots ${theme} ${lang}`, async ({ page, request }) => {
      test.skip(!built('docs'), 'no dist-web/docs build')
      await fake(request)
      await fake(request, { credentials: [{ provider: 'openai', api_key: 'bad-key-0000' }] })
      const frame = await open(page, 'docs', { lang, theme, ai: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await ask(frame, 'Hello')
      const card = frame.locator('.ow-ai-state[data-ai-state="provider_auth_failed"]')
      await expect(card).toBeVisible({ timeout: 30_000 })
      await page.screenshot({ path: screenshotPath('ai', `docs-state-${theme}-${lang}`) })
      await card.locator('button.primary').click()
      await expect(frame.locator('.ow-ai-dialog select[name="provider"]')).toBeVisible()
      await page.screenshot({ path: screenshotPath('ai', `docs-settings-${theme}-${lang}`) })
    })
  }
}
