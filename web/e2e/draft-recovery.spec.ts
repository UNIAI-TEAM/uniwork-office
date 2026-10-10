// Web draft recovery (UNI-1014 DR1, CONTRACT C15(3) / C18) on the production builds of Docs,
// Markdown and Sheets in the protocol test host (`?recovery=1`: the host sends `init.recovery`
// with a non-extractable AES-GCM key it persists in IndexedDB "keys", as the real host does).
// Per module, with the browser clock under test control:
//   edit -> 30 s -> an encrypted record in IndexedDB "uniwork-office-frame-drafts" (nothing saved)
//   -> reload the frame (same persisted key) -> Restore -> the edit is back and the document is dirty
//   -> save -> the record is gone;
//   the same after a reload of the whole host page (the key is persisted by the host, C18a);
//   Discard -> the server version, record gone;
//   a new key (or a second tab) -> the old record is skipped and never deleted, no prompt;
//   sign-out -> the database is gone.
// Screenshots of the prompt (light/dark, en/vi) go to docs/web-modules/screenshots/draft-recovery/.
// Builds: npm run build:web && npm run build:web -- --module markdown && ... --module sheets
// Run: npx playwright test -c web/e2e draft-recovery
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { buildEditFixture } from '../../apps/sheets/tests/fixture-builder'

const repoRoot = resolve(__dirname, '../..')
const shots = resolve(repoRoot, 'docs/web-modules/screenshots/draft-recovery')
const fixtures = resolve(repoRoot, 'web/e2e/.results/fixtures')
const PROMPT = '[data-office-web="draft-recovery"]'
const TICK_MS = 31_000

function built(module: string): boolean {
  const root =
    module === 'docs' ? resolve(repoRoot, 'dist-web/docs') : resolve(repoRoot, 'dist-web', module)
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

interface Problems {
  console: string[]
  page: string[]
}

async function watch(page: Page): Promise<Problems> {
  const p: Problems = { console: [], page: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') p.console.push(`${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => p.page.push(`${e.message}\n${e.stack ?? ''}`))
  return p
}

type HostEvent = { type: string; payload: Record<string, unknown> }

const hostEvents = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __host: { events: HostEvent[] } }).__host.events,
  ) as Promise<HostEvent[]>

const lastDirty = async (page: Page) =>
  (await hostEvents(page)).filter((e) => e.type === 'dirty').at(-1)?.payload.dirty

const lastSaved = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __host: { lastSaved(): { bytes: number[]; versionId: string } | null }
      }
    ).__host.lastSaved(),
  )

/** the draft records of this origin: key + whether the ciphertext still shows `plain` */
function drafts(frame: Frame, plain: string) {
  return frame.evaluate(
    (plain) =>
      new Promise<Array<{ key: string; module: string; leaks: boolean }>>((resolve, reject) => {
        const open = indexedDB.open('uniwork-office-frame-drafts')
        open.onerror = () => reject(open.error)
        open.onupgradeneeded = () => open.result.createObjectStore('drafts')
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('drafts', 'readonly')
          const store = tx.objectStore('drafts')
          const keys = store.getAllKeys()
          const values = store.getAll()
          tx.oncomplete = () => {
            db.close()
            const needle = new TextEncoder().encode(plain)
            resolve(
              keys.result.map((k, i) => {
                const v = values.result[i] as { module: string; ciphertext: ArrayBuffer }
                const hay = new Uint8Array(v.ciphertext)
                let leaks = false
                outer: for (let a = 0; a + needle.length <= hay.length; a += 1) {
                  for (let b = 0; b < needle.length; b += 1)
                    if (hay[a + b] !== needle[b]) continue outer
                  leaks = true
                  break
                }
                return { key: String(k), module: v.module, leaks }
              }),
            )
          }
        }
      }),
    plain,
  )
}

async function readyCount(page: Page): Promise<number> {
  return (await hostEvents(page)).filter((e) => e.type === 'ready').length
}

/** reload only the frame (crash / closed tab stand-in): the host re-runs init with the same key */
async function reloadFrame(page: Page): Promise<Frame> {
  const before = await readyCount(page)
  await page.evaluate(() => {
    ;(document.getElementById('frame') as HTMLIFrameElement).contentWindow!.location.reload()
  })
  await expect.poll(() => readyCount(page), { timeout: 30_000 }).toBeGreaterThan(before)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  return (await (await page.waitForSelector('#frame')).contentFrame())!
}

