import { test, expect, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  closeAndSaveVideo,
  launchShell,
  screenshotPath,
  waitForPageWithUrl,
  type LaunchedApp,
} from './helpers'
import {
  startUniworkDocumentsStub,
  type StubCall,
  type StubDocumentState,
  type UniworkDocumentsStub,
} from './fixtures/uniwork-documents-stub'
import {
  NO_KEYRING_SKIP,
  accountButton,
  deliverUrl,
  hasOsKeyring,
  shellEnv,
  signIn,
} from './fixtures/uniwork-signin-steps'

/**
 * UniWork documents end to end: the built shell against a local replay of the
 * documents contract (`fixtures/uniwork-documents-stub.ts`, composed on the
 * desktop-auth stub). The account is signed in once; every scenario then
 * launches a fresh app on the same userData, so the credential, the working
 * copies and the recents carry over while tabs and windows never leak between
 * scenarios.
 */

const ROOT = resolve(__dirname, '..')
const MARKER = 'UNIWORK_E2E_EDIT'
// markdown escapes underscores on save
const MD_MARKER = 'UniWorkE2eEdit'

// ── fixtures ────────────────────────────────────────────────────────────────

const docxBytes = () => readFile(join(ROOT, 'fixtures/generated/simple.docx'))
const docxOtherBytes = () => readFile(join(ROOT, 'fixtures/generated/kitchen-sink.docx'))
const xlsxBytes = () =>
  readFile(join(ROOT, 'apps/sheets/fixtures/generated/compatibility-basic.xlsx'))

async function walk(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)))
    else out.push(rel)
  }
  return out
}

async function pptxBytes(): Promise<Buffer> {
  const dir = join(__dirname, 'assets/font-manager-rubik')
  const zip = new JSZip()
  // the content-types part leads the archive, as Office writes it
  const names = (await walk(dir)).sort((a, b) =>
    a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : a.localeCompare(b),
  )
  for (const name of names) zip.file(name, await readFile(join(dir, name)))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** one empty US-Letter page */
function pdfBytes(): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

async function zipEntry(bytes: Uint8Array, name: string): Promise<string> {
  const entry = (await JSZip.loadAsync(bytes)).file(name)
  if (!entry) throw new Error(`no ${name} in the archive`)
  return entry.async('string')
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

// ── app + stub plumbing ─────────────────────────────────────────────────────

interface DocStatus {
  path: string
  documentId: string
  title: string
  access: 'edit' | 'view'
  state: string
  error?: string
  lastSavedAt?: string
}

interface AppContext {
  launched: LaunchedApp
  /** the shell renderer (tab strip, Home, the UniWork chip) */
  shell: Page
}

type AiOfficeOnWindow = {
  aiOffice: {
    uniworkActiveDocStatus(): Promise<DocStatus | null>
    uniworkDocStatus(path: string): Promise<DocStatus | null>
  }
}

const activeStatus = (shell: Page): Promise<DocStatus | null> =>
  shell.evaluate(() => (window as unknown as AiOfficeOnWindow).aiOffice.uniworkActiveDocStatus())

const statusOf = (shell: Page, path: string): Promise<DocStatus | null> =>
  shell.evaluate((p) => (window as unknown as AiOfficeOnWindow).aiOffice.uniworkDocStatus(p), path)

/** the document status chip of the active tab (the launch notice shares its pill style) */
const chip = (shell: Page) => shell.locator('.uw-pill:not(.uw-notice)')
const notice = (shell: Page) => shell.locator('.uw-notice')

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function binding(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dirname(path), 'binding.json'), 'utf8')) as Record<
    string,
    unknown
  >
}

/** every documents-route request for one document (the exchange has no document id) */
const callsFor = (stub: UniworkDocumentsStub, id: string): StubCall[] =>
  stub.calls().filter((c) => c.route.startsWith(`/documents/${id}`))

