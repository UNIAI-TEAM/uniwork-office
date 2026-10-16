import { test, expect, type Locator, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { en as syncEn } from '../apps/shell/src/renderer/src/i18n/sync/en'
import { en as uniworkFoldersEn } from '../apps/shell/src/renderer/src/i18n/uniwork-folders/en'
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
 * FD-11 UniWork folders end to end: folder creation, live tree/contents refresh
 * on web-side moves and archives via the change feed, 3-level breadcrumb
 * navigation, title search with ancestor paths and kind filtering, and conflict
 * Save-as-a-copy into a chosen folder.
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

const triggerFeedTick = (shell: Page): Promise<void> =>
  shell.evaluate(() => (window as unknown as ShellWindowApis).uniworkSyncCenter.syncNow())

const chip = (shell: Page) => shell.locator('.uw-pill:not(.uw-notice)')

/**
 * Opens the "Open from UniWork" dialog and selects the workspace root (`UniWork`)
 * in the folder tree so the browser switches from the initial Recent list to the
 * folder contents view.
 */
async function openUniworkFolderBrowser(shell: Page) {
  await shell.locator('.uw-open-card').click()
  const dialog = shell.getByRole('dialog', { name: 'Open from UniWork' })
  await expect(dialog).toBeVisible()
  const tree = dialog.getByRole('tree', { name: uniworkFoldersEn.ufTreeLabel })
  await expect(tree).toBeVisible()
  await tree.getByRole('treeitem', { name: uniworkFoldersEn.ufRoot }).click()
  await expect(
    dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb }),
  ).toBeVisible()
  return dialog
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

  async function withApp(name: string, run: (ctx: AppContext) => Promise<void>): Promise<void> {
    const launched = await launchShell({
      userDataDir,
      onboardingSeen: true,
      videoDir: name,
      env: shellEnv(stub),
    })
    try {
      const shell = launched.page
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
      const contents = dialog.getByRole('listbox', { name: uniworkFoldersEn.ufContentsLabel })
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      // Navigate into `Projects`
      await contents.getByRole('option', { name: /^Projects/ }).dblclick()
      await expect(crumbs.getByText('Projects', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      // Create subfolder `Q4 Specs` inside `Projects`
      await dialog.getByRole('button', { name: uniworkFoldersEn.ufNewFolder, exact: true }).click()
      const nameDialog = shell.getByRole('dialog', { name: uniworkFoldersEn.ufNewFolder })
      await expect(nameDialog).toBeVisible()
      const nameInput = nameDialog.getByRole('textbox', { name: uniworkFoldersEn.ufFolderName })
      await expect(nameInput).toBeFocused()
      await nameInput.fill('Q4 Specs')
      await nameDialog.getByRole('button', { name: uniworkFoldersEn.ufCreate, exact: true }).click()
      await expect(nameDialog).toBeHidden()

      // The new folder is visible in both the contents list and the folder tree
      await expect(contents.getByRole('option', { name: /^Q4 Specs/ })).toBeVisible()
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
      const contents = dialog.getByRole('listbox', { name: uniworkFoldersEn.ufContentsLabel })
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      // Open `Source Hub` and verify both the subfolder and document are listed
      await contents.getByRole('option', { name: /^Source Hub/ }).dblclick()
      await expect(crumbs.getByText('Source Hub', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(contents.getByRole('option', { name: /^Moving Subfolder/ })).toBeVisible()
      await expect(contents.getByRole('option', { name: /^Vanishing Leaf/ })).toBeVisible()
      await expect(contents.getByRole('option', { name: /^moving-roadmap\.docx/ })).toBeVisible()

      // Move both `Moving Subfolder` and `moving-roadmap.docx` into `Target Hub` on the web
      stub.webMove(movingSub.id, target.id)
      stub.webMove(movingDoc.id, target.id)
      await triggerFeedTick(shell)

      // Without closing or reloading the dialog, `Source Hub` contents drop the moved items.
      // `Vanishing Leaf` stays: the list must have refreshed to exactly it, so a loading,
      // empty or error list cannot satisfy the `toBeHidden` checks.
      await expect(contents.getByRole('option')).toHaveText([/^Vanishing Leaf/], {
        timeout: 15_000,
      })
      await expect(contents.getByRole('option', { name: /^Vanishing Leaf/ })).toBeVisible()
      await expect(contents.getByRole('option', { name: /^Moving Subfolder/ })).toBeHidden()
      await expect(contents.getByRole('option', { name: /^moving-roadmap\.docx/ })).toBeHidden()

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
      await expect(contents.getByRole('option', { name: /^Moving Subfolder/ })).toBeVisible()
      await expect(contents.getByRole('option', { name: /^moving-roadmap\.docx/ })).toBeVisible()

      // Navigate into `Source Hub` › `Vanishing Leaf`, then archive `Vanishing Leaf` on the web
      await tree.getByRole('treeitem', { name: 'Source Hub' }).click()
      await contents.getByRole('option', { name: /^Vanishing Leaf/ }).dblclick()
      await expect(crumbs.getByText('Vanishing Leaf', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      stub.webArchive(vanishingLeaf.id)
      await triggerFeedTick(shell)

      // The open folder falls back to its nearest live ancestor (`Source Hub`) with the status notice
      await expect(crumbs.getByText('Source Hub', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
        { timeout: 15_000 },
      )
      await expect(
        dialog.getByRole('status').filter({ hasText: uniworkFoldersEn.ufFolderGone }),
      ).toBeVisible()
      await shell.screenshot({ path: screenshotPath('uniwork-folders-feed-fallback') })
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
      const contents = dialog.getByRole('listbox', { name: uniworkFoldersEn.ufContentsLabel })
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      // Level 1: Platform
      await contents.getByRole('option', { name: /^Platform/ }).dblclick()
      await expect(crumbs.getByText('Platform', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      // Level 2: Storage
      await contents.getByRole('option', { name: /^Storage/ }).dblclick()
      await expect(crumbs.getByText('Storage', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      // Level 3: RFCs
      await contents.getByRole('option', { name: /^RFCs/ }).dblclick()
      await expect(crumbs.getByText('RFCs', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(contents.getByRole('option', { name: /^rfc-folder-tree\.docx/ })).toBeVisible()

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
      await expect(contents.getByRole('option', { name: /^Storage/ })).toBeVisible()

      // Click `UniWork` in the breadcrumb to return to the workspace root
      await crumbs.getByRole('button', { name: uniworkFoldersEn.ufRoot, exact: true }).click()
      await expect(crumbs.getByText(uniworkFoldersEn.ufRoot, { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(contents.getByRole('option', { name: /^Platform/ })).toBeVisible()
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
      const contents = dialog.getByRole('listbox', { name: uniworkFoldersEn.ufContentsLabel })
      const crumbs = dialog.getByRole('navigation', { name: uniworkFoldersEn.ufBreadcrumb })

      // Open `Finance` before searching so we can verify `Escape` returns to `Finance`
      await contents.getByRole('option', { name: /^Finance/ }).dblclick()
      await expect(crumbs.getByText('Finance', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )

      const searchBox = dialog.getByRole('combobox', { name: 'Search documents' })
      await searchBox.fill('budget')

      const filterGroup = dialog.getByRole('radiogroup', { name: uniworkFoldersEn.ufSearchKind })
      await expect(filterGroup).toBeVisible()

      // A result's path is left-truncated to its direct parent ("… › Parent ›"); the full
      // path is in the row `title` and in the screen-reader text
      const expectPath = async (row: Locator, short: string, full: string) => {
        await expect(row.locator('.uwf-path > [aria-hidden="true"]')).toHaveText(short)
        await expect(row).toHaveAttribute('title', full)
        await expect(row.locator('.uw-sr-only')).toHaveText(
          uniworkFoldersEn.ufPathLabel.replace('{path}', full),
        )
      }
      const root = uniworkFoldersEn.ufRoot

      const forecastRow = contents.getByRole('option', { name: /budget-forecast\.docx/ })
      await expect(forecastRow).toBeVisible()
      await expectPath(forecastRow, '… › FY2026 ›', `${root} › Finance › FY2026`)

      // A deeper path keeps only the direct parent visible
      const deepRow = contents.getByRole('option', { name: /budget-deep-branch\.docx/ })
      await expect(deepRow).toBeVisible()
      await expectPath(deepRow, '… › Branch ›', `${root} › Division › Region › Country › Branch`)

      // Folder result is also shown under `All`
      const folderRow = contents.getByRole('option', { name: /Budget Ledger Folder/ })
      await expect(folderRow).toBeVisible()
      await expectPath(folderRow, '… › FY2026 ›', `${root} › Finance › FY2026`)

      // Filter by `Folders`
      await filterGroup.getByRole('radio', { name: uniworkFoldersEn.ufSearchFolders }).click()
      await expect(folderRow).toBeVisible()
      await expect(forecastRow).toBeHidden()
      await expect(deepRow).toBeHidden()

      // Filter by `Documents`
      await filterGroup.getByRole('radio', { name: uniworkFoldersEn.ufSearchDocs }).click()
      await expect(forecastRow).toBeVisible()
      await expect(deepRow).toBeVisible()
      await expect(folderRow).toBeHidden()
      await shell.screenshot({ path: screenshotPath('uniwork-folders-search-paths') })

      // Pressing Escape in the search box clears search and returns to `Finance`
      await searchBox.press('Escape')
      await expect(filterGroup).toBeHidden()
      await expect(crumbs.getByText('Finance', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(contents.getByRole('option', { name: /^FY2026/ })).toBeVisible()
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
      const contents = openDialog.getByRole('listbox', { name: uniworkFoldersEn.ufContentsLabel })
      await contents.getByRole('option', { name: /^Origin Folder/ }).dblclick()
      await contents.getByRole('option', { name: /^conflict-folder-copy\.docx/ }).dblclick()
      await expect(openDialog).toBeHidden({ timeout: 30_000 })

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
})