async function openHost(page: Page, query: Record<string, string>): Promise<Frame> {
  await page.goto(`/test-host/?${new URLSearchParams({ recovery: '1', ...query })}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  return (await (await page.waitForSelector('#frame')).contentFrame())!
}

/** the writer's 30 s tick (the frame's interval timers run on the page clock) */
async function tick(page: Page): Promise<void> {
  await page.clock.fastForward(TICK_MS)
  await page.waitForTimeout(1_500)
}

interface ModuleCase {
  module: 'docs' | 'markdown' | 'sheets'
  query: Record<string, string>
  /** wait until the document is shown */
  shown(frame: Frame): Promise<void>
  /** put the keyboard focus into the document (Ctrl+S goes to the editor) */
  focus(frame: Frame): Promise<void>
  /** make an edit containing `marker` */
  edit(page: Page, frame: Frame, marker: string): Promise<void>
  /** the marker is visible in the open document */
  showsMarker(frame: Frame, marker: string): Promise<boolean>
  /** the last saved bytes contain the marker */
  savedHasMarker(bytes: number[], marker: string): Promise<boolean>
}

// ---------------------------------------------------------------- docs

const DOCS_EDITOR = '.ProseMirror[contenteditable="true"]'

const docsCase: ModuleCase = {
  module: 'docs',
  query: { open: '/fixtures/simple.docx' },
  async shown(frame) {
    await frame
      .locator(DOCS_EDITOR)
      .first()
      .getByText('第一段', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 })
  },
  async focus(frame) {
    await frame.locator(DOCS_EDITOR).first().getByText('第一段', { exact: false }).first().click()
  },
  async edit(page, frame, marker) {
    await frame.locator(DOCS_EDITOR).first().getByText('第一段', { exact: false }).first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(` ${marker}`, { delay: 10 })
  },
  async showsMarker(frame, marker) {
    return (await frame.locator(DOCS_EDITOR).first().textContent())?.includes(marker) ?? false
  },
  async savedHasMarker(bytes, marker) {
    const zip = await JSZip.loadAsync(Uint8Array.from(bytes))
    return (await zip.file('word/document.xml')!.async('text')).includes(marker)
  },
}

// ---------------------------------------------------------------- markdown

const MD = '# Notes\n\nFirst paragraph to edit.\n\nTail paragraph.\n'
const MD_PATH = '/e2e-fixtures/Notes.md'

const markdownCase: ModuleCase = {
  module: 'markdown',
  query: { module: 'markdown', open: MD_PATH },
  async shown(frame) {
    await expect(frame.locator('.doc-editor')).toContainText('First paragraph', {
      timeout: 60_000,
    })
  },
  async focus(frame) {
    await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  },
  async edit(page, frame, marker) {
    await frame.locator('.doc-editor p', { hasText: 'First paragraph to edit.' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(` ${marker}`)
  },
  async showsMarker(frame, marker) {
    return (await frame.locator('.doc-editor').textContent())?.includes(marker) ?? false
  },
  async savedHasMarker(bytes, marker) {
    return Buffer.from(bytes).toString('utf8').includes(marker)
  },
}

// ---------------------------------------------------------------- sheets

type ShownWorkbook = { sessionId: string; sheets: Array<{ id: string }> }

async function workbook(frame: Frame): Promise<ShownWorkbook | null> {
  return frame.evaluate(
    () =>
      (
        window as unknown as { __sheetsWebState?: { workbook: () => ShownWorkbook | null } }
      ).__sheetsWebState?.workbook() ?? null,
  )
}

async function cellA1(frame: Frame): Promise<unknown> {
  const wb = await workbook(frame)
  if (!wb) return undefined
  const r = await frame.evaluate(
    ({ sessionId, sheetId }) =>
      (
        window as unknown as {
          desktopApi: {
            readWorkbookRange(
              r: unknown,
            ): Promise<{ cells: Array<{ row: number; value: unknown }> }>
          }
        }
      ).desktopApi.readWorkbookRange({
        sessionId,
        sheetId,
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      }),
    { sessionId: wb.sessionId, sheetId: wb.sheets[0]!.id },
  )
  return r.cells[0]?.value
}

const sheetsCase: ModuleCase = {
  module: 'sheets',
  query: { module: 'sheets', open: '/e2e-fixtures/Edit.xlsx' },
  async shown(frame) {
    await expect.poll(async () => (await workbook(frame)) !== null, { timeout: 60_000 }).toBe(true)
    await expect(frame.locator('canvas[id^="univer-sheet-main-canvas"]').first()).toBeVisible()
  },
  async focus(frame) {
    await frame
      .locator('canvas[id^="univer-sheet-main-canvas"]')
      .first()
      .click({ position: { x: 400, y: 300 } })
  },
  async edit(page, frame, marker) {
    // Univer's formula-bar defined-name box since the main sync (as web/e2e/sheets.spec.ts)
    const nameBox = frame.locator('[data-u-comp="defined-name"] input')
    await nameBox.click()
    await nameBox.fill('A1')
    await nameBox.press('Enter')
    await page.waitForTimeout(500)
    await page.keyboard.type(marker)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
  },
  async showsMarker(frame, marker) {
    return (await cellA1(frame)) === marker
  },
  async savedHasMarker(bytes, marker) {
    const zip = await JSZip.loadAsync(Uint8Array.from(bytes))
    const shared = (await zip.file('xl/sharedStrings.xml')?.async('text')) ?? ''
    const sheet = (await zip.file('xl/worksheets/sheet1.xml')!.async('text')) ?? ''
    return shared.includes(marker) || sheet.includes(marker)
  },
}

// ---------------------------------------------------------------- the flows

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true })
  mkdirSync(fixtures, { recursive: true })
  writeFileSync(resolve(fixtures, 'Edit.xlsx'), await buildEditFixture())
})

test.beforeEach(async ({ page }) => {
  await page.route(`**${MD_PATH}`, (route) =>
    route.fulfill({ status: 200, body: MD, headers: { 'content-type': 'text/markdown' } }),
  )
  await page.route('**/e2e-fixtures/Edit.xlsx', (route) =>
    route.fulfill({
      status: 200,
      path: resolve(fixtures, 'Edit.xlsx'),
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    }),
  )
  // the frame's interval timers (the 30 s draft writer, the Sheets recovery tick) on a test clock
  await page.clock.install()
})

for (const c of [docsCase, markdownCase, sheetsCase]) {
  test.describe(c.module, () => {
    test.skip(!built(c.module), `no dist-web/${c.module} build`)

    test(`${c.module}: edit -> 30 s -> reload -> Restore -> dirty -> save clears the draft`, async ({
      page,
    }) => {
      const problems = await watch(page)
      const marker = `DraftMark${c.module}`
      let frame = await openHost(page, { ...c.query, lang: 'en' })
      await c.shown(frame)
      await c.edit(page, frame, marker)
      await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
      await tick(page)
      await expect
        .poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 })
        .toBe(1)
      const [record] = await drafts(frame, marker)
      expect(record.module).toBe(c.module)
      expect(record.key).toMatch(/^test-user:f1:"f1-v1":[0-9a-f]{16}$/)
      expect(record.leaks).toBe(false)
      // a draft is never a save
      expect(await lastSaved(page)).toBeNull()

      frame = await reloadFrame(page)
      const prompt = frame.locator(PROMPT)
      await expect(prompt).toBeVisible({ timeout: 30_000 })
      await expect(prompt.locator('[data-choice]')).toHaveText(['Discard', 'Restore'])
      await page.screenshot({ path: resolve(shots, `${c.module}-prompt-light-en.png`) })
      await prompt.locator('[data-choice="restore"]').click()
      await expect(prompt).toBeHidden()
      await c.shown(frame)
      await expect.poll(() => c.showsMarker(frame, marker), { timeout: 30_000 }).toBe(true)
      await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
      expect(await lastSaved(page)).toBeNull()

      await c.focus(frame)
      await page.keyboard.press('Control+s')

      await expect.poll(() => lastSaved(page), { timeout: 60_000 }).not.toBeNull()
      expect(await c.savedHasMarker((await lastSaved(page))!.bytes, marker)).toBe(true)
      await expect
        .poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 })
        .toBe(0)
      expect(problems).toEqual({ console: [], page: [] })
    })

    test(`${c.module}: Discard opens the server version and deletes the draft`, async ({
      page,
    }) => {
      const problems = await watch(page)
      const marker = `DiscardMark${c.module}`
      let frame = await openHost(page, { ...c.query, lang: 'vi', theme: 'dark' })
      await c.shown(frame)
      await c.edit(page, frame, marker)
      await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
      await tick(page)
      await expect
        .poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 })
        .toBe(1)

      frame = await reloadFrame(page)
      const prompt = frame.locator(PROMPT)
      await expect(prompt).toBeVisible({ timeout: 30_000 })
      await expect(prompt.locator('[data-choice]')).toHaveText(['Bỏ', 'Khôi phục'])
      await page.screenshot({ path: resolve(shots, `${c.module}-prompt-dark-vi.png`) })
      await prompt.locator('[data-choice="discard"]').click()
      await expect(prompt).toBeHidden()
      await c.shown(frame)
      await page.waitForTimeout(1_000)
      expect(await c.showsMarker(frame, marker)).toBe(false)
      expect(await drafts(frame, marker)).toEqual([])
      expect(problems).toEqual({ console: [], page: [] })
    })

    test(`${c.module}: a draft under another key is skipped, never deleted, no prompt`, async ({
      page,
    }) => {
      const problems = await watch(page)
      const marker = `OtherKey${c.module}`
      let frame = await openHost(page, { ...c.query, lang: 'en' })
      await c.shown(frame)
      await c.edit(page, frame, marker)
      await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
      await tick(page)
      await expect
        .poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 })
        .toBe(1)

      // another key (a later sign-in on this profile): the old copy cannot be read
      await page.evaluate(() =>
        (
          window as unknown as { __host: { newSessionKey(): Promise<void> } }
        ).__host.newSessionKey(),
      )
      frame = await reloadFrame(page)
      await c.shown(frame)
      await page.waitForTimeout(1_000)
      expect(await frame.locator(PROMPT).count()).toBe(0)
      expect(await c.showsMarker(frame, marker)).toBe(false)
      // never deleted behind the user's back: the sign-out cleanup owns it
      expect(await drafts(frame, marker)).toHaveLength(1)
      expect(problems).toEqual({ console: [], page: [] })
    })

    test(`${c.module}: a reload of the whole host page restores with the persisted key`, async ({
      page,
    }) => {
      const problems = await watch(page)
      const marker = `HostReload${c.module}`
      let frame = await openHost(page, { ...c.query, lang: 'en' })
      await c.shown(frame)
      await c.edit(page, frame, marker)
      await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
      await tick(page)
      await expect
        .poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 })
        .toBe(1)

      // the browser tab reloads (crash / close + reopen stand-in): a new host page, same profile
      await page.reload()
      await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
      frame = (await (await page.waitForSelector('#frame')).contentFrame())!
      const prompt = frame.locator(PROMPT)
      await expect(prompt).toBeVisible({ timeout: 30_000 })
      await prompt.locator('[data-choice="restore"]').click()
      await expect(prompt).toBeHidden()
      await c.shown(frame)
      await expect.poll(() => c.showsMarker(frame, marker), { timeout: 30_000 }).toBe(true)
      await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
      expect(await lastSaved(page)).toBeNull()
      expect(problems).toEqual({ console: [], page: [] })
    })

    test(`${c.module}: a second tab neither deletes nor overwrites the first tab's draft`, async ({
      page,
      context,
    }) => {
      const marker = `TwoTabs${c.module}`
      const frameA = await openHost(page, { ...c.query, lang: 'en' })
      await c.shown(frameA)
      await c.edit(page, frameA, marker)
      await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
      await tick(page)
      await expect
        .poll(async () => (await drafts(frameA, marker)).length, { timeout: 15_000 })
        .toBe(1)
      const [first] = await drafts(frameA, marker)

      // tab B: same profile (same persisted key), same document; it is offered A's draft and declines
      const pageB = await context.newPage()
      await pageB.route(`**${MD_PATH}`, (route) =>
        route.fulfill({ status: 200, body: MD, headers: { 'content-type': 'text/markdown' } }),
      )
      await pageB.route('**/e2e-fixtures/Edit.xlsx', (route) =>
        route.fulfill({
          status: 200,
          path: resolve(fixtures, 'Edit.xlsx'),
          headers: {
            'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        }),
      )
      await pageB.clock.install()
      const frameB = await openHost(pageB, { ...c.query, lang: 'en' })
      const prompt = frameB.locator(PROMPT)
      await expect(prompt).toBeVisible({ timeout: 30_000 })
      await prompt.locator('[data-choice="restore"]').focus()
      await pageB.keyboard.press('Escape') // dismiss keeps the copy
      await expect(prompt).toBeHidden()
      await c.shown(frameB)
      expect(await drafts(frameB, marker)).toEqual([first])

      // B edits and its writer ticks: a second record next to A's, A's untouched
      await c.edit(pageB, frameB, `${marker}B`)
      await tick(pageB)
      await expect
        .poll(async () => (await drafts(frameB, marker)).length, { timeout: 15_000 })
        .toBe(2)
      expect((await drafts(frameB, marker)).map((d) => d.key)).toContain(first.key)

      // A keeps writing under its own key: still exactly two records
      await tick(page)
      expect(await drafts(frameA, marker)).toHaveLength(2)
      await pageB.close()
    })

    test(`${c.module}: sign-out deletes the database with every draft`, async ({ page }) => {
      const marker = `SignOut${c.module}`
      const frame = await openHost(page, { ...c.query, lang: 'en' })
      await c.shown(frame)
      await c.edit(page, frame, marker)
      await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
      await tick(page)
      await expect
        .poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 })
        .toBe(1)
      await page.evaluate(() =>
        (window as unknown as { __host: { signOut(): Promise<void> } }).__host.signOut(),
      )
      expect(await drafts(frame, marker)).toEqual([])
    })
  })
}