async function openFromPicker(shell: Page, title: string): Promise<void> {
  await shell.locator('.uw-open-card').click()
  const dialog = shell.locator('.uw-pick')
  await expect(dialog).toBeVisible()
  await dialog.locator('.uw-pick-row', { hasText: title }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

/** answers the next native message boxes of main (conflict choice, discard confirm) in order */
async function answerMessageBoxes({ app }: LaunchedApp, responses: number[]): Promise<void> {
  await app.evaluate(({ dialog }, answers) => {
    const g = globalThis as unknown as { __e2eBoxes?: unknown[] }
    g.__e2eBoxes = []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as {
        message: string
        buttons: string[]
      }
      g.__e2eBoxes!.push({ message: options.message, buttons: options.buttons })
      return { response: answers.shift() ?? 1, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, responses)
}

async function seenMessageBoxes({
  app,
}: LaunchedApp): Promise<Array<{ message: string; buttons: string[] }>> {
  return app.evaluate(() => (globalThis as unknown as { __e2eBoxes?: never[] }).__e2eBoxes ?? [])
}

// ── module drivers ──────────────────────────────────────────────────────────

interface AidocsWindow {
  __aidocs?: {
    editor?: {
      isEditable: boolean
      commands: { setTextSelection: (pos: number) => void }
      state: { doc: { content: { size: number }; textContent: string } }
    }
  }
}

async function docsEditor(app: LaunchedApp['app']): Promise<Page> {
  const editor = await waitForPageWithUrl(app, '://docs/')
  await editor.waitForFunction(
    () => Boolean((window as unknown as AidocsWindow).__aidocs?.editor),
    undefined,
    { timeout: 30_000 },
  )
  await editor.locator('.doc-page').first().waitFor({ timeout: 30_000 })
  return editor
}

async function typeInDocs(editor: Page, text: string): Promise<void> {
  await editor.locator('.doc-page').first().click()
  await editor.evaluate(() => {
    const ed = (window as unknown as AidocsWindow).__aidocs!.editor!
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
  })
  await editor.keyboard.type(` ${text}`, { delay: 20 })
}

const docsText = (editor: Page): Promise<string> =>
  editor.evaluate(
    () => (window as unknown as AidocsWindow).__aidocs?.editor?.state.doc.textContent ?? '',
  )

const saveShortcut = (editor: Page) => editor.keyboard.press('ControlOrMeta+s')

/** the same command the shell sends a module for Save/Retry */
async function sendToView(
  { app }: LaunchedApp,
  urlPart: string,
  channel: string,
  arg: string,
): Promise<void> {
  await app.evaluate(
    ({ webContents }, [part, ch, value]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(part!))
      wc?.send(ch!, value)
    },
    [urlPart, channel, arg],
  )
}

async function workingCopyText(shell: Page, entry: string): Promise<string> {
  const status = await activeStatus(shell)
  return zipEntry(await readFile(status!.path), entry)
}

// ── scenarios ───────────────────────────────────────────────────────────────

test.describe.serial('UniWork documents', () => {
  let stub: UniworkDocumentsStub
  let userDataDir = ''
  let keyring = true

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    stub = await startUniworkDocumentsStub()
    const first = await launchShell({
      onboardingSeen: true,
      videoDir: 'uniwork-documents-setup',
      env: shellEnv(stub),
    })
    userDataDir = first.userDataDir
    try {
      keyring = await hasOsKeyring(first)
      if (keyring) await signIn(first, stub)
    } finally {
      await closeAndSaveVideo(first, 'uniwork-documents-setup')
    }
    if (keyring) {
      expect(existsSync(join(userDataDir, 'uniwork-auth', 'session.bin'))).toBe(true)
    }
  })

  test.afterAll(async () => {
    await stub?.close()
  })

  test.beforeEach(() => {
    test.skip(!keyring, NO_KEYRING_SKIP)
  })

  /** a fresh app on the signed-in userData; closed (gracefully) when `run` ends */
  async function withApp(
    name: string,
    run: (ctx: AppContext) => Promise<void>,
    options: { openFile?: string } = {},
  ): Promise<void> {
    const launched = await launchShell({
      userDataDir,
      onboardingSeen: true,
      videoDir: name,
      env: shellEnv(stub),
      ...(options.openFile ? { openFile: options.openFile } : {}),
    })
    try {
      const shell = options.openFile
        ? await waitForPageWithUrl(launched.app, 'shell/out')
        : launched.page
      // the stored credential is refreshed at launch
      await expect(accountButton(shell)).toHaveAttribute('data-state', 'signed-in', {
        timeout: 45_000,
      })
      await run({ launched, shell })
    } finally {
      await closeAndSaveVideo(launched, name)
    }
  }

  /** waits for the document's binding to reach `state` */
  const expectState = (shell: Page, state: string, timeout = 30_000) =>
    expect.poll(async () => (await activeStatus(shell))?.state, { timeout }).toBe(state)

  const label = (shell: Page) => chip(shell).locator('.uw-pill-label')

  // a ───────────────────────────────────────────────────────────────────────
  test('a. open from the UniWork picker, edit, Ctrl+S: one upload, one commit, Saved, recents', async () => {
    test.setTimeout(150_000)
    const name = 'quarterly-report.docx'
    const doc = stub.addDocument({ filename: name, bytes: await docxBytes() })
    await withApp('uniwork-docs-open-save', async ({ launched, shell }) => {
      await openFromPicker(shell, name)
      const editor = await docsEditor(launched.app)

      // opened from the server: detail + bytes, a bound working copy, nothing sent yet
      const opened = await activeStatus(shell)
      expect(opened).toMatchObject({ documentId: doc.id, access: 'edit', state: 'ready' })
      await expect(label(shell)).toHaveText('Saved to UniWork')
      await expect(shell.locator('.uw-tab-marker')).toHaveCount(1)
      expect(stub.uploads(doc.id)).toHaveLength(0)
      expect(stub.commits(doc.id)).toHaveLength(0)

      await typeInDocs(editor, MARKER)
      await saveShortcut(editor)
      await expectState(shell, 'saved')

      // exactly one save intent reached UniWork, upload and commit under one key
      const uploads = stub.uploads(doc.id)
      const commits = stub.commits(doc.id)
      expect(uploads).toHaveLength(1)
      expect(commits).toHaveLength(1)
      expect(uploads[0]!.idempotencyKey).toMatch(/^office-key-/)
      expect(commits[0]!.idempotencyKey).toBe(uploads[0]!.idempotencyKey)
      expect(commits[0]).toMatchObject({ status: 200, baseRevision: '41' })

      // the server holds the edited bytes as the newest version
      const server = stub.state(doc.id)
      expect(server.revision).toBe('42')
      expect(await zipEntry(server.bytes, 'word/document.xml')).toContain(MARKER)
      const saved = (await activeStatus(shell))!
      expect(saved.lastSavedAt).toBeTruthy()
      expect(sha256(await readFile(saved.path))).toBe(server.checksum)
      await expect(chip(shell)).toHaveAttribute('data-state', 'saved')
      await expect(label(shell)).toHaveText('Saved to UniWork')

      // nothing else uploads afterwards (no timer, blur or idle save)
      await sleep(3_000)
      expect(stub.uploads(doc.id)).toHaveLength(1)
      expect(stub.commits(doc.id)).toHaveLength(1)

      // recents list the UniWork copy with its badge
      await shell.locator('.tab-item.tab-home').click()
      const row = shell.locator('.recent-row', { hasText: name })
      // Home reloads its list on window focus; returning through the tab strip
      // does not refocus (known gap, reported), so ask for the same reload
      await shell.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(row).toBeVisible()
      await expect(row.locator('.uw-recent-badge')).toBeVisible()
      await shell.screenshot({ path: screenshotPath('uniwork-docs-recents') })
    })
  })

  // b ───────────────────────────────────────────────────────────────────────
  test('b. launch from the web: the link opens the right document once, a reused link does nothing', async () => {
    test.setTimeout(150_000)
    const doc = stub.addDocument({ filename: 'launched-from-web.docx', bytes: await docxBytes() })
    stub.addDocument({ filename: 'decoy.docx', bytes: await docxBytes() })
    const { ticket, url } = stub.issueTicket(doc.id)
    await withApp('uniwork-docs-launch', async ({ launched, shell }) => {
      await deliverUrl(launched, shellEnv(stub), url)

      const tabs = shell.locator('.tab-bar .tab-item:not(.tab-home)')
      await expect(tabs).toHaveCount(1, { timeout: 45_000 })
      await expect(tabs).toContainText('launched-from-web')
      await docsEditor(launched.app)
      expect(await activeStatus(shell)).toMatchObject({
        documentId: doc.id,
        access: 'edit',
        state: 'ready',
      })
      await expect(label(shell)).toHaveText('Saved to UniWork')
      expect(stub.exchangeAttempts(ticket)).toBe(1)
      // the descriptor's own document: detail and bytes of it, nothing of the decoy
      expect(callsFor(stub, doc.id).map((c) => c.route)).toEqual([
        `/documents/${doc.id}`,
        `/documents/${doc.id}/download`,
      ])

      // the same link handed over again is not redeemed again and opens nothing new
      await deliverUrl(launched, shellEnv(stub), url)
      await sleep(2_500)
      expect(stub.exchangeAttempts(ticket)).toBe(1)
      await expect(tabs).toHaveCount(1)
    })
  })

  test('b2. launch from the web: an expired link is refused with a message, a view link opens read-only', async () => {
    test.setTimeout(150_000)
    const doc = stub.addDocument({ filename: 'old-link.docx', bytes: await docxBytes() })
    const expired = stub.issueTicket(doc.id, { ageMs: 130_000 })
    const viewDoc = stub.addDocument({ filename: 'shared-view.docx', bytes: await docxBytes() })
    const view = stub.issueTicket(viewDoc.id, { operation: 'view' })
    await withApp('uniwork-docs-launch-refused', async ({ launched, shell }) => {
      await deliverUrl(launched, shellEnv(stub), expired.url)
      await expect(notice(shell)).toContainText('This link is no longer valid', {
        timeout: 45_000,
      })
      expect(stub.exchangeAttempts(expired.ticket)).toBe(1)
      await expect(shell.locator('.tab-bar .tab-item:not(.tab-home)')).toHaveCount(0)
      // nothing was downloaded for it
      expect(callsFor(stub, doc.id)).toHaveLength(0)

      // a link for a view-only launch opens the document read-only
      await deliverUrl(launched, shellEnv(stub), view.url)
      await expect(shell.locator('.tab-bar .tab-item:not(.tab-home)')).toHaveCount(1, {
        timeout: 45_000,
      })
      const editor = await docsEditor(launched.app)
      expect(await activeStatus(shell)).toMatchObject({ documentId: viewDoc.id, access: 'view' })
      await expect(label(shell)).toHaveText('View only')
      expect(
        await editor.evaluate(
          () => (window as unknown as AidocsWindow).__aidocs!.editor!.isEditable,
        ),
      ).toBe(false)
    })
  })

  // c ───────────────────────────────────────────────────────────────────────
  test('c. no autosave: an edit left alone for over 35 s sends nothing and keeps a local recovery copy', async () => {
    test.setTimeout(180_000)
    const name = 'no-autosave.docx'
    const doc = stub.addDocument({ filename: name, bytes: await docxBytes() })
    await withApp('uniwork-docs-no-autosave', async ({ launched, shell }) => {
      await openFromPicker(shell, name)
      const editor = await docsEditor(launched.app)
      const opened = (await activeStatus(shell))!
      const before = stub.callCount()
      const openedChecksum = sha256(await readFile(opened.path))
      expect(openedChecksum).toBe(doc.checksum)

      await typeInDocs(editor, MARKER)
      const editedAt = Date.now()

      // the module's crash-recovery copy still lands in userData (genoffice behaviour)
      const recoveryDir = join(userDataDir, 'docs-autosave')
      await expect
        .poll(
          async () => {
            if (!existsSync(recoveryDir)) return false
            for (const file of await readdir(recoveryDir)) {
              if (!file.endsWith('.docx')) continue
              const text = await zipEntry(
                await readFile(join(recoveryDir, file)),
                'word/document.xml',
              ).catch(() => '')
              if (text.includes(MARKER)) return true
            }
            return false
          },
          { timeout: 60_000, intervals: [1_000] },
        )
        .toBe(true)

      // well past any timer: still nothing uploaded or committed, the working copy untouched
      await sleep(Math.max(0, 36_000 - (Date.now() - editedAt)))
      expect(stub.callCount()).toBe(before)
      expect(stub.uploads(doc.id)).toHaveLength(0)
      expect(stub.commits(doc.id)).toHaveLength(0)
      expect(sha256(await readFile(opened.path))).toBe(openedChecksum)
      expect(stub.state(doc.id).revision).toBe('41')
      expect((await activeStatus(shell))?.state).not.toBe('saving')
    })
  })

  // d ───────────────────────────────────────────────────────────────────────
  /** opens a docx, edits it, bumps the server revision and saves into the 409 */
  async function intoConflict(
    ctx: AppContext,
    name: string,
    webBytes?: Buffer,
  ): Promise<{ doc: StubDocumentState; editor: Page; path: string }> {
    const doc = stub.addDocument({ filename: name, bytes: await docxBytes() })
    await openFromPicker(ctx.shell, name)
    const editor = await docsEditor(ctx.launched.app)
    await typeInDocs(editor, MARKER)
    // someone saves in the web editor while this copy is open
    stub.bumpRevision(doc.id, webBytes)
    await saveShortcut(editor)
    await expectState(ctx.shell, 'conflict')
    return { doc, editor, path: (await activeStatus(ctx.shell))!.path }
  }

  test('d. conflict: 409 keeps the local edit and the base, Save refuses, overwrite commits on the new base', async () => {
    test.setTimeout(180_000)
    await withApp('uniwork-docs-conflict', async (ctx) => {
      const { shell, launched } = ctx
      const { doc, editor, path } = await intoConflict(ctx, 'conflict-overwrite.docx')

      const first = stub.commits(doc.id)
      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({ status: 409, baseRevision: '41' })
      await expect(chip(shell)).toHaveAttribute('data-state', 'conflict')
      await expect(label(shell)).toHaveText('Conflict')
      await expect(chip(shell).getByRole('button', { name: 'Resolve…' })).toBeVisible()
      await shell.screenshot({ path: screenshotPath('uniwork-docs-conflict-chip') })

      // the local file keeps the edit; the server keeps the other version; the base is untouched
      expect(await zipEntry(await readFile(path), 'word/document.xml')).toContain(MARKER)
      expect(await zipEntry(stub.state(doc.id).bytes, 'word/document.xml')).not.toContain(MARKER)
      expect(await binding(path)).toMatchObject({
        state: 'conflict',
        baseRevision: '41',
        serverRevision: '42',
      })
      expect(await binding(path)).not.toHaveProperty('pendingIntent')

      // every further Save refuses without touching the network
      const sent = stub.callCount()
      await saveShortcut(editor)
      await sleep(2_000)
      expect(stub.callCount()).toBe(sent)
      await expectState(shell, 'conflict', 5_000)

      // "Save my version as the newest version" -> commit on the server's revision
      await answerMessageBoxes(launched, [0])
      await chip(shell).getByRole('button', { name: 'Resolve…' }).click()
      await expectState(shell, 'saved')

      const boxes = await seenMessageBoxes(launched)
      expect(boxes).toHaveLength(1)
      expect(boxes[0]!.message).toContain('conflict-overwrite.docx')
      expect(boxes[0]!.buttons).toEqual([
        'Save my version as the newest version',
        'Save a copy on this computer',
        'Discard my changes and open the latest',
        'Decide later',
      ])
      const commits = stub.commits(doc.id)
      expect(commits).toHaveLength(2)
      expect(commits[1]).toMatchObject({ status: 200, baseRevision: '42' })
      // a new intent: a new key
      expect(commits[1]!.idempotencyKey).not.toBe(commits[0]!.idempotencyKey)
      const server = stub.state(doc.id)
      expect(server.revision).toBe('43')
      expect(await zipEntry(server.bytes, 'word/document.xml')).toContain(MARKER)
      await expect(label(shell)).toHaveText('Saved to UniWork')
    })
  })

  test('d2. conflict: "Discard my changes and open the latest" asks twice, then shows the web version', async () => {
    test.setTimeout(180_000)
    const web = await docxOtherBytes()
    await withApp('uniwork-docs-conflict-latest', async (ctx) => {
      const { shell, launched } = ctx
      const { doc, path } = await intoConflict(ctx, 'conflict-latest.docx', web)

      // choice 3 (open the latest), then confirm the discard
      await answerMessageBoxes(launched, [2, 0])
      await chip(shell).getByRole('button', { name: 'Resolve…' }).click()
      await expectState(shell, 'saved')

      const boxes = await seenMessageBoxes(launched)
      expect(boxes).toHaveLength(2)
      expect(boxes[1]!.buttons).toEqual(['Discard and open the latest', 'Cancel'])
      // the working copy is now the web version, nothing was committed
      expect(sha256(await readFile(path))).toBe(sha256(web))
      expect(stub.commits(doc.id)).toHaveLength(1)
      expect(await binding(path)).toMatchObject({ state: 'saved', baseRevision: '42' })
      expect(await zipEntry(await readFile(path), 'word/document.xml')).not.toContain(MARKER)
    })
  })

  test('d3. conflict: "Save a copy on this computer" writes a plain local file and the document stays in conflict', async () => {
    test.setTimeout(180_000)
    const copyDir = await mkdtemp(join(tmpdir(), 'uniwork-e2e-copy-'))
    const copyPath = join(copyDir, 'conflict-copy (my copy).docx')
    await withApp('uniwork-docs-conflict-copy', async (ctx) => {
      const { shell, launched } = ctx
      const { doc, path } = await intoConflict(ctx, 'conflict-copy.docx')

      await answerMessageBoxes(launched, [1])
      const suggested = await launched.app.evaluate(({ dialog }, target) => {
        const g = globalThis as unknown as { __e2eSavePath?: string }
        dialog.showSaveDialog = (async (...args: unknown[]) => {
          const options = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string }
          g.__e2eSavePath = options.defaultPath
          return { canceled: false, filePath: target }
        }) as typeof dialog.showSaveDialog
        return true
      }, copyPath)
      expect(suggested).toBe(true)
      await chip(shell).getByRole('button', { name: 'Resolve…' }).click()

      await expect.poll(() => existsSync(copyPath), { timeout: 15_000 }).toBe(true)
      const proposed = await launched.app.evaluate(
        () => (globalThis as unknown as { __e2eSavePath?: string }).__e2eSavePath ?? '',
      )
      expect(proposed).toMatch(/conflict-copy \(my copy\)\.docx$/)
      expect(await zipEntry(await readFile(copyPath), 'word/document.xml')).toContain(MARKER)
      // the document itself is still in conflict and nothing more was sent
      await expectState(shell, 'conflict', 5_000)
      expect(stub.commits(doc.id)).toHaveLength(1)
      expect(await binding(path)).toMatchObject({ state: 'conflict', baseRevision: '41' })
    })
  })

  // e ───────────────────────────────────────────────────────────────────────
  test('e. view-only: opens read-only, typing changes nothing, Ctrl+S sends nothing', async () => {
    test.setTimeout(150_000)
    const name = 'view-only.docx'
    const doc = stub.addDocument({ filename: name, bytes: await docxBytes(), myLevel: 'view' })
    await withApp('uniwork-docs-view-only', async ({ launched, shell }) => {
      await openFromPicker(shell, name)
      const editor = await docsEditor(launched.app)
      const status = (await activeStatus(shell))!
      expect(status).toMatchObject({ documentId: doc.id, access: 'view' })
      await expect(label(shell)).toHaveText('View only')
      expect(
        await editor.evaluate(
          () => (window as unknown as AidocsWindow).__aidocs!.editor!.isEditable,
        ),
      ).toBe(false)

      const textBefore = await docsText(editor)
      const sent = stub.callCount()
      await editor.locator('.doc-page').first().click()
      await editor.keyboard.type(` ${MARKER}`, { delay: 20 })
      expect(await docsText(editor)).toBe(textBefore)
      await saveShortcut(editor)
      await sleep(2_500)

      expect(stub.callCount()).toBe(sent)
      expect(stub.uploads(doc.id)).toHaveLength(0)
      expect(stub.commits(doc.id)).toHaveLength(0)
      expect(sha256(await readFile(status.path))).toBe(doc.checksum)
      await expect(label(shell)).toHaveText('View only')
      await shell.screenshot({ path: screenshotPath('uniwork-docs-view-only') })
    })
  })

  // f ───────────────────────────────────────────────────────────────────────
  test('f. offline: a dropped commit keeps the intent, Retry reuses the same key and succeeds', async () => {
    test.setTimeout(150_000)
    const name = 'offline-before.docx'
    const doc = stub.addDocument({ filename: name, bytes: await docxBytes() })
    await withApp('uniwork-docs-offline', async ({ launched, shell }) => {
      await openFromPicker(shell, name)
      const editor = await docsEditor(launched.app)
      await typeInDocs(editor, MARKER)

      stub.failNextCommit('before')
      await saveShortcut(editor)
      await expectState(shell, 'offline')
      await expect(chip(shell)).toHaveAttribute('data-state', 'offline')
      await expect(label(shell)).toHaveText('Not saved: offline')
      const retry = chip(shell).getByRole('button', { name: 'Retry' })
      await expect(retry).toBeVisible()
      await shell.screenshot({ path: screenshotPath('uniwork-docs-offline-chip') })

      // the intent was persisted with its key before the network was used
      const path = (await activeStatus(shell))!.path
      const intent = (await binding(path)).pendingIntent as { idempotencyKey: string }
      expect(intent.idempotencyKey).toMatch(/^office-key-/)
      expect(stub.uploads(doc.id)).toHaveLength(1)
      expect(stub.commits(doc.id)).toEqual([expect.objectContaining({ status: 'dropped' })])
      // the local save still succeeded
      expect(await zipEntry(await readFile(path), 'word/document.xml')).toContain(MARKER)

      await retry.click()
      await expectState(shell, 'saved')
      const uploads = stub.uploads(doc.id)
      const commits = stub.commits(doc.id)
      expect(commits).toHaveLength(2)
      expect(commits[1]).toMatchObject({ status: 200, baseRevision: '41' })
      for (const call of [...uploads, ...commits]) {
        expect(call.idempotencyKey).toBe(intent.idempotencyKey)
      }
      expect(stub.state(doc.id).revision).toBe('42')
      expect(await binding(path)).not.toHaveProperty('pendingIntent')
      await expect(label(shell)).toHaveText('Saved to UniWork')
    })
  })

  test('f2. offline: a commit that landed but lost its answer is replayed by Retry without a second version', async () => {
    test.setTimeout(150_000)
    const name = 'offline-after.docx'
    const doc = stub.addDocument({ filename: name, bytes: await docxBytes() })
    await withApp('uniwork-docs-offline-replay', async ({ launched, shell }) => {
      await openFromPicker(shell, name)
      const editor = await docsEditor(launched.app)
      await typeInDocs(editor, MARKER)

      stub.failNextCommit('after')
      await saveShortcut(editor)
      await expectState(shell, 'offline')
      // the server did commit; the app does not know
      expect(stub.state(doc.id).revision).toBe('42')
      const versionAfterFirst = stub.state(doc.id).version

      await chip(shell).getByRole('button', { name: 'Retry' }).click()
      await expectState(shell, 'saved')
      const commits = stub.commits(doc.id)
      expect(commits).toHaveLength(2)
      expect(commits[1]!.idempotencyKey).toBe(commits[0]!.idempotencyKey)
      // the stored answer was replayed: still one new version
      expect(stub.state(doc.id).revision).toBe('42')
      expect(stub.state(doc.id).version).toBe(versionAfterFirst)
      const path = (await activeStatus(shell))!.path
      expect(await binding(path)).toMatchObject({ state: 'saved', baseRevision: '42' })
    })
  })

  // g ───────────────────────────────────────────────────────────────────────
  interface FormatDriver {
    key: string
    filename: string
    bytes(): Promise<Buffer> | Buffer
    /** opens the module for the active tab, makes one edit; returns the explicit Save */
    edit(ctx: AppContext): Promise<{ save(): Promise<void> }>
    /** the server's newest bytes carry the edit */
    carriesEdit(bytes: Buffer): Promise<boolean>
  }

  const drivers: FormatDriver[] = [
    {
      key: 'xlsx',
      filename: 'budget.xlsx',
      bytes: xlsxBytes,
      async edit({ launched }) {
        const sheets = await waitForPageWithUrl(launched.app, '://sheets/')
        await sheets.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
          timeout: 30_000,
        })
        await sheets.waitForTimeout(1_500)
        const grid = await sheets.evaluate(() => {
          for (const canvas of document.querySelectorAll('canvas')) {
            const rect = canvas.getBoundingClientRect()
            if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
          }
          return null
        })
        expect(grid, 'worksheet canvas').not.toBeNull()
        // cell A1: right of the row header, below the column header
        await sheets.mouse.click(grid!.x + 46 + 43, grid!.y + 24 + 12)
        await expect(sheets.locator('[data-u-comp="defined-name"] input')).toHaveValue('A1')
        await sheets.keyboard.type('Hello', { delay: 50 })
        await sheets.keyboard.press('Enter')
        return { save: () => sendToView(launched, '://sheets/', 'menu:action', 'save') }
      },
      carriesEdit: async (bytes) =>
        (await zipEntry(bytes, 'xl/worksheets/sheet1.xml')).includes('Hello'),
    },
    {
      key: 'pptx',
      filename: 'deck.pptx',
      bytes: pptxBytes,
      async edit({ launched }) {
        const slides = await waitForPageWithUrl(launched.app, '://slides/')
        await slides.waitForSelector('.stage-wrap canvas', { timeout: 30_000 })
        const replaced = await slides.evaluate(
          async ({ find, replace }) => {
            const api = (
              window as unknown as {
                slidesApi: {
                  findReplace(op: {
                    find: string
                    replace: string
                  }): Promise<{ count: number } | null>
                }
              }
            ).slidesApi
            return api.findReplace({ find, replace })
          },
          { find: 'font manager smoke', replace: MARKER },
        )
        expect(replaced?.count).toBeGreaterThan(0)
        return { save: () => sendToView(launched, '://slides/', 'slides:menu', 'save') }
      },
      carriesEdit: async (bytes) => {
        const xml = await zipEntry(bytes, 'ppt/slides/slide1.xml')
        return xml.includes(MARKER) && !xml.includes('font manager smoke')
      },
    },
    {
      key: 'md',
      filename: 'meeting-notes.md',
      bytes: () => Buffer.from('# Meeting notes\n\nAgenda item one.\n'),
      async edit({ launched }) {
        const page = await waitForPageWithUrl(launched.app, '://markdown/')
        const editor = page.locator('.doc-editor')
        await expect(editor.locator('h1')).toHaveText('Meeting notes')
        await editor.click()
        await page.keyboard.press('ControlOrMeta+End')
        await page.keyboard.type(` ${MD_MARKER}`)
        return { save: () => page.keyboard.press('ControlOrMeta+s') }
      },
      carriesEdit: async (bytes) =>
        bytes.toString('utf8').includes(MD_MARKER) &&
        bytes.toString('utf8').includes('# Meeting notes'),
    },
    {
      key: 'html',
      filename: 'landing.html',
      bytes: () =>
        Buffer.from(
          '<!doctype html>\n<html>\n<body>\n<h1 class="hero">Hello</h1>\n</body>\n</html>\n',
        ),
      async edit({ launched }) {
        const page = await waitForPageWithUrl(launched.app, '://html/')
        await expect(page.locator('.ribbon-body')).toBeVisible()
        await page.locator('.rb-view', { hasText: /Split/ }).click()
        const content = page.locator('.source-editor .cm-content')
        await expect(content).toContainText('class="hero"')
        await content.click()
        await page.keyboard.press('ControlOrMeta+End')
        await page.keyboard.type(`<!-- ${MARKER} -->`)
        return { save: () => page.keyboard.press('ControlOrMeta+s') }
      },
      carriesEdit: async (bytes) => bytes.toString('utf8').includes(`<!-- ${MARKER} -->`),
    },
  ]

  for (const [index, driver] of drivers.entries()) {
    test(`g${index + 1}. ${driver.key}: open, edit, explicit Save: one upload, one commit`, async () => {
      test.setTimeout(150_000)
      const doc = stub.addDocument({ filename: driver.filename, bytes: await driver.bytes() })
      await withApp(`uniwork-docs-${driver.key}`, async (ctx) => {
        await openFromPicker(ctx.shell, driver.filename)
        const { save } = await driver.edit(ctx)
        await save()
        await expectState(ctx.shell, 'saved')
        expect(stub.uploads(doc.id)).toHaveLength(1)
        expect(stub.commits(doc.id)).toHaveLength(1)
        const server = stub.state(doc.id)
        expect(server.revision).toBe('42')
        expect(await driver.carriesEdit(server.bytes)).toBe(true)
        await expect(label(ctx.shell)).toHaveText('Saved to UniWork')
      })
    })
  }

  test('g9. pdf: opens, an explicit Save settles with at most one intent', async () => {
    test.setTimeout(150_000)
    const doc = stub.addDocument({ filename: 'invoice.pdf', bytes: pdfBytes() })
    await withApp('uniwork-docs-pdf', async ({ launched, shell }) => {
      await openFromPicker(shell, 'invoice.pdf')
      const page = await waitForPageWithUrl(launched.app, '://pdf/')
      await expect(page.locator('.pdf-page').first()).toBeVisible({ timeout: 30_000 })
      expect(await activeStatus(shell)).toMatchObject({ documentId: doc.id, access: 'edit' })
      await expect(label(shell)).toHaveText('Saved to UniWork')

      await page.locator('.pdf-page').first().click()
      await page.keyboard.press('ControlOrMeta+s')
      await expectState(shell, 'saved', 15_000)
      expect(stub.uploads(doc.id).length).toBeLessThanOrEqual(1)
      expect(stub.commits(doc.id).length).toBe(stub.uploads(doc.id).length)
    })
  })

  test('g10. pdf: a view-only pdf opens read-only and a Save sends nothing', async () => {
    test.setTimeout(150_000)
    const doc = stub.addDocument({ filename: 'policy.pdf', bytes: pdfBytes(), myLevel: 'view' })
    await withApp('uniwork-docs-pdf-view', async ({ launched, shell }) => {
      await openFromPicker(shell, 'policy.pdf')
      const page = await waitForPageWithUrl(launched.app, '://pdf/')
      await expect(page.locator('.pdf-page').first()).toBeVisible({ timeout: 30_000 })
      expect(await activeStatus(shell)).toMatchObject({ documentId: doc.id, access: 'view' })
      await expect(label(shell)).toHaveText('View only')
      const sent = stub.callCount()
      await page.locator('.pdf-page').first().click()
      await page.keyboard.press('ControlOrMeta+s')
      await sleep(2_500)
      expect(stub.callCount()).toBe(sent)
      expect(stub.uploads(doc.id)).toHaveLength(0)
      expect(sha256(await readFile((await activeStatus(shell))!.path))).toBe(doc.checksum)
    })
  })

  // h ───────────────────────────────────────────────────────────────────────
  test('h. a local file saves exactly as before and nothing goes to UniWork', async () => {
    test.setTimeout(150_000)
    const dir = await mkdtemp(join(tmpdir(), 'uniwork-e2e-local-'))
    const local = join(dir, 'local-only.docx')
    await copyFile(join(ROOT, 'fixtures/generated/simple.docx'), local)
    const before = stub.callCount()
    await withApp(
      'uniwork-docs-local',
      async ({ launched, shell }) => {
        const editor = await docsEditor(launched.app)
        // signed in, yet this path is not a UniWork document
        expect(await statusOf(shell, local)).toBeNull()
        await expect(chip(shell)).toHaveCount(0)
        await expect(shell.locator('.uw-tab-marker')).toHaveCount(0)

        await typeInDocs(editor, MARKER)
        await saveShortcut(editor)
        await expect
          .poll(
            async () =>
              (await zipEntry(await readFile(local), 'word/document.xml')).includes(MARKER),
            {
              timeout: 20_000,
            },
          )
          .toBe(true)
        await sleep(2_500)
        // no binding appeared, no chip, and the server never heard of it
        expect(await statusOf(shell, local)).toBeNull()
        await expect(chip(shell)).toHaveCount(0)
        expect(stub.callCount()).toBe(before)
        expect(existsSync(join(dirname(local), 'binding.json'))).toBe(false)
      },
      { openFile: local },
    )
  })

  // the chip's Retry runs each module's own Save, not only the docs one
  for (const [index, driver] of drivers.entries()) {
    test(`i${index + 1}. ${driver.key}: offline, then Retry from the chip saves with the same key`, async () => {
      test.setTimeout(150_000)
      const filename = `retry-${driver.filename}`
      const doc = stub.addDocument({ filename, bytes: await driver.bytes() })
      await withApp(`uniwork-docs-${driver.key}-retry`, async (ctx) => {
        await openFromPicker(ctx.shell, filename)
        const { save } = await driver.edit(ctx)
        stub.failNextCommit('before')
        await save()
        await expectState(ctx.shell, 'offline')
        const path = (await activeStatus(ctx.shell))!.path
        const intent = (await binding(path)).pendingIntent as { idempotencyKey: string }

        await chip(ctx.shell).getByRole('button', { name: 'Retry' }).click()
        await expectState(ctx.shell, 'saved')
        const commits = stub.commits(doc.id)
        expect(commits).toHaveLength(2)
        expect(commits.map((c) => c.idempotencyKey)).toEqual([
          intent.idempotencyKey,
          intent.idempotencyKey,
        ])
        expect(stub.state(doc.id).revision).toBe('42')
        expect(await driver.carriesEdit(stub.state(doc.id).bytes)).toBe(true)
      })
    })
  }
})
