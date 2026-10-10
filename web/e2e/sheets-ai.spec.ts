// UNI-1016 (SH4): AI in the web Sheets frame, production build (`npm run build:web -- --module sheets`,
// its exact CSP header) in the protocol test host, against the fake frame-token AI routes
// (web/server/fake-ai.mjs, CONTRACT C16):
//   grant off -> no AI UI anywhere and no AI request
//   grant on  -> the AI panel (UniWork settings entry, no attach button) -> a reply streams through
//                the BYOK proxy with the frame token -> a plan operation (propose_operations) edits a
//                cell and the save carries it -> the model is offered only what the frame can run
//                (no create_document, no workbook merge) -> every typed error state renders
// Zero console errors and CSP violations; the only HTTP errors are the ones a test injects on the AI
// routes. Screenshots (panel + state card, light/dark, en/vi): docs/web-modules/screenshots/ai/.
// Run: npx playwright test -c web/e2e sheets-ai
import { test, expect, type APIRequestContext, type Frame, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { buildEditFixture } from '../../apps/sheets/tests/fixture-builder'
import {
  built,
  cspViolations,
  repoRoot,
  screenshotPath,
  watch,
  type Problems,
} from './text-modules'

const REPLY = 'Hello from the UniWork AI proxy.'
const OPENAI_KEY = [{ provider: 'openai', api_key: 'sk-test-openai-abcd' }]
const KEY_CODES = [
  { status: 402, code: 'credits_exhausted', title: 'AI credits used up' },
  { status: 403, code: 'entitlement_required', title: 'AI is not in your plan' },
  { status: 404, code: 'credential_missing', title: 'No AI key yet' },
  { status: 424, code: 'provider_auth_failed', title: 'The AI key was refused' },
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

const sheetsBuilt = () => built('sheets')

type ShownWorkbook = {
  sessionId: string
  name: string
  sheets: Array<{ id: string; name: string }>
}

/** open Edit.xlsx in the Sheets frame and wait until the engine shows it */
async function open(
  page: Page,
  query: Record<string, string>,
): Promise<{ frame: Frame; wb: ShownWorkbook }> {
  const qs = new URLSearchParams({ module: 'sheets', open: '/fixtures/Edit.xlsx', ...query })
  await page.goto(`/test-host/?${qs}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  const state = () =>
    frame.evaluate(() =>
      (
        window as unknown as { __sheetsWebState: { workbook: () => unknown } }
      ).__sheetsWebState.workbook(),
    ) as Promise<ShownWorkbook | null>
  await expect.poll(async () => (await state()) !== null, { timeout: 60_000 }).toBe(true)
  await expect(frame.locator('canvas[id^="univer-sheet-main-canvas"]').first()).toBeVisible()
  return { frame, wb: (await state())! }
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

test.beforeAll(() => {
  const dir = resolve(repoRoot, 'web/e2e/.results/fixtures')
  mkdirSync(dir, { recursive: true })
  return buildEditFixture().then((bytes) => writeFileSync(resolve(dir, 'Edit.xlsx'), bytes))
})

test.describe('sheets: web AI', () => {
  test.skip(!sheetsBuilt(), 'no dist-web/sheets build: npm run build:web -- --module sheets')

  test('grant off: no AI UI anywhere and no AI request', async ({ page, request }) => {
    await fake(request)
    const problems = await watch(page)
    const { frame } = await open(page, { lang: 'en' })
    await frame.waitForTimeout(1500)
    await expect(panel(frame)).toHaveCount(0)
    await expect(frame.locator('.ai-input-box')).toHaveCount(0)
    await expect(frame.locator('[data-ai-state], .ow-ai-dialog')).toHaveCount(0)
    const caps = await frame.evaluate(
      () =>
        (window as unknown as { desktopApi: { capabilities: Record<string, unknown> } }).desktopApi
          .capabilities,
    )
    expect(caps).toMatchObject({
      ai: false,
      aiCredentials: false,
      webSearch: false,
      imageSearch: false,
      imageGeneration: false,
      createDocument: false,
      mergeWorkbooks: false,
    })
    expect(await aiLog(request)).toEqual([])
    await expectClean(page, frame, problems)
  })

  test('grant on at 390 px: the dock starts collapsed and opens as an overlay, the grid keeps its width (S-03)', async ({
    page,
    request,
  }) => {
    await fake(request)
    await page.setViewportSize({ width: 390, height: 844 })
    const problems = await watch(page)
    const { frame } = await open(page, { lang: 'en', ai: '1' })
    const grid = frame.locator('canvas[id^="univer-sheet-main-canvas"]').first()
    const gridWidth = async () => (await grid.boundingBox())?.width ?? 0
    // collapsed rail, no chat panel, the grid is not squeezed
    await expect(frame.locator('.copilot.collapsed .expand-copilot')).toBeVisible()
    await expect(panel(frame)).toHaveCount(0)
    const closedWidth = await gridWidth()
    expect(closedWidth).toBeGreaterThan(300)
    // opening it overlays the grid: it covers the sheet from the edge but the grid keeps its width
    await frame.locator('.expand-copilot').click()
    await expect(panel(frame)).toBeVisible()
    const dock = (await frame.locator('.copilot:not(.collapsed)').boundingBox())!
    expect(dock.width).toBeLessThanOrEqual(390 - 34)
    expect(await gridWidth()).toBeGreaterThanOrEqual(closedWidth - 1)
    // no horizontal page scroll
    const shell = (await frame.locator('.sheet-body').boundingBox())!
    expect(shell.x + shell.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: screenshotPath('ai', 'sheets-390-open-en-light') })
    // the dock collapses back to its rail
    await frame.locator('.ai-panel-collapse').first().click()
    await expect(frame.locator('.copilot.collapsed')).toBeVisible()
    await expectClean(page, frame, problems)
  })

  test('grant on: panel, reply streams with the frame token, the model is offered only web-safe tools', async ({
    page,
    request,
  }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    const problems = await watch(page)
    const { frame } = await open(page, { lang: 'en', ai: '1' })
    await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
    // the UniWork settings entry is there; the desktop-only attach button is not
    await expect(
      frame.locator('.ai-panel-header').getByRole('button', { name: 'AI Settings' }),
    ).toBeVisible()
    await expect(frame.locator('.ai-attach-btn')).toHaveCount(0)
    await ask(frame, 'Say hello')
    await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
      timeout: 60_000,
    })
    const log = await aiLog(request)
    const chat = log.find((l) => l.path.endsWith('/byok/openai/chat/completions'))!
    expect(chat, JSON.stringify(log)).toBeTruthy()
    expect(chat.authorization).toBe('Bearer test-token')
    expect(chat.cookie).toBeNull()
    expect(chat.body.stream).toBe(true)
    expect(JSON.stringify(chat.body)).not.toContain('sk-test')
    for (const l of log) expect(l.path).toMatch(/^\/api\/v1\/office-frame\/documents\/f1\/ai\//)
    const tools = (chat.body.tools as Array<{ function: { name: string } }>).map(
      (t) => t.function.name,
    )
    expect(tools).toEqual(expect.arrayContaining(['propose_operations', 'web_search']))
    // desktop-only tools: no local file writes, no workbook merge from attachments
    expect(tools).not.toContain('create_document')
    expect(tools).not.toContain('merge_attached_workbooks')
    expect(JSON.stringify(chat.body)).not.toContain('create_document')
    await expectClean(page, frame, problems)
  })

  test('grant on: a plan operation edits a cell and the save carries it', async ({
    page,
    request,
  }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    const problems = await watch(page)
    const { frame, wb } = await open(page, { lang: 'en', ai: '1' })
    // the scripted turn needs the sheet id the engine gave this workbook
    await fake(request, {
      toolCalls: [
        {
          name: 'propose_operations',
          input: {
            summary: 'Put 7 in C2',
            operations: [{ op: 'set_cell', sheetId: wb.sheets[0]!.id, address: 'C2', value: 7 }],
          },
        },
      ],
    })
    await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
    await ask(frame, 'Put 7 in C2')
    await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
      timeout: 60_000,
    })
    // the grid changed: save (Ctrl+S from the grid) writes C2 = 7
    await frame
      .locator('canvas[id^="univer-sheet-main-canvas"]')
      .first()
      .click({
        position: { x: 300, y: 300 },
      })
    await page.keyboard.press('Control+s')
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (
              window as unknown as { __host: { lastSaved(): { bytes: number[] } | null } }
            ).__host.lastSaved(),
          ),
        { timeout: 60_000 },
      )
      .not.toBeNull()
    const saved = await page.evaluate(() =>
      (
        window as unknown as { __host: { lastSaved(): { bytes: number[] } | null } }
      ).__host.lastSaved(),
    )
    const zip = await JSZip.loadAsync(Uint8Array.from(saved!.bytes))
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('text')
    expect(xml).toMatch(/<c r="C2"[^>]*><v>7<\/v><\/c>/)
    // the turn after the tool result went back to the proxy with the tool outcome
    const chats = (await aiLog(request)).filter((l) => l.path.endsWith('/chat/completions'))
    expect(chats.length).toBeGreaterThanOrEqual(2)
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
      const { frame } = await open(page, { lang: 'en', ai: '1' })
      await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
      await ask(frame, 'Say hello')
      // one surface: the panel's inline error; no floating card beside it
      const inline = frame.locator('.ai-msg-assistant').last()
      await expect(inline).toContainText(s.title, { timeout: 30_000 })
      if (s.status === 429) await expect(inline).toContainText('7 s')
      await expect(frame.locator('.ow-ai-state')).toHaveCount(0)
      await expectClean(page, frame, problems, true)
    })
  }

  test('grant on: 503 cloud_unavailable from a cloud tool renders its state', async ({
    page,
    request,
  }) => {
    await fake(request)
    await fake(request, {
      credentials: OPENAI_KEY,
      fail: [{ status: 503, code: 'cloud_unavailable', path: '/cloud/search' }],
    })
    const problems = await watch(page)
    const { frame } = await open(page, { lang: 'en', ai: '1' })
    await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
    const r = await frame.evaluate(() =>
      (
        window as unknown as {
          desktopApi: { webSearch(q: string): Promise<{ method: string; error?: string }> }
        }
      ).desktopApi.webSearch('cats'),
    )
    expect(r.method).toBe('error')
    await expect(frame.locator('.ow-ai-state[data-ai-state="cloud_unavailable"]')).toBeVisible()
    await expectClean(page, frame, problems, true)
  })

  test('AI settings = UniWork credentials: add a key from the gear, reply streams', async ({
    page,
    request,
  }) => {
    await fake(request)
    const problems = await watch(page)
    const { frame } = await open(page, { lang: 'en', ai: '1' })
    await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
    await frame.locator('.ai-panel-header').getByRole('button', { name: 'AI Settings' }).click()
    const dialog = frame.locator('.ow-ai-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('select[name="provider"]').selectOption('openai')
    await dialog.locator('input[name="api_key"]').fill('sk-live-key-9876')
    await dialog.getByRole('button', { name: 'Save key' }).click()
    await expect(dialog).toContainText('Saved key …9876')
    expect(await dialog.innerHTML()).not.toContain('sk-live-key')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await ask(frame, 'Say hello')
    await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
      timeout: 60_000,
    })
    await expectClean(page, frame, problems, true)
  })

  // visual evidence for tester_visual: the panel with a reply and a state card, both themes and languages
  for (const theme of ['light', 'dark'] as const) {
    for (const lang of ['en', 'vi'] as const) {
      test(`screenshots ${theme} ${lang}`, async ({ page, request }) => {
        await fake(request)
        await fake(request, { credentials: OPENAI_KEY })
        const { frame } = await open(page, { lang, theme, ai: '1' })
        await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
        await ask(frame, 'Say hello')
        await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
          timeout: 60_000,
        })
        await page.screenshot({ path: screenshotPath('ai', `sheets-panel-${theme}-${lang}`) })
        await fake(request, {
          fail: [{ status: 402, code: 'credits_exhausted', path: '/byok/' }],
        })
        await ask(frame, 'Again')
        await expect(frame.locator('.ai-msg-assistant').last()).toContainText(
          'AI credits used up',
          { timeout: 30_000 },
        )
        await expect(frame.locator('.ow-ai-state')).toHaveCount(0)
        await page.screenshot({ path: screenshotPath('ai', `sheets-state-${theme}-${lang}`) })
      })
    }
  }
})
