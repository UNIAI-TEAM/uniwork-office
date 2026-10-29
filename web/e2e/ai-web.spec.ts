// Web AI (CONTRACT C16, GO-A7 web AI contract) end to end on production builds in the protocol
// test host, against the fake frame-token AI routes (web/server/fake-ai.mjs). UniWork AI is the only
// AI of the frame (UNI-2289):
//   grant on  -> AI panel visible -> a reply streams on the UniWork AI route (Bearer frame token,
//                no cookies, 401 -> token refresh), never on a key or vendor route -> every typed
//                error state renders (402/403/429/502 on a turn, 503 on a cloud tool)
//   grant off -> no AI UI anywhere and no AI request.
//   UniWork AI + `ai.start` (UNI-2264) -> the host hands the panel a job: its question carries
//                X-UniWork-AI-Handoff, each next part goes out by itself while parts are left.
//   UniWork AI writer (UNI-2276) -> write_document goes to uniwork/write in the turn's run, its text
//                lands in the document, then the tool result goes back on the chat route.
// Docs (`npm run build:web`), Markdown and HTML (`npm run build:web -- --module markdown|html`). Zero console
// errors and CSP violations; the only HTTP errors are the ones a test injects on the AI routes.
// Screenshots (a reply, light/dark, en/vi): docs/web-modules/screenshots/ai/.
// Run: npx playwright test -c web/e2e ai-web
import { test, expect, type APIRequestContext, type Frame, type Page } from '@playwright/test'
import { built, cspViolations, screenshotPath, watch, type Problems } from './text-modules'

const REPLY = 'Hello from the UniWork AI proxy.'
/** a failed UniWork AI turn: its text (packages/ui/src/ai-uniwork/en.ts) is the panel's inline error */
const TURN_FAILURES = [
  { status: 402, code: 'credits_exhausted', text: 'out of AI credits' },
  { status: 403, code: 'entitlement_required', text: 'no longer includes UniWork AI' },
  // no Retry-After: the turn gives up at once instead of waiting
  { status: 429, code: 'rate_limited', text: 'sending too fast' },
  { status: 502, code: 'provider_unreachable', text: 'responding right now' },
] as const

interface LogEntry {
  method: string
  path: string
  authorization: string | null
  cookie: string | null
  /** the request's X-UniWork-AI-Handoff */
  handoff: string | null
  /** the request's X-UniWork-AI-Run / X-UniWork-AI-Conversation */
  run: string | null
  conversation: string | null
  body: Record<string, unknown>
}

async function fake(request: APIRequestContext, control?: Record<string, unknown>) {
  if (!control) {
    expect((await request.post('/__fake-ai/reset')).ok()).toBe(true)
    return
  }
  expect((await request.post('/__fake-ai/control', { data: control })).ok()).toBe(true)
}

// the fake server is per-run and its state outlives this file: a fail rule or a scripted turn seeded here
// would still be stored when the next spec's tests run (UNI-1919). Reset on the way out too, the same
// endpoint every test above already calls on the way in.
test.afterEach(async ({ request }) => {
  await fake(request)
})

async function aiLog(request: APIRequestContext): Promise<LogEntry[]> {
  return (await (await request.get('/__fake-ai/log')).json()) as LogEntry[]
}

/** the UniWork AI composer's one-line view-only notice (the same in every panel) */
const VIEW_ONLY_NOTICE = '.ai-uniwork-view-only'

/** tool names that change the document, across docs / markdown / html (the read-only set is read_*, get_*, web_search, ...) */
const EDIT_TOOLS =
  /^(apply_ops|write_document|plan_page|insert_|replace_|generate_image|edit_|add_|delete_|accept_|reject_|reply_|resolve_|set_|create_|propose_)/

