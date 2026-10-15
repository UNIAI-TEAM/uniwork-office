import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl, type LaunchedApp } from './helpers'
import { STUB_ORG, startUniworkAuthStub, type UniworkAuthStub } from './fixtures/uniwork-auth-stub'
import { shellEnv, signIn } from './fixtures/uniwork-signin-steps'

/**
 * Keys saved on UniWork (G6-05k): a signed-in desktop uses the key the person saved on UniWork
 * for the provider, through the UniWork proxy with the device bearer. The server is the local
 * stub extended with R1 (key list + `byok`), R5 (models) and R2 (Anthropic messages); no vendor
 * and no network. Sign-in uses the in-memory credential seam (UNIWORK_AUTH_E2E_PLAIN_STORE), so
 * the spec runs on machines without an OS keyring (CI) instead of skipping.
 */

/** the only thing the stub knows about the key; it must never show up on the desktop */
const KEY_HINT = 'e2eKeyHint-QX7Z'
const ORG_PATH = `/orgs/${STUB_ORG.id}/ai`
const REPLY = 'Reply from the UniWork key'
const FIXTURE = join(__dirname, 'assets/justify-pagegap-fr.docx')

interface ProxyCall {
  authorization: string
  headerNames: string[]
  model: unknown
  stream: unknown
}

