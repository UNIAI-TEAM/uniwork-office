import { test, expect, type Locator, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { en as syncEn } from '../apps/shell/src/renderer/src/i18n/sync/en'
import { en as uniworkDocsEn } from '../apps/shell/src/renderer/src/i18n/uniwork-documents/en'
import { en as uniworkFoldersEn } from '../apps/shell/src/renderer/src/i18n/uniwork-folders/en'
import { en as uniworkHomeEn } from '../apps/shell/src/renderer/src/i18n/uniwork-home/en'
import { en as uniworkSaveEn } from '../apps/shell/src/renderer/src/i18n/uniwork-save/en'
import {
  closeAndSaveVideo,
  launchShell,
  screenshotPath,
  waitForPageWithUrl,
  type LaunchedApp,
} from './helpers'
import {
  startUniworkDocumentsStub,
  type StubDocumentState,
  type UniworkDocumentsStub,
} from './fixtures/uniwork-documents-stub'
import {
  NO_KEYRING_SKIP,
  accountButton,
  hasOsKeyring,
  shellEnv,
  signIn,
} from './fixtures/uniwork-signin-steps'

/**
 * FD-11 UniWork folders & SAVE-01 first-save end to end: folder creation, live
 * tree/contents refresh on web-side moves, archives, and restores via the
 * change feed, 3-level breadcrumb navigation, title search with ancestor paths
 * and kind filtering, conflict Save-as-a-copy into a chosen folder, New
 * document + Upload into a chosen folder via the Location picker, and first
 * save of an unbound local document into My Folder or a chosen folder plus My
 * Folder localization and lock in the folder tree/browser.
 *
 * The account is signed in once in `beforeAll`; each scenario launches a fresh
 * shell on the shared `userDataDir`.
 */

const ROOT = resolve(__dirname, '..')
const MARKER = 'UNIWORK_FOLDER_E2E_EDIT'

const docxBytes = () => readFile(join(ROOT, 'fixtures/generated/simple.docx'))

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

async function zipEntry(bytes: Uint8Array, name: string): Promise<string> {
  const entry = (await JSZip.loadAsync(bytes)).file(name)
  if (!entry) throw new Error(`no ${name} in the archive`)
  return entry.async('string')
}

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
  shell: Page
}

type ShellWindowApis = {
  aiOffice: {
    uniworkActiveDocStatus(): Promise<DocStatus | null>
    uniworkDocStatus(filePath: string): Promise<DocStatus | null>
  }
  uniworkSyncCenter: {
    syncNow(): Promise<void>
  }
}

interface AidocsWindow {
  __aidocs?: {
    editor?: {
      isEditable: boolean
      commands: { setTextSelection: (pos: number) => void }
      state: { doc: { content: { size: number }; textContent: string } }
    }
  }
}

const activeStatus = (shell: Page): Promise<DocStatus | null> =>
  shell.evaluate(() => (window as unknown as ShellWindowApis).aiOffice.uniworkActiveDocStatus())

const statusOf = (shell: Page, filePath: string): Promise<DocStatus | null> =>
  shell.evaluate(
    (p) => (window as unknown as ShellWindowApis).aiOffice.uniworkDocStatus(p),
    filePath,
  )

const triggerFeedTick = (shell: Page): Promise<void> =>
  shell.evaluate(() => (window as unknown as ShellWindowApis).uniworkSyncCenter.syncNow())

const chip = (shell: Page) => shell.locator('.uw-pill:not(.uw-notice)')

/**
 * Triggers the application menu item `File > Save to UniWork` (`Lưu vào UniWork`).
 */
async function triggerSaveToUniWork(app: LaunchedApp['app']): Promise<void> {
  const triggered = await app.evaluate(({ Menu }) => {
    const walk = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const it of items) {
        if (it.submenu) {
          const found = walk(it.submenu.items)
          if (found) return found
        } else if (/uniwork/i.test(it.label ?? '') && /(save|lưu)/i.test(it.label ?? '')) {
          return it
        }
      }
      return null
    }
    const m = Menu.getApplicationMenu()
    const target = m ? walk(m.items) : null
    if (target) {
      target.click()
      return true
    }
    return false
  })
  expect(triggered).toBe(true)
}

/**
 * Selects the workspace root (`UniWork`) in the DocumentsHome sidebar folder tree
 * so the UniWork area switches from the initial Recent sub-view to the workspace
 * root folder view (`Workspace documents`).
 */
async function openUniworkFolderBrowser(shell: Page) {
  const browser = shell.locator('.home-root')
  const tree = browser.getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
  await expect(tree).toBeVisible()
  await tree.getByRole('treeitem', { name: uniworkFoldersEn.ufRoot }).click()
  const home = browser.locator('.dh-home')
  await expect(home.locator('.dh-title')).toHaveText(uniworkHomeEn.uhNavWorkspace)
  await expect(home.locator('.uw-pick-skeleton')).toHaveCount(0, { timeout: 15_000 })
  return browser
}

async function contentTitlesOf(contents: Locator): Promise<string[]> {
  return contents
    .locator('.dh-folder-name, .dh-doc-open')
    .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()))
}

/**
 * Makes sure a tree folder is expanded. The tree is a flat list of treeitems, so
 * a folder only has an `aria-expanded` attribute once it has children, and its
 * children are the rows one level deeper that follow it.
 */
async function expandTreeFolder(tree: Locator, title: string): Promise<void> {
  const item = tree.getByRole('treeitem', { name: title })
  await expect(item).toHaveAttribute('aria-expanded', /^(true|false)$/)
  if ((await item.getAttribute('aria-expanded')) === 'false') {
    await item.locator('.uwf-twisty').click()
  }
  await expect(item).toHaveAttribute('aria-expanded', 'true')
}

