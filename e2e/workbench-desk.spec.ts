import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'
import {
  startUniworkDocumentsStub,
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
 * Workbench smoke against the local UniWork stub: signed in, the first tab is
 * the Desk, its five sections render and a recent UniWork document listed
 * under In progress opens in its editor.
 */

const ROOT = resolve(__dirname, '..')

test.describe.serial('Workbench Desk', () => {
  let stub: UniworkDocumentsStub
  let userDataDir = ''
  let keyring = true

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    stub = await startUniworkDocumentsStub()
    const first = await launchShell({
      onboardingSeen: true,
      videoDir: 'workbench-desk-setup',
      env: shellEnv(stub),
    })
    userDataDir = first.userDataDir
    try {
      keyring = await hasOsKeyring(first)
      if (keyring) await signIn(first, stub)
    } finally {
      await closeAndSaveVideo(first, 'workbench-desk-setup')
    }
  })

  test.afterAll(async () => {
    await stub?.close()
  })

  test.beforeEach(() => {
    test.skip(!keyring, NO_KEYRING_SKIP)
  })

  test('Desk shows its five sections and opens an in-progress document', async () => {
    test.setTimeout(150_000)
    stub.addDocument({
      filename: 'weekly-plan.docx',
      bytes: await readFile(join(ROOT, 'fixtures/generated/simple.docx')),
    })
    const launched = await launchShell({
      userDataDir,
      onboardingSeen: true,
      videoDir: 'workbench-desk',
      env: shellEnv(stub),
    })
    try {
      const shell = launched.page
      await expect(accountButton(shell)).toHaveAttribute('data-state', 'signed-in', {
        timeout: 45_000,
      })
      await shell.locator('.nav-item', { hasText: 'Workbench' }).click()

      await expect(shell.locator('.wb-tab').first()).toContainText('Desk')
      const desk = shell.locator('.wb-desk')
      await expect(desk.getByRole('button', { name: 'PDF → Word' })).toBeVisible({
        timeout: 30_000,
      })
      for (const title of ['Needs you', 'In progress', 'Forms drawer', 'Today']) {
        await expect(desk.getByRole('heading', { name: title, exact: true })).toBeVisible()
      }

      await desk
        .locator('.wb-desk-row-title', { hasText: 'weekly-plan.docx' })
        .click({ timeout: 30_000 })
      const editor = await waitForPageWithUrl(launched.app, '://docs/')
      await editor.locator('.doc-page').first().waitFor({ timeout: 30_000 })
    } finally {
      await closeAndSaveVideo(launched, 'workbench-desk')
    }
  })
})