/** the stub's R1/R2/R5 answers plus what they saw */
async function startKeysStub(byokEnabled: boolean): Promise<{
  stub: UniworkAuthStub
  proxyCalls: ProxyCall[]
  listCalls: () => number
}> {
  const proxyCalls: ProxyCall[] = []
  let lists = 0
  const stub = await startUniworkAuthStub({
    extend: async (ctx) => {
      if (ctx.req.method === 'GET' && ctx.route === `${ORG_PATH}/credentials`) {
        lists += 1
        ctx.send(200, {
          items: [
            {
              provider: 'anthropic',
              label: '',
              base_url: '',
              key_hint: KEY_HINT,
              model: 'claude-sonnet-5',
              model_updated_at: '2026-10-11T08:00:00Z',
              created_at: '2026-10-09T08:00:00Z',
              updated_at: '2026-10-09T08:00:00Z',
            },
          ],
          providers: [
            {
              id: 'anthropic',
              protocol: 'anthropic',
              requires_base_url: false,
              default_base_url: 'https://api.anthropic.com',
            },
          ],
          byok: { enabled: byokEnabled, reason: byokEnabled ? '' : 'entitlement_required' },
        })
        return true
      }
      if (ctx.req.method === 'GET' && ctx.route === `${ORG_PATH}/byok/anthropic/models`) {
        ctx.send(200, { data: [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5-5' }] })
        return true
      }
      if (ctx.req.method === 'POST' && ctx.route === `${ORG_PATH}/byok/anthropic/messages`) {
        const body = JSON.parse((await ctx.readBody()).toString('utf8')) as Record<string, unknown>
        proxyCalls.push({
          authorization: String(ctx.req.headers.authorization ?? ''),
          headerNames: Object.keys(ctx.req.headers),
          model: body.model,
          stream: body.stream,
        })
        const text = (t: string, extra: object) =>
          `data: ${JSON.stringify({ type: t, ...extra })}\n\n`
        ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        ctx.res.end(
          text('message_start', { message: { usage: { input_tokens: 3, output_tokens: 0 } } }) +
            text('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
            text('content_block_delta', { index: 0, delta: { type: 'text_delta', text: REPLY } }) +
            text('content_block_stop', { index: 0 }) +
            text('message_delta', {
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: 5 },
            }) +
            text('message_stop', {}),
        )
        return true
      }
      return false
    },
  })
  return { stub, proxyCalls, listCalls: () => lists }
}

/** a fresh userData whose AI provider is Claude and that holds no key of its own */
async function seedUserData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-e2e-'))
  await writeFile(
    join(dir, 'ai-settings.json'),
    JSON.stringify({ provider: 'anthropic', providers: {} }),
  )
  return dir
}

async function launchSignedIn(stub: UniworkAuthStub, videoDir: string): Promise<LaunchedApp> {
  const launched = await launchShell({
    userDataDir: await seedUserData(),
    onboardingSeen: true,
    videoDir,
    env: { ...shellEnv(stub), UNIWORK_AUTH_E2E_PLAIN_STORE: '1' },
  })
  await signIn(launched, stub, { inMemoryStore: true })
  return launched
}

/** Settings > AI model */
async function openAiModelPane(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.set-nav-item').filter({ hasText: 'AI model' }).click()
}

/** top-level userData text files (settings), Chromium caches skipped */
async function userDataText(dir: string): Promise<string> {
  const parts: string[] = []
  for (const name of await readdir(dir)) {
    const file = join(dir, name)
    try {
      const info = lstatSync(file)
      if (info.isFile() && info.size < 2_000_000)
        parts.push((await readFile(file)).toString('latin1'))
    } catch {
      // Singleton* entries can dangle or vanish
    }
  }
  return parts.join('\n')
}

async function renderedState(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify({
      text: document.body.innerText,
      html: document.documentElement.outerHTML,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    }),
  )
}

async function openDocsPanel(launched: LaunchedApp): Promise<Page> {
  await launched.page.evaluate((path) => window.aiOffice.openPath(path), FIXTURE)
  const editor = await waitForPageWithUrl(launched.app, '://docs/')
  await expect(editor.locator('.ProseMirror').first()).toBeVisible({ timeout: 30_000 })
  await expect(editor.locator('.ai-composer textarea')).toBeVisible()
  return editor
}

test.describe('UniWork keys on the desktop', () => {
  test('a key saved on UniWork serves Claude: read-only row, proxy turn with the device bearer', async () => {
    test.setTimeout(120_000)
    const { stub, proxyCalls, listCalls } = await startKeysStub(true)
    const launched = await launchSignedIn(stub, 'uniwork-org-keys')
    try {
      const { page, userDataDir } = launched

      // Settings > AI model: the provider is served by the key on UniWork, shown read-only
      await openAiModelPane(page)
      const row = page.locator('[data-org-key-row="anthropic"]')
      await expect(row).toBeVisible({ timeout: 30_000 })
      await expect(row.locator('[data-org-key-tag]')).toHaveText('Key on UniWork')
      await expect(page.getByRole('button', { name: 'Provider', exact: true })).toContainText(
        'Claude',
      )
      await expect(row.locator('input, textarea')).toHaveCount(0)
      await expect(page.locator('#set-ai-key')).toHaveCount(0)
      expect(listCalls()).toBeGreaterThanOrEqual(1)

      // the key (its hint, the only thing the server lists) never reaches the renderer or disk
      expect(await renderedState(page), 'settings DOM/storage').not.toContain(KEY_HINT)
      await page.locator('.set-close').click()

      // a docs AI turn with that provider goes through the UniWork proxy
      const editor = await openDocsPanel(launched)
      const composer = editor.locator('.ai-composer textarea')
      await composer.fill('Say hello')
      await composer.press('Enter')
      await expect(editor.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
        timeout: 30_000,
      })
      expect(proxyCalls).toHaveLength(1)
      const call = proxyCalls[0]!
      // the device bearer the stub issued, and no vendor key header
      expect(call.authorization).toMatch(/^Bearer at_/)
      expect(stub.issuedSecrets()).toContain(call.authorization.slice('Bearer '.length))
      expect(call.headerNames).not.toContain('x-api-key')
      expect(call.headerNames).not.toContain('x-goog-api-key')
      expect(call.stream).toBe(true)

      expect(await renderedState(editor), 'docs DOM/storage').not.toContain(KEY_HINT)
      const files = await userDataText(userDataDir)
      expect(files, 'userData files').not.toContain(KEY_HINT)
      expect(existsSync(join(userDataDir, 'ai-settings.json'))).toBe(true)
      const saved = JSON.parse(await readFile(join(userDataDir, 'ai-settings.json'), 'utf8')) as {
        providers?: Record<string, { apiKey?: string }>
      }
      expect(saved.providers?.anthropic?.apiKey ?? '').toBe('')
    } finally {
      await closeAndSaveVideo(launched, 'uniwork-org-keys')
      await stub.close()
    }
  })

  test('with keys off on UniWork there is no org row and no proxy request', async () => {
    test.setTimeout(120_000)
    const { stub, proxyCalls, listCalls } = await startKeysStub(false)
    const launched = await launchSignedIn(stub, 'uniwork-org-keys-off')
    try {
      const { page } = launched
      await openAiModelPane(page)
      // the list was read (byok disabled), and the provider falls back to its own key field
      await expect.poll(listCalls, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)
      await expect(page.getByRole('button', { name: 'Provider', exact: true })).toContainText(
        'Claude',
      )
      await expect(page.locator('#set-ai-key')).toBeVisible()
      await expect(page.locator('[data-org-key-row]')).toHaveCount(0)
      await expect(page.locator('[data-org-key-tag]')).toHaveCount(0)
      await page.locator('.set-close').click()

      // there is no key to use: the panel will not send, and nothing reaches the proxy
      const editor = await openDocsPanel(launched)
      const composer = editor.locator('.ai-composer textarea')
      await composer.fill('Say hello')
      await expect(editor.locator('.ai-send-btn')).toBeDisabled()
      await composer.press('Enter')
      await expect(editor.locator('.ai-msg')).toHaveCount(0)
      expect(proxyCalls).toHaveLength(0)
    } finally {
      await closeAndSaveVideo(launched, 'uniwork-org-keys-off')
      await stub.close()
    }
  })
})