/** open a module in the test host (docs: the site-root build) and wait for the renderer */
async function open(
  page: Page,
  module: 'docs' | 'markdown' | 'html',
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

/** UniWork AI asks once per document before the first question (S8): acknowledge it */
async function acknowledge(frame: Frame) {
  await frame.locator('.ai-uniwork-disclosure-ack').click()
}

async function ask(frame: Frame, text: string) {
  const box = frame.locator('.ai-input-box textarea').first()
  await expect(box).toBeVisible({ timeout: 30_000 })
  await expect(box).toBeEnabled()
  await expect(frame.locator('.ai-msg-streaming')).toHaveCount(0, { timeout: 30_000 })
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
        webSearch: false,
        imageGeneration: false,
      })
      expect(caps).not.toHaveProperty('aiCredentials')
      expect(await aiLog(request)).toEqual([])
      await expectClean(page, frame, problems)
    })

    test('grant on: panel visible, reply streams on the UniWork AI route with the frame token', async ({
      page,
      request,
    }) => {
      await fake(request)
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en', uniwork: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await acknowledge(frame)
      await ask(frame, 'Say hello')
      await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
        timeout: 60_000,
      })
      const log = await aiLog(request)
      const chat = log.find((l) => l.path.endsWith('/uniwork/chat/completions'))!
      expect(chat, JSON.stringify(log)).toBeTruthy()
      expect(chat.method).toBe('POST')
      expect(chat.authorization).toBe('Bearer test-token')
      expect(chat.cookie).toBeNull()
      expect(chat.body.stream).toBe(true)
      for (const l of log) expect(l.path).toMatch(/^\/api\/v1\/office-frame\/documents\/f1\/ai\//)
      await expectClean(page, frame, problems)
    })

    test('grant on: opening the panel and a turn never reach a key or vendor route (UNI-2289)', async ({
      page,
      request,
    }) => {
      await fake(request)
      const frame = await open(page, module, { lang: 'en', uniwork: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await acknowledge(frame)
      await ask(frame, 'Say hello')
      await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
        timeout: 60_000,
      })
      const paths = (await aiLog(request)).map((l) => l.path)
      expect(paths.some((p) => p.endsWith('/uniwork/chat/completions'))).toBe(true)
      expect(paths.filter((p) => /\/ai\/credentials|\/ai\/byok\//.test(p))).toEqual([])
    })

    for (const s of TURN_FAILURES) {
      test(`grant on: HTTP ${s.status} renders the ${s.code} state`, async ({ page, request }) => {
        await fake(request)
        await fake(request, {
          fail: [
            {
              status: s.status,
              ...(s.status === 429 ? {} : { code: s.code }),
              // the chat call only: a background cloud read would eat an unscoped one-shot rule
              path: '/chat/completions',
            },
          ],
        })
        const problems = await watch(page)
        const frame = await open(page, module, { lang: 'en', uniwork: '1' })
        await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
        await acknowledge(frame)
        await ask(frame, 'Say hello')
        // one surface: the panel's inline error carries the whole typed text; no card beside it
        const inline = frame.locator('.ai-msg-assistant').last()
        await expect(inline).toContainText(s.text, { timeout: 30_000 })
        await expect(frame.locator('.ow-ai-state')).toHaveCount(0)
        await expectClean(page, frame, problems, true)
      })
    }

    test('grant on: 503 cloud_unavailable from a cloud tool, 401 -> token refresh', async ({
      page,
      request,
    }) => {
      await fake(request)
      await fake(request, {
        fail: [{ status: 503, code: 'cloud_unavailable', path: '/cloud/search' }],
      })
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en', uniwork: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await acknowledge(frame)
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
      // the next chat call gets a 401: the frame refreshes its token (host token.refresh) and retries once.
      // Aimed at the chat only: a background cloud status read would eat an unscoped one-shot and the
      // chat would then go out once, with the new token
      await fake(request, { unauthorizedOnce: { path: '/chat/completions' } })
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
  })
}

// M-01 (post-A9 sweep): a frame without the save grant (?readonly=1) gets the view-only AI -- the
// one-line notice in the composer and a model request that offers no editing tool -- in every
// module that has the web AI panel (Sheets: sheets-ai.spec.ts)
for (const module of ['docs', 'markdown', 'html'] as const) {
  test.describe(`${module}: view-only AI`, () => {
    test.skip(
      !built(module),
      `no dist-web/${module} build: npm run build:web${module === 'docs' ? '' : ` -- --module ${module}`}`,
    )

    test('no save grant: the composer carries the view-only notice and the model gets no edit tool', async ({
      page,
      request,
    }) => {
      await fake(request)
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en', uniwork: '1', readonly: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await acknowledge(frame)
      const notice = frame.locator(VIEW_ONLY_NOTICE)
      await expect(notice).toBeVisible()
      await expect(notice).toContainText('View only')
      // it still answers questions
      await ask(frame, 'Say hello')
      await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
        timeout: 60_000,
      })
      const chat = (await aiLog(request)).find((l) => l.path.endsWith('/uniwork/chat/completions'))!
      expect(chat).toBeTruthy()
      const tools = ((chat.body.tools ?? []) as Array<{ function: { name: string } }>).map(
        (t) => t.function.name,
      )
      expect(tools.filter((n) => EDIT_TOOLS.test(n))).toEqual([])
      await expectClean(page, frame, problems)
    })

    test('with the save grant there is no view-only notice', async ({ page, request }) => {
      await fake(request)
      const frame = await open(page, module, { lang: 'en', uniwork: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await expect(frame.locator(VIEW_ONLY_NOTICE)).toHaveCount(0)
    })
  })
}

// visual evidence for tester_visual: a reply in the panel in both themes and languages
for (const theme of ['light', 'dark'] as const) {
  for (const lang of ['en', 'vi'] as const) {
    test(`docs: AI screenshots ${theme} ${lang}`, async ({ page, request }) => {
      test.skip(!built('docs'), 'no dist-web/docs build')
      await fake(request)
      const frame = await open(page, 'docs', { lang, theme, uniwork: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await acknowledge(frame)
      await ask(frame, 'Hello')
      await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
        timeout: 30_000,
      })
      await expect(frame.locator('.ow-ai-state')).toHaveCount(0)
      await page.screenshot({ path: screenshotPath('ai', `docs-state-${theme}-${lang}`) })
    })
  }
}

// UNI-2264: on a UniWork AI frame the host hands the panel a job with `ai.start`. The question that
// runs it carries X-UniWork-AI-Handoff; while the server says parts are left
// (X-UniWork-AI-Handoff-Remaining >= 1) the next part's question goes out by itself and carries it
// too; the last part (0) ends the job.
const JOB = 'Draft this document from the job Ask UNI handed over: Plan'
const HANDOFF_ID = 'h1'

async function uniworkQuestions(request: APIRequestContext): Promise<LogEntry[]> {
  return (await aiLog(request)).filter((l) => l.path.endsWith('/uniwork/chat/completions'))
}

/** the host's `ai.start`, as the UniWork host sends it once the document is open */
function startJob(page: Page): Promise<unknown> {
  return page.evaluate(
    ([handoffId, text]) =>
      (
        window as unknown as {
          __host: { request(type: string, payload: unknown): Promise<unknown> }
        }
      ).__host.request('ai.start', { handoffId, text, displayText: text }),
    [HANDOFF_ID, JOB] as const,
  )
}

/** the words of a question: its last user message */
function asked(entry: LogEntry): string {
  const messages = (entry.body.messages ?? []) as Array<{ role: string; content: unknown }>
  const last = messages.filter((m) => m.role === 'user').at(-1)
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? null)
}