/** the titles of a folder's direct children in the (expanded) tree, in order */
const treeChildrenOf = (tree: Locator, title: string): Promise<string[]> =>
  tree.getByRole('treeitem').evaluateAll((rows, parent) => {
    const flat = rows.map((row) => ({
      level: Number(row.getAttribute('aria-level')),
      title: row.querySelector('.uwf-tree-title')?.textContent ?? '',
    }))
    const at = flat.findIndex((row) => row.title === parent)
    if (at < 0) return []
    const children: string[] = []
    for (let i = at + 1; i < flat.length && flat[i]!.level > flat[at]!.level; i += 1) {
      if (flat[i]!.level === flat[at]!.level + 1) children.push(flat[i]!.title)
    }
    return children
  }, title)

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

const saveShortcut = (editor: Page) => editor.keyboard.press('ControlOrMeta+s')

test.describe.serial('UniWork folders (FD-11)', () => {
  let stub: UniworkDocumentsStub
  let userDataDir = ''
  let keyring = true

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    stub = await startUniworkDocumentsStub({ feed: true })
    const first = await launchShell({
      onboardingSeen: true,
      videoDir: 'uniwork-folders-setup',
      env: shellEnv(stub),
    })
    userDataDir = first.userDataDir
    try {
      keyring = await hasOsKeyring(first)
      if (keyring) await signIn(first, stub)
    } finally {
      await closeAndSaveVideo(first, 'uniwork-folders-setup')
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

  async function withApp(
    name: string,
    run: (ctx: AppContext) => Promise<void>,
    options: { openFile?: string } = {},
  ): Promise<void> {
    const launched = await launchShell({
      userDataDir,
      onboardingSeen: true,
      videoDir: name,
      openFile: options.openFile,
      env: shellEnv(stub),
    })
    try {
      const shell = options.openFile
        ? await waitForPageWithUrl(launched.app, 'shell/out')
        : launched.page
      await expect(accountButton(shell)).toHaveAttribute('data-state', 'signed-in', {
        timeout: 45_000,
      })
      await run({ launched, shell })
    } finally {
      await closeAndSaveVideo(launched, name)
    }
  }

  const expectState = (shell: Page, state: string, timeout = 30_000) =>
    expect.poll(async () => (await activeStatus(shell))?.state, { timeout }).toBe(state)

  // a ───────────────────────────────────────────────────────────────────────
  test('a. create a folder in the app: stub holds it with the right parent and duplicate names report folder_name_taken', async () => {
    test.setTimeout(150_000)
    const projects = stub.addFolder({ title: 'Projects' })

    await withApp('uniwork-folders-create', async ({ shell }) => {
      const dialog = await openUniworkFolderBrowser(shell)
      const tree = dialog.getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
      const contents = dialog.locator('.dh-home')
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      // Navigate into `Projects`
      await contents.locator('.dh-folder-open', { hasText: 'Projects' }).click()
      await expect(crumbs.getByText('Projects', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      // Create subfolder `Q4 Specs` inside `Projects`
      await dialog.getByRole('button', { name: uniworkFoldersEn.ufNewFolder, exact: true }).click()
      const nameDialog = shell.getByRole('dialog', { name: uniworkFoldersEn.ufNewSubfolder })
      await expect(nameDialog).toBeVisible()
      const nameInput = nameDialog.getByRole('textbox', { name: uniworkFoldersEn.ufFolderName })
      await expect(nameInput).toBeFocused()
      await nameInput.fill('Q4 Specs')
      await nameDialog.getByRole('button', { name: uniworkFoldersEn.ufCreate, exact: true }).click()
      await expect(nameDialog).toBeHidden()

      // The new folder is visible in both the contents list and the folder tree
      await expect(contents.locator('.dh-folder-open', { hasText: 'Q4 Specs' })).toBeVisible()
      await expect(tree.getByRole('treeitem', { name: 'Q4 Specs' })).toBeVisible()
      // The stub holds `Q4 Specs` with `parentId: projects.id`
      const created = stub.folders().find((f) => f.title === 'Q4 Specs')
      expect(created).toBeDefined()
      expect(created).toMatchObject({
        title: 'Q4 Specs',
        parentId: projects.id,
        archived: false,
      })

      // Attempting to create another `Q4 Specs` in the same parent surfaces `folder_name_taken`
      await dialog.getByRole('button', { name: uniworkFoldersEn.ufNewFolder, exact: true }).click()
      await expect(nameDialog).toBeVisible()
      await nameInput.fill('Q4 Specs')
      await nameDialog.getByRole('button', { name: uniworkFoldersEn.ufCreate, exact: true }).click()
      await expect(nameDialog.getByRole('alert')).toHaveText(uniworkFoldersEn.ufNameTaken)
      await expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      await nameDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(nameDialog).toBeHidden()
      await shell.screenshot({ path: screenshotPath('uniwork-folders-created') })
    })
  })

  // b ───────────────────────────────────────────────────────────────────────
  test('b. stub-side move + feed tick updates tree and contents without reload; vanished open folder falls back to live ancestor', async () => {
    test.setTimeout(150_000)
    const source = stub.addFolder({ title: 'Source Hub' })
    const target = stub.addFolder({ title: 'Target Hub' })
    const movingSub = stub.addFolder({ title: 'Moving Subfolder', parentId: source.id })
    const vanishingLeaf = stub.addFolder({ title: 'Vanishing Leaf', parentId: source.id })
    const movingDoc = stub.addDocument({
      filename: 'moving-roadmap.docx',
      bytes: await docxBytes(),
      parentId: source.id,
    })

    await withApp('uniwork-folders-feed-refresh', async ({ shell }) => {
      // Ensure the initial feed cursor is established before web-side mutations
      await triggerFeedTick(shell)

      const dialog = await openUniworkFolderBrowser(shell)
      const tree = dialog.getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
      const contents = dialog.locator('.dh-home')
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      // Open `Source Hub` and verify both the subfolder and document are listed
      await contents.locator('.dh-folder-open', { hasText: 'Source Hub' }).click()
      await expect(crumbs.getByText('Source Hub', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(
        contents.locator('.dh-folder-open', { hasText: 'Moving Subfolder' }),
      ).toBeVisible()
      await expect(contents.locator('.dh-folder-open', { hasText: 'Vanishing Leaf' })).toBeVisible()
      await expect(
        contents.locator('.dh-doc-open', { hasText: 'moving-roadmap.docx' }),
      ).toBeVisible()

      // Move both `Moving Subfolder` and `moving-roadmap.docx` into `Target Hub` on the web
      stub.webMove(movingSub.id, target.id)
      stub.webMove(movingDoc.id, target.id)
      await triggerFeedTick(shell)

      // Without reloading Home, `Source Hub` contents drop the moved items.
      // `Vanishing Leaf` stays: the list must have refreshed to exactly it, so a loading,
      // empty or error list cannot satisfy the `toBeHidden` checks.
      await expect
        .poll(() => contentTitlesOf(contents), { timeout: 15_000 })
        .toEqual(['Vanishing Leaf'])
      await expect(contents.locator('.dh-folder-open', { hasText: 'Vanishing Leaf' })).toBeVisible()
      await expect(
        contents.locator('.dh-folder-open', { hasText: 'Moving Subfolder' }),
      ).toBeHidden()
      await expect(
        contents.locator('.dh-doc-open', { hasText: 'moving-roadmap.docx' }),
      ).toBeHidden()

      // The tree moved too: `Target Hub` now holds `Moving Subfolder`, `Source Hub` does not
      await expandTreeFolder(tree, 'Target Hub')
      await expandTreeFolder(tree, 'Source Hub')
      await expect.poll(() => treeChildrenOf(tree, 'Target Hub')).toEqual(['Moving Subfolder'])
      await expect.poll(() => treeChildrenOf(tree, 'Source Hub')).toEqual(['Vanishing Leaf'])

      // Selecting `Target Hub` in the tree shows the moved subfolder and document
      await tree.getByRole('treeitem', { name: 'Target Hub' }).click()
      await expect(crumbs.getByText('Target Hub', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(
        contents.locator('.dh-folder-open', { hasText: 'Moving Subfolder' }),
      ).toBeVisible()
      await expect(
        contents.locator('.dh-doc-open', { hasText: 'moving-roadmap.docx' }),
      ).toBeVisible()

      // Rename `Moving Subfolder` on the web and advance the feed with `Target Hub` still open
      stub.webRename(movingSub.id, 'Renamed Subfolder')
      await triggerFeedTick(shell)

      await expect
        .poll(() => contentTitlesOf(contents), { timeout: 15_000 })
        .toEqual(['Renamed Subfolder', 'moving-roadmap.docx'])
      await expect(
        contents.locator('.dh-folder-open', { hasText: 'Renamed Subfolder' }),
      ).toBeVisible()
      await expect(
        contents.locator('.dh-folder-open', { hasText: 'Moving Subfolder' }),
      ).toBeHidden()
      await expect.poll(() => treeChildrenOf(tree, 'Target Hub')).toEqual(['Renamed Subfolder'])
      await expect(tree.getByRole('treeitem', { name: 'Renamed Subfolder' })).toBeVisible()
      await expect(tree.getByRole('treeitem', { name: 'Moving Subfolder' })).toBeHidden()

      // Navigate into `Source Hub` › `Vanishing Leaf`, then archive `Vanishing Leaf` on the web
      await tree.getByRole('treeitem', { name: 'Source Hub' }).click()
      await contents.locator('.dh-folder-open', { hasText: 'Vanishing Leaf' }).click()
      await expect(crumbs.getByText('Vanishing Leaf', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      stub.webArchive(vanishingLeaf.id)
      await triggerFeedTick(shell)

      // DocumentsHome reports the archived open folder with the not_found alert and drops it from the tree
      await expect(contents.getByRole('alert')).toContainText(uniworkDocsEn.uwErrNotFound, {
        timeout: 15_000,
      })
      await expect(contents.locator('.dh-folder-open', { hasText: 'Vanishing Leaf' })).toBeHidden()
      await expect.poll(() => treeChildrenOf(tree, 'Source Hub')).toEqual([])
      await tree.getByRole('treeitem', { name: 'Source Hub' }).click()
      await expect(crumbs.getByText('Source Hub', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await shell.screenshot({ path: screenshotPath('uniwork-folders-feed-fallback') })

      // Restore `Vanishing Leaf` on the web and advance the feed: it reappears in `Source Hub`
      // contents and in the folder tree without reloading Home
      stub.webRestore(vanishingLeaf.id)
      await triggerFeedTick(shell)

      await expect(contents.locator('.dh-folder-open', { hasText: 'Vanishing Leaf' })).toBeVisible({
        timeout: 15_000,
      })
      await expandTreeFolder(tree, 'Source Hub')
      await expect.poll(() => treeChildrenOf(tree, 'Source Hub')).toEqual(['Vanishing Leaf'])
      await expect(tree.getByRole('treeitem', { name: 'Vanishing Leaf' })).toBeVisible()
      await shell.screenshot({ path: screenshotPath('uniwork-folders-feed-restored') })
    })
  })

  // c ───────────────────────────────────────────────────────────────────────
  test('c. open 3 levels and go back via the breadcrumb', async () => {
    test.setTimeout(150_000)
    const level1 = stub.addFolder({ title: 'Platform' })
    const level2 = stub.addFolder({ title: 'Storage', parentId: level1.id })
    const level3 = stub.addFolder({ title: 'RFCs', parentId: level2.id })
    stub.addDocument({
      filename: 'rfc-folder-tree.docx',
      bytes: await docxBytes(),
      parentId: level3.id,
    })

    await withApp('uniwork-folders-breadcrumbs', async ({ shell }) => {
      const dialog = await openUniworkFolderBrowser(shell)
      const contents = dialog.locator('.dh-home')
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      // Level 1: Platform
      await contents.locator('.dh-folder-open', { hasText: 'Platform' }).click()
      await expect(crumbs.getByText('Platform', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      // Level 2: Storage
      await contents.locator('.dh-folder-open', { hasText: 'Storage' }).click()
      await expect(crumbs.getByText('Storage', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      // Level 3: RFCs
      await contents.locator('.dh-folder-open', { hasText: 'RFCs' }).click()
      await expect(crumbs.getByText('RFCs', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(
        contents.locator('.dh-doc-open', { hasText: 'rfc-folder-tree.docx' }),
      ).toBeVisible()

      // Breadcrumb trail has ancestor buttons UniWork › Platform › Storage and current page RFCs
      await expect(crumbs.getByRole('button')).toHaveText([
        uniworkFoldersEn.ufRoot,
        'Platform',
        'Storage',
      ])
      await expect(crumbs.getByText('RFCs', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      // Click `Platform` in the breadcrumb to jump back to level 1
      await crumbs.getByRole('button', { name: 'Platform', exact: true }).click()
      await expect(crumbs.getByText('Platform', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(contents.locator('.dh-folder-open', { hasText: 'Storage' })).toBeVisible()

      // Click `UniWork` in the breadcrumb to return to the workspace root
      await crumbs.getByRole('button', { name: uniworkFoldersEn.ufRoot, exact: true }).click()
      await expect(crumbs).toBeHidden()
      await expect(contents.locator('.dh-title')).toHaveText(uniworkHomeEn.uhNavWorkspace)
      await expect(contents.locator('.dh-folder-open', { hasText: 'Platform' })).toBeVisible()
      await shell.screenshot({ path: screenshotPath('uniwork-folders-breadcrumbs') })
    })
  })

  // d ───────────────────────────────────────────────────────────────────────
  test('d. search shows each result path, filters by kind, and Escape returns to the open folder', async () => {
    test.setTimeout(150_000)
    const finance = stub.addFolder({ title: 'Finance' })
    const fy26 = stub.addFolder({ title: 'FY2026', parentId: finance.id })
    stub.addFolder({ title: 'Budget Ledger Folder', parentId: fy26.id })
    stub.addDocument({
      filename: 'budget-forecast.docx',
      bytes: await docxBytes(),
      parentId: fy26.id,
    })

    // 4-folder chain to verify the left-truncated path of a deep result
    const d1 = stub.addFolder({ title: 'Division' })
    const d2 = stub.addFolder({ title: 'Region', parentId: d1.id })
    const d3 = stub.addFolder({ title: 'Country', parentId: d2.id })
    const d4 = stub.addFolder({ title: 'Branch', parentId: d3.id })
    stub.addDocument({
      filename: 'budget-deep-branch.docx',
      bytes: await docxBytes(),
      parentId: d4.id,
    })

    await withApp('uniwork-folders-search', async ({ shell }) => {
      const dialog = await openUniworkFolderBrowser(shell)
      const contents = dialog.locator('.dh-home')
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      // Open `Finance` before searching so we can verify `Escape` returns to `Finance`
      await contents.locator('.dh-folder-open', { hasText: 'Finance' }).click()
      await expect(crumbs.getByText('Finance', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      const searchBox = contents.getByRole('searchbox', {
        name: uniworkHomeEn.uhSearchPlaceholder,
      })
      await searchBox.fill('budget')

      // A document result's path is left-truncated to its direct parent ("… › Parent ›");
      // the full ancestor path is in `.dh-doc-subpath`'s `title`
      const expectPath = async (row: Locator, short: string, full: string) => {
        const subpath = row.locator('.dh-doc-subpath')
        await expect(subpath).toHaveText(short)
        await expect(subpath).toHaveAttribute('title', full)
      }

      const forecastRow = contents.locator('.dh-doc-row', { hasText: 'budget-forecast.docx' })
      await expect(forecastRow).toBeVisible()
      await expectPath(forecastRow, '… › FY2026 ›', 'Finance › FY2026')

      // A deeper path keeps only the direct parent visible
      const deepRow = contents.locator('.dh-doc-row', { hasText: 'budget-deep-branch.docx' })
      await expect(deepRow).toBeVisible()
      await expectPath(deepRow, '… › Branch ›', 'Division › Region › Country › Branch')

      // Folder result is shown in the Folders section alongside the Documents table
      const folderCard = contents.locator('.dh-folder-open', { hasText: 'Budget Ledger Folder' })
      await expect(folderCard).toBeVisible()
      await shell.screenshot({ path: screenshotPath('uniwork-folders-search-paths') })

      // Pressing Escape in the search box clears search and returns to `Finance`
      await searchBox.press('Escape')
      await expect(crumbs.getByText('Finance', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(contents.locator('.dh-folder-open', { hasText: 'FY2026' })).toBeVisible()
    })
  })

  // e ───────────────────────────────────────────────────────────────────────
  test('e. save a copy into another folder from the conflict dialog: the copy lands in that folder in the stub', async () => {
    test.setTimeout(180_000)
    const originFolder = stub.addFolder({ title: 'Origin Folder' })
    const destinationFolder = stub.addFolder({ title: 'Archive Destination' })
    const docName = 'conflict-folder-copy.docx'
    const doc: StubDocumentState = stub.addDocument({
      filename: docName,
      bytes: await docxBytes(),
      parentId: originFolder.id,
    })

    await withApp('uniwork-folders-conflict-copy', async ({ launched, shell }) => {
      // Open `conflict-folder-copy.docx` from `Origin Folder`
      const openDialog = await openUniworkFolderBrowser(shell)
      const contents = openDialog.locator('.dh-home')
      await contents.locator('.dh-folder-open', { hasText: 'Origin Folder' }).click()
      await contents.locator('.dh-doc-open', { hasText: 'conflict-folder-copy.docx' }).click()
      await expect
        .poll(async () => (await activeStatus(shell))?.title, { timeout: 30_000 })
        .toBe(docName)
      // Edit locally, bump server revision, and trigger a 409 save conflict
      const editor = await docsEditor(launched.app)
      await typeInDocs(editor, MARKER)
      stub.bumpRevision(doc.id)
      await saveShortcut(editor)
      await expectState(shell, 'conflict')

      const localPath = (await activeStatus(shell))!.path
      const localBytes = await readFile(localPath)

      // Open the conflict resolution dialog -> Save as a copy…
      await chip(shell).getByRole('button', { name: 'Resolve…' }).click()
      const conflictDialog = shell.getByRole('alertdialog')
      await expect(conflictDialog).toBeVisible()
      await conflictDialog.getByRole('button', { name: 'Save as a copy…', exact: true }).click()
      await expect(conflictDialog.getByRole('heading', { name: 'Save as a copy?' })).toBeVisible()

      // Default location is the source document's folder (`UniWork › Origin Folder`)
      const locationBtn = conflictDialog.getByRole('button', {
        name: `${uniworkFoldersEn.ufLocation}: UniWork › Origin Folder`,
      })
      await expect(locationBtn).toBeVisible()
      await locationBtn.click()

      // Pick `Archive Destination` in the `Choose a location` modal tree picker
      const picker = shell.getByRole('dialog', { name: uniworkFoldersEn.ufChooseLocation })
      await expect(picker).toBeVisible()
      await picker
        .getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
        .getByRole('treeitem', { name: 'Archive Destination' })
        .click()
      await picker.getByRole('button', { name: uniworkFoldersEn.ufChoose, exact: true }).click()
      await expect(picker).toBeHidden()

      // Location button now reflects `UniWork › Archive Destination`
      await expect(
        conflictDialog.getByRole('button', {
          name: `${uniworkFoldersEn.ufLocation}: UniWork › Archive Destination`,
        }),
      ).toBeVisible()

      // Confirm `Create copy`
      await conflictDialog.getByRole('button', { name: 'Create copy', exact: true }).click()
      const copyTitle = 'conflict-folder-copy (my version).docx'
      await expect(conflictDialog.getByRole('alert')).toHaveText(
        syncEn.uwConflictSaveCopyDone.replace('{title}', copyTitle),
      )

      // The stub holds the copy in `Archive Destination` with the local bytes
      const copies = stub.copiesOf(doc.id)
      expect(copies).toHaveLength(1)
      const copy = copies[0]!
      expect(copy).toMatchObject({
        title: copyTitle,
        parentId: destinationFolder.id,
        archived: false,
      })
      expect(copy.state.checksum).toBe(sha256(localBytes))
      expect(await zipEntry(copy.state.bytes, 'word/document.xml')).toContain(MARKER)
      await shell.screenshot({ path: screenshotPath('uniwork-folders-conflict-copy') })

      await conflictDialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(conflictDialog).toBeHidden()
    })
  })

  // f ───────────────────────────────────────────────────────────────────────
  test('f. new document and upload with the Location picker land in the chosen folder in the stub and in folder contents', async () => {
    test.setTimeout(180_000)
    stub.addFolder({ title: 'Start Folder' })
    const chosenFolder = stub.addFolder({ title: 'Chosen Target' })
    const fixtureBytes = await docxBytes()
    const uploadFixturePath = join(userDataDir, 'uploaded-handbook.docx')
    await writeFile(uploadFixturePath, fixtureBytes)

    await withApp('uniwork-folders-new-upload', async ({ launched, shell }) => {
      // 1. Open `Start Folder`, then create a New document into `Chosen Target` via Location picker
      const dialog = await openUniworkFolderBrowser(shell)
      const tree = dialog.getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
      const contents = dialog.locator('.dh-home')
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      await contents.locator('.dh-folder-open', { hasText: 'Start Folder' }).click()
      await expect(crumbs.getByText('Start Folder', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      await contents.locator('.dh-btn-create').click()
      const newDialog = shell.getByRole('dialog', { name: uniworkDocsEn.uwDocNew })
      await expect(newDialog).toBeVisible()
      await newDialog
        .getByRole('textbox', { name: uniworkDocsEn.uwDocName })
        .fill('new-in-chosen-folder')

      // Default Location is the open folder (`UniWork › Start Folder`)
      const newLocBtn = newDialog.getByRole('button', {
        name: `${uniworkFoldersEn.ufLocation}: UniWork › Start Folder`,
      })
      await expect(newLocBtn).toBeVisible()
      await newLocBtn.click()

      // Pick `Chosen Target` in the `Choose a location` modal tree picker
      const picker = shell.getByRole('dialog', { name: uniworkFoldersEn.ufChooseLocation })
      await expect(picker).toBeVisible()
      await picker
        .getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
        .getByRole('treeitem', { name: 'Chosen Target' })
        .click()
      await picker.getByRole('button', { name: uniworkFoldersEn.ufChoose, exact: true }).click()
      await expect(picker).toBeHidden()

      await expect(
        newDialog.getByRole('button', {
          name: `${uniworkFoldersEn.ufLocation}: UniWork › Chosen Target`,
        }),
      ).toBeVisible()

      await newDialog.getByRole('button', { name: uniworkDocsEn.uwDocCreate, exact: true }).click()
      await expect(newDialog).toBeHidden({ timeout: 30_000 })
      await expect
        .poll(async () => (await activeStatus(shell))?.title, { timeout: 30_000 })
        .toBe('new-in-chosen-folder.docx')

      // Stub holds `new-in-chosen-folder.docx` with `parentId: chosenFolder.id`
      const createdDoc = stub.documents().find((d) => d.title === 'new-in-chosen-folder.docx')
      expect(createdDoc).toBeDefined()
      expect(createdDoc).toMatchObject({
        title: 'new-in-chosen-folder.docx',
        parentId: chosenFolder.id,
      })

      // Return to Home, reopen the folder browser, and verify `Chosen Target` lists the new document
      await shell.locator('.tab-item.tab-home').click()
      await openUniworkFolderBrowser(shell)
      await contents.locator('.dh-folder-open', { hasText: 'Chosen Target' }).click()
      await expect(crumbs.getByText('Chosen Target', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(
        contents.locator('.dh-doc-open', { hasText: 'new-in-chosen-folder.docx' }),
      ).toBeVisible()
      // 2. Navigate to `Start Folder`, then Upload `uploaded-handbook.docx` into `Chosen Target`
      await tree.getByRole('treeitem', { name: 'Start Folder' }).click()
      await expect(crumbs.getByText('Start Folder', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      await launched.app.evaluate(({ dialog: electronDialog }, filePath) => {
        electronDialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [filePath],
        })) as typeof electronDialog.showOpenDialog
      }, uploadFixturePath)

      await contents.locator('.dh-btn-upload').click()
      const uploadDialog = shell.getByRole('dialog', { name: uniworkDocsEn.uwDocUpload })
      await expect(uploadDialog).toBeVisible()

      await uploadDialog
        .getByRole('button', { name: uniworkDocsEn.uwDocUploadPick, exact: true })
        .click()
      await expect(uploadDialog.locator('.uw-act-file-name')).toHaveText('uploaded-handbook.docx')

      const uploadLocBtn = uploadDialog.getByRole('button', {
        name: `${uniworkFoldersEn.ufLocation}: UniWork › Start Folder`,
      })
      await expect(uploadLocBtn).toBeVisible()
      await uploadLocBtn.click()

      await expect(picker).toBeVisible()
      await picker
        .getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
        .getByRole('treeitem', { name: 'Chosen Target' })
        .click()
      await picker.getByRole('button', { name: uniworkFoldersEn.ufChoose, exact: true }).click()
      await expect(picker).toBeHidden()

      await expect(
        uploadDialog.getByRole('button', {
          name: `${uniworkFoldersEn.ufLocation}: UniWork › Chosen Target`,
        }),
      ).toBeVisible()

      await uploadDialog
        .getByRole('button', { name: uniworkDocsEn.uwDocUpload, exact: true })
        .click()
      await expect(uploadDialog).toBeHidden({ timeout: 30_000 })
      await expect
        .poll(async () => (await activeStatus(shell))?.title, { timeout: 30_000 })
        .toBe('uploaded-handbook.docx')

      // Stub holds `uploaded-handbook.docx` with `parentId: chosenFolder.id` and matching checksum
      const uploadedDoc = stub.documents().find((d) => d.title === 'uploaded-handbook.docx')
      expect(uploadedDoc).toBeDefined()
      expect(uploadedDoc).toMatchObject({
        title: 'uploaded-handbook.docx',
        parentId: chosenFolder.id,
        checksum: sha256(fixtureBytes),
      })

      // Return to Home, reopen the folder browser, and verify `Chosen Target` lists both documents
      await shell.locator('.tab-item.tab-home').click()
      await openUniworkFolderBrowser(shell)
      await contents.locator('.dh-folder-open', { hasText: 'Chosen Target' }).click()
      await expect(crumbs.getByText('Chosen Target', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(
        contents.locator('.dh-doc-open', { hasText: 'new-in-chosen-folder.docx' }),
      ).toBeVisible()
      await expect(
        contents.locator('.dh-doc-open', { hasText: 'uploaded-handbook.docx' }),
      ).toBeVisible()
      await shell.screenshot({ path: screenshotPath('uniwork-folders-new-upload') })
    })
  })

  // g ───────────────────────────────────────────────────────────────────────
  test('g. first save of a new local document defaults to My Folder, binds the tab, and a second save via menu or Ctrl+S uploads + commits once without reopening the dialog', async () => {
    test.setTimeout(180_000)
    const dir = await mkdtemp(join(tmpdir(), 'uniwork-save01-g-'))
    const local = join(dir, 'draft-my-folder.docx')
    await copyFile(join(ROOT, 'fixtures/generated/simple.docx'), local)

    await withApp(
      'uniwork-folders-first-save-my-folder',
      async ({ launched, shell }) => {
        const editor = await docsEditor(launched.app)
        expect(await activeStatus(shell)).toBeNull()
        expect(await statusOf(shell, local)).toBeNull()
        await expect(chip(shell)).toHaveCount(0)

        // Wait for signed-in launch reads to settle before recording stub calls
        let settled = stub.callCount()
        await expect
          .poll(
            async () => {
              await new Promise((r) => setTimeout(r, 400))
              const now = stub.callCount()
              const quiet = now === settled
              settled = now
              return quiet
            },
            { timeout: 10_000 },
          )
          .toBe(true)
        const before = stub.callCount()

        // Trigger File > Save to UniWork -> SaveDialog (State 1) opens defaulting to My Folder
        await triggerSaveToUniWork(launched.app)
        const saveDialog = shell.getByRole('dialog', { name: uniworkSaveEn.usDialogTitle })
        await expect(saveDialog).toBeVisible()
        await expect(saveDialog.locator('.uws-loc-value')).toHaveText(
          uniworkSaveEn.usSavingIn.replace('{folder}', uniworkSaveEn.usMyFolder),
        )

        const nameInput = saveDialog.getByRole('textbox', { name: uniworkSaveEn.usName })
        await expect(nameInput).toBeFocused()
        await nameInput.fill('first-saved-to-my-folder')
        await saveDialog.getByRole('button', { name: uniworkSaveEn.usSave, exact: true }).click()
        await expect(saveDialog).toBeHidden({ timeout: 30_000 })
        await expectState(shell, 'ready')

        const callsMade = stub
          .calls()
          .slice(before)
          .map((c) => `${c.method} ${c.route}`)
        console.log('case g stub calls:', callsMade)

        const myFolder = stub.ensureMyFolder()
        const createdDocs = stub
          .documents()
          .filter((d) => d.title === 'first-saved-to-my-folder.docx')
        expect(createdDocs).toHaveLength(1)
        const created = createdDocs[0]!
        expect(created.parentId).toBe(myFolder.id)

        // Tab is now bound to the created UniWork document; the original local path stays unbound
        await expect
          .poll(() => activeStatus(shell))
          .toMatchObject({
            documentId: created.id,
            title: 'first-saved-to-my-folder.docx',
            access: 'edit',
            state: 'ready',
          })
        await expect(chip(shell)).toBeVisible()
        expect(await statusOf(shell, local)).toBeNull()
        expect(existsSync(join(dir, 'binding.json'))).toBe(false)

        // Second save via application menu: ONE upload + ONE commit, NO SaveDialog, no second create
        await typeInDocs(editor, `${MARKER}_MENU`)
        const uploadsBeforeMenu = stub.uploads(created.id).length
        const commitsBeforeMenu = stub.commits(created.id).length
        await triggerSaveToUniWork(launched.app)
        await expect(saveDialog).toBeHidden()
        await expect
          .poll(() => stub.commits(created.id).length, { timeout: 30_000 })
          .toBe(commitsBeforeMenu + 1)
        expect(stub.uploads(created.id)).toHaveLength(uploadsBeforeMenu + 1)
        await expectState(shell, 'saved')
        expect(
          stub.documents().filter((d) => d.title === 'first-saved-to-my-folder.docx'),
        ).toHaveLength(1)

        // Third save via real Ctrl+S: ONE upload + ONE commit, NO SaveDialog, no second create
        await typeInDocs(editor, `${MARKER}_CTRL_S`)
        const uploadsBeforeCtrlS = stub.uploads(created.id).length
        const commitsBeforeCtrlS = stub.commits(created.id).length
        await saveShortcut(editor)
        await expect(saveDialog).toBeHidden()
        await expect
          .poll(() => stub.commits(created.id).length, { timeout: 30_000 })
          .toBe(commitsBeforeCtrlS + 1)
        expect(stub.uploads(created.id)).toHaveLength(uploadsBeforeCtrlS + 1)
        await expectState(shell, 'saved')
        expect(
          stub.documents().filter((d) => d.title === 'first-saved-to-my-folder.docx'),
        ).toHaveLength(1)

        const latestXml = await zipEntry(stub.state(created.id).bytes, 'word/document.xml')
        expect(latestXml).toContain(`${MARKER}_MENU`)
        expect(latestXml).toContain(`${MARKER}_CTRL_S`)
        await shell.screenshot({ path: screenshotPath('uniwork-folders-first-save-my-folder') })
      },
      { openFile: local },
    )
  })

  // h ───────────────────────────────────────────────────────────────────────
  test('h. first save with Change folder lands in the picked folder, and Esc or Close before Save sends zero create requests', async () => {
    test.setTimeout(180_000)
    const pickedFolder = stub.addFolder({ title: 'Picked Save Folder' })
    const dir = await mkdtemp(join(tmpdir(), 'uniwork-save01-h-'))
    const local = join(dir, 'draft-picked-folder.docx')
    await copyFile(join(ROOT, 'fixtures/generated/simple.docx'), local)

    await withApp(
      'uniwork-folders-first-save-picked-folder',
      async ({ launched, shell }) => {
        const editor = await docsEditor(launched.app)
        expect(editor).toBeTruthy()
        expect(await activeStatus(shell)).toBeNull()

        let settled = stub.callCount()
        await expect
          .poll(
            async () => {
              await new Promise((r) => setTimeout(r, 400))
              const now = stub.callCount()
              const quiet = now === settled
              settled = now
              return quiet
            },
            { timeout: 10_000 },
          )
          .toBe(true)
        const before = stub.callCount()
        const docsBefore = stub.documents().length
        const createCallsSince = (start: number) =>
          stub
            .calls()
            .slice(start)
            .filter(
              (c) =>
                c.method === 'POST' &&
                /^\/workspaces\/[^/]+\/documents\/files(\/blank)?$/.test(c.route),
            )

        const saveDialog = shell.getByRole('dialog', { name: uniworkSaveEn.usDialogTitle })

        // 1. Escape before clicking Save sends zero create requests
        await triggerSaveToUniWork(launched.app)
        await expect(saveDialog).toBeVisible()
        await shell.keyboard.press('Escape')
        await expect(saveDialog).toBeHidden()
        expect(createCallsSince(before)).toHaveLength(0)
        expect(stub.documents()).toHaveLength(docsBefore)

        // 2. Close button before clicking Save sends zero create requests
        await triggerSaveToUniWork(launched.app)
        await expect(saveDialog).toBeVisible()
        await saveDialog.getByRole('button', { name: uniworkSaveEn.usClose, exact: true }).click()
        await expect(saveDialog).toBeHidden()
        expect(createCallsSince(before)).toHaveLength(0)
        expect(stub.documents()).toHaveLength(docsBefore)

        // 3. Reopen SaveDialog -> click Change -> pick `Picked Save Folder` -> Choose -> Save
        await triggerSaveToUniWork(launched.app)
        await expect(saveDialog).toBeVisible()
        await saveDialog.locator('.uws-loc').click()

        const pickDialog = shell.getByRole('dialog', { name: uniworkSaveEn.usPickTitle })
        await expect(pickDialog).toBeVisible()
        const tree = pickDialog.getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
        await tree.getByRole('treeitem', { name: 'Picked Save Folder' }).click()
        await pickDialog
          .getByRole('button', {
            name: uniworkSaveEn.usChooseFolder.replace('{folder}', 'Picked Save Folder'),
            exact: true,
          })
          .click()

        await expect(saveDialog).toBeVisible()
        await expect(saveDialog.locator('.uws-loc-value')).toHaveText(
          uniworkSaveEn.usSavingIn.replace('{folder}', 'Picked Save Folder'),
        )
        expect(createCallsSince(before)).toHaveLength(0)

        await saveDialog
          .getByRole('textbox', { name: uniworkSaveEn.usName })
          .fill('saved-into-picked-folder')
        await saveDialog.getByRole('button', { name: uniworkSaveEn.usSave, exact: true }).click()
        await expect(saveDialog).toBeHidden({ timeout: 30_000 })
        await expectState(shell, 'ready')

        const callsMade = stub
          .calls()
          .slice(before)
          .map((c) => `${c.method} ${c.route}`)
        console.log('case h stub calls:', callsMade)

        const createdDocs = stub
          .documents()
          .filter((d) => d.title === 'saved-into-picked-folder.docx')
        expect(createdDocs).toHaveLength(1)
        const created = createdDocs[0]!
        expect(created).toMatchObject({
          title: 'saved-into-picked-folder.docx',
          parentId: pickedFolder.id,
        })
        expect(created.parentId).not.toBe(stub.ensureMyFolder().id)
        await shell.screenshot({ path: screenshotPath('uniwork-folders-first-save-picked-folder') })
      },
      { openFile: local },
    )
  })

  // i ───────────────────────────────────────────────────────────────────────
  test('i. My Folder in the tree and browser shows the localized label instead of the stored raw title, is listed first, and offers no rename, move, archive, or share actions', async () => {
    test.setTimeout(150_000)
    const myFolder = stub.ensureMyFolder()
    expect(myFolder.title).toBe('my-folder-raw')
    expect(myFolder.systemKind).toBe('my_folder')
    stub.addFolder({ title: 'Alpha Folder' })

    await withApp('uniwork-folders-my-folder-ui', async ({ shell }) => {
      const before = stub.callCount()
      const dialog = await openUniworkFolderBrowser(shell)
      const tree = dialog.getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
      const contents = dialog.locator('.dh-home')

      await expect(tree.getByRole('treeitem', { name: uniworkSaveEn.usMyFolder })).toBeVisible()
      await expect(
        contents.locator('.dh-folder-open', { hasText: uniworkSaveEn.usMyFolder }),
      ).toBeVisible()

      const callsMade = stub
        .calls()
        .slice(before)
        .map((c) => `${c.method} ${c.route}`)
      console.log('case i stub calls:', callsMade)

      // Stored title `my-folder-raw` never appears in the tree or browser
      await expect(dialog).not.toContainText('my-folder-raw')

      // Listed first in both the folder tree and the root contents list (before `Alpha Folder`)
      const rootTreeChildren = await treeChildrenOf(tree, uniworkFoldersEn.ufRoot)
      expect(rootTreeChildren[0]).toBe(uniworkSaveEn.usMyFolder)
      expect(rootTreeChildren).toContain('Alpha Folder')

      const contentTitles = await contentTitlesOf(contents)
      expect(contentTitles[0]).toBe(uniworkSaveEn.usMyFolder)
      expect(contentTitles).toContain('Alpha Folder')
      // Contents row menu for My Folder offers New subfolder only (no rename/move/archive/share)
      await contents
        .getByRole('button', {
          name: uniworkFoldersEn.ufActionsFor.replace('{name}', uniworkSaveEn.usMyFolder),
          exact: true,
        })
        .click()
      const rowMenu = shell.getByRole('menu')
      await expect(rowMenu).toBeVisible()
      await expect(rowMenu.getByRole('menuitem')).toHaveText([uniworkFoldersEn.ufNewSubfolder])
      await shell.keyboard.press('Escape')
      await expect(rowMenu).toBeHidden()

      // Tree context menu for My Folder offers New subfolder only (no rename/move/archive/share), and F2 does not open inline rename
      const myFolderTreeItem = tree.getByRole('treeitem', { name: uniworkSaveEn.usMyFolder })
      await myFolderTreeItem.click({ button: 'right' })
      const treeContextMenu = shell.getByRole('menu')
      await expect(treeContextMenu).toBeVisible()
      await expect(treeContextMenu.getByRole('menuitem')).toHaveText([
        uniworkFoldersEn.ufNewSubfolder,
      ])
      await shell.keyboard.press('Escape')
      await expect(treeContextMenu).toBeHidden()

      await myFolderTreeItem.press('F2')
      await expect(tree.locator('input')).toHaveCount(0)
      await shell.screenshot({ path: screenshotPath('uniwork-folders-my-folder-ui') })
    })
  })
})
