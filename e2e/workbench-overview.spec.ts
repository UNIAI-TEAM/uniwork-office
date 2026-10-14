import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'
import {
  startUniworkDocumentsStub,
  type UniworkDocumentsStub,
} from './fixtures/uniwork-documents-stub'
import { STUB_HOME_COUNTS } from './fixtures/uniwork-work-stub'
import {
  NO_KEYRING_SKIP,
  accountButton,
  hasOsKeyring,
  shellEnv,
  signIn,
} from './fixtures/uniwork-signin-steps'

/**
 * Workbench smoke against the local UniWork stub: signed in, the Overview
 * shows the five stat tiles from GET /home and a recent UniWork document
 * opens in its editor.
 */

const ROOT = resolve(__dirname, '..')

test.describe.serial('Workbench Overview', () => {
  let stub: UniworkDocumentsStub
  let userDataDir = ''
  let keyring = true

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    stub = await startUniworkDocumentsStub()
    const first = await launchShell({
      onboardingSeen: true,
      videoDir: 'workbench-overview-setup',
      env: shellEnv(stub),
    })
    userDataDir = first.userDataDir
    try {
      keyring = await hasOsKeyring(first)
      if (keyring) await signIn(first, stub)
    } finally {
      await closeAndSaveVideo(first, 'workbench-overview-setup')
    }
  })

  test.afterAll(async () => {
    await stub?.close()
  })

  test.beforeEach(() => {
    test.skip(!keyring, NO_KEYRING_SKIP)
  })

  test('Overview shows the five stat tiles and opens a recent document', async () => {
    test.setTimeout(150_000)
    stub.addDocument({
      filename: 'weekly-plan.docx',
      bytes: await readFile(join(ROOT, 'fixtures/generated/simple.docx')),
    })
    const launched = await launchShell({
      userDataDir,
      onboardingSeen: true,
      videoDir: 'workbench-overview',
      env: shellEnv(stub),
    })
    try {
      const shell = launched.page
      await expect(accountButton(shell)).toHaveAttribute('data-state', 'signed-in', {
        timeout: 45_000,
      })
      await shell.locator('.nav-item', { hasText: 'Workbench' }).click()

      const tiles = shell.locator('.wb-ov-stat')
      await expect(tiles).toHaveCount(5, { timeout: 30_000 })
      const expected = [
        STUB_HOME_COUNTS.open,
        STUB_HOME_COUNTS.overdue,
        STUB_HOME_COUNTS.due_today,
        STUB_HOME_COUNTS.meetings_today,
        STUB_HOME_COUNTS.unread,
      ]
      for (const [i, count] of expected.entries()) {
        await expect(tiles.nth(i)).toContainText(String(count))
      }

      await shell.locator('.wb-ov-recent', { hasText: 'weekly-plan.docx' }).click()
      const editor = await waitForPageWithUrl(launched.app, '://docs/')
      await editor.locator('.doc-page').first().waitFor({ timeout: 30_000 })
    } finally {
      await closeAndSaveVideo(launched, 'workbench-overview')
    }
  })
})