for (const module of ['docs', 'markdown', 'html'] as const) {
  test.describe(`${module}: a job handed over with ai.start`, () => {
    test.skip(
      !built(module),
      `no dist-web/${module} build: npm run build:web${module === 'docs' ? '' : ` -- --module ${module}`}`,
    )

    test('the job runs part by part, every question tagged with the job', async ({
      page,
      request,
    }) => {
      await fake(request)
      await fake(request, { handoffRemaining: [1, 0] })
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en', uniwork: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await acknowledge(frame)
      expect(await startJob(page)).toEqual({ queued: true })
      // the job's question, then the next part by itself: both carry the job id
      await expect
        .poll(async () => (await uniworkQuestions(request)).map((l) => l.handoff), {
          timeout: 60_000,
        })
        .toEqual([HANDOFF_ID, HANDOFF_ID])
      const [first, next] = await uniworkQuestions(request)
      expect(asked(first!)).toContain(JOB)
      expect(asked(next!)).toContain('Continue with the next part.')
      // the second part said none are left: no third question
      await frame.waitForTimeout(4_000)
      expect(await uniworkQuestions(request)).toHaveLength(2)
      await expect(frame.locator('.ai-msg-user')).toHaveCount(2)
      await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY)
      await expectClean(page, frame, problems)
    })

    test('a job that arrives before the disclosure is acknowledged waits in the composer', async ({
      page,
      request,
    }) => {
      await fake(request)
      await fake(request, { handoffRemaining: [0] })
      const problems = await watch(page)
      const frame = await open(page, module, { lang: 'en', uniwork: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      expect(await startJob(page)).toEqual({ queued: true })
      const box = frame.locator('.ai-input-box textarea').first()
      await expect(box).toHaveValue(JOB)
      expect(await uniworkQuestions(request)).toEqual([])
      // the person acknowledges and sends what waits there: it is still the job's question
      await acknowledge(frame)
      await box.press('Enter')
      await expect
        .poll(async () => (await uniworkQuestions(request)).map((l) => l.handoff), {
          timeout: 60_000,
        })
        .toEqual([HANDOFF_ID])
      await frame.waitForTimeout(4_000)
      expect(await uniworkQuestions(request)).toHaveLength(1)
      await expectClean(page, frame, problems)
    })
  })
}

// UNI-2276: under UniWork AI the Word writer behind write_document runs on the writer route, inside
// the run of the turn that called it (the run header the chat answer issued); the reply streams into
// the document and the tool result then goes back on the chat route.
test.describe('docs: the UniWork AI writer route', () => {
  test.skip(!built('docs'), 'no dist-web/docs build: npm run build:web')

  test('write_document streams from uniwork/write in the turn run, then the tool result follows', async ({
    page,
    request,
  }) => {
    await fake(request)
    await fake(request, {
      toolCalls: [
        { name: 'write_document', input: { plan: 'One short section', afterBlockIndex: -1 } },
      ],
    })
    const problems = await watch(page)
    const frame = await open(page, 'docs', { lang: 'en', uniwork: '1' })
    await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
    await acknowledge(frame)
    await ask(frame, 'Write a short document')
    await expect(frame.locator('.ProseMirror').first()).toContainText(
      'Written by the fake writer route.',
      { timeout: 60_000 },
    )
    await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
      timeout: 60_000,
    })
    const log = (await aiLog(request)).filter((l) => l.path.includes('/uniwork/'))
    // the question, the writer call, then the tool result
    expect(log.map((l) => (l.path.endsWith('/uniwork/write') ? 'write' : 'chat'))).toEqual([
      'chat',
      'write',
      'chat',
    ])
    const [question, write, toolResult] = log
    expect(question!.run).toBeNull()
    // the writer goes out in the run the question's answer issued, never a run of its own
    expect(write!.run).toBe('run-1')
    expect(write!.conversation).toBe('conv-1')
    expect(write!.authorization).toBe('Bearer test-token')
    expect(write!.body).toMatchObject({
      kind: 'docs.write_document',
      lang: 'en',
      input: { plan: 'One short section' },
    })
    // the server holds the prompt: the writer call carries no prompt text
    expect(JSON.stringify(write!.body)).not.toContain('restricted HTML')
    expect(toolResult!.run).toBe('run-1')
    const messages = (toolResult!.body.messages ?? []) as Array<{ role: string }>
    expect(messages.map((m) => m.role)).toContain('tool')
    await expectClean(page, frame, problems)
  })
})
