import { test, expect, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { closeAndSaveVideo, handoffUrlToRunningApp, launchShell, type LaunchedApp } from './helpers'
import {
  STUB_ACCOUNT,
  STUB_ORG,
  STUB_PLAN,
  startUniworkAuthStub,
  type UniworkAuthStub,
} from './fixtures/uniwork-auth-stub'

/**
 * UniWork account sign-in against a local replay of the desktop-auth
 * contract. The browser leg is replaced by the test (the shell is told not to
 * open one); the callback travels the real way, as a second process handing a
 * `uniwork-office-dev://` URL to the running instance.
 */

const accountButton = (page: Page) => page.locator('.account-btn')

function shellEnv(stub: UniworkAuthStub): Record<string, string> {
  return {
    UNIWORK_API_ORIGIN: stub.origin,
    UNIWORK_OFFICE_CHANNEL: 'dev',
    UNIWORK_AUTH_E2E_NO_BROWSER: '1',
  }
}

/** Windows/Linux: second instance with the URL in argv. macOS: the open-url event. */
async function deliverCallback(
  launched: LaunchedApp,
  env: Record<string, string>,
  url: string,
): Promise<void> {
  if (process.platform === 'darwin') {
    await launched.app.evaluate(({ app }, callbackUrl) => {
      app.emit('open-url', { preventDefault() {} }, callbackUrl)
    }, url)
    return
  }
  await handoffUrlToRunningApp(launched.userDataDir, url, env)
}

/**
 * Chromium creates the safeStorage (os_crypt) key at startup but commits it to
 * `Local State` only ~10 s later. A second instance started before that (the
 * callback handoff shares this userData) finds no key on disk, makes its own
 * and writes it when it quits. The running app keeps encrypting with its own
 * key and only rewrites `Local State` on its next commit or a graceful quit;
 * if a slow close ends in the SIGKILL fallback first, the next launch cannot
 * decrypt the credential (seen as keyring-unavailable, flaky under load).
 * Waiting for the first commit puts the app's key on disk before any second
 * process starts, so every later write carries the same key.
 */
async function waitForSafeStorageKeyOnDisk(launched: LaunchedApp): Promise<void> {
  await expect
    .poll(() => existsSync(join(launched.userDataDir, 'Local State')), { timeout: 30_000 })
    .toBe(true)
}

async function signIn(launched: LaunchedApp, stub: UniworkAuthStub): Promise<void> {
  const { page } = launched
  await expect(accountButton(page)).toHaveAttribute('data-state', 'signed-out')
  await accountButton(page).click()
  await expect(accountButton(page)).toHaveAttribute('data-state', 'signing-in')
  await expect.poll(() => stub.lastAttempt()?.state ?? '').not.toBe('')
  if (process.platform !== 'darwin') await waitForSafeStorageKeyOnDisk(launched)
  const url = stub.approve()
  await deliverCallback(launched, shellEnv(stub), url)
  await expect(accountButton(page)).toHaveAttribute('data-state', 'signed-in', { timeout: 30_000 })
}

async function visibleSecrets(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify({
      text: document.body.innerText,
      html: document.documentElement.outerHTML,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    }),
  )
}

/** top-level userData files (settings, credential store); Chromium cache dirs are skipped */
async function userDataTopLevelText(dir: string): Promise<string> {
  const parts: string[] = []
  for (const name of await readdir(dir)) {
    const file = join(dir, name)
    const info = await stat(file)
    if (!info.isFile() || info.size > 2_000_000) continue
    parts.push((await readFile(file)).toString('latin1'))
  }
  return parts.join('\n')
}

test.describe('UniWork account sign-in', () => {
  test('signs in through the callback handoff, shows the profile, signs out', async () => {
    test.setTimeout(90_000)
    const stub = await startUniworkAuthStub()
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'uniwork-signin',
      env: shellEnv(stub),
    })
    try {
      await signIn(launched, stub)
      const { page } = launched

      // the attempt used the dev channel's registered redirect and a fresh S256 challenge
      expect(stub.lastAttempt()?.redeemed).toBe(true)

      // profile: sidebar sub-line, then the Account pane in Settings
      await expect(accountButton(page)).toContainText(STUB_ACCOUNT.displayName)
      await expect(accountButton(page)).toContainText(STUB_ORG.name)
      await accountButton(page).click()
      const pane = page.locator('.acct-pane')
      await expect(pane).toHaveAttribute('data-state', 'signed-in')
      await expect(pane).toContainText(STUB_ACCOUNT.displayName)
      await expect(pane).toContainText(STUB_ACCOUNT.email)
      await expect(pane).toContainText(STUB_ORG.name)
      await expect(pane).toContainText(STUB_PLAN.name)

      // no credential string reaches the renderer or the plain-text settings files
      const secrets = stub.issuedSecrets()
      expect(secrets.length).toBeGreaterThan(2)
      const rendered = await visibleSecrets(page)
      const files = await userDataTopLevelText(launched.userDataDir)
      for (const secret of secrets) {
        expect(rendered, 'renderer DOM/storage').not.toContain(secret)
        expect(files, 'userData files').not.toContain(secret)
      }

      // sign out: one device-scope logout, then back to signed-out
      await pane.getByRole('button', { name: 'Sign out' }).click()
      await expect(accountButton(page)).toHaveAttribute('data-state', 'signed-out')
      await expect(pane).toHaveAttribute('data-state', 'signed-out')
      // the device revoke goes out after the local sign-out (it never blocks it)
      await expect.poll(() => stub.logoutCalls()).toBe(1)
    } finally {
      await closeAndSaveVideo(launched, 'uniwork-signin')
      await stub.close()
    }
  })

  test('a revoked device session at restart shows the session-revoked state', async () => {
    test.setTimeout(90_000)
    const stub = await startUniworkAuthStub()
    const first = await launchShell({
      onboardingSeen: true,
      videoDir: 'uniwork-signin-revoked-a',
      env: shellEnv(stub),
    })
    const { userDataDir } = first
    try {
      await signIn(first, stub)
    } finally {
      await closeAndSaveVideo(first, 'uniwork-signin-revoked-a')
    }

    // the encrypted credential survived the first run
    expect(existsSync(join(userDataDir, 'uniwork-auth', 'session.bin'))).toBe(true)
    stub.setRefreshBehavior('device_revoked')
    const second = await launchShell({
      userDataDir,
      videoDir: 'uniwork-signin-revoked-b',
      env: shellEnv(stub),
    })
    try {
      const { page } = second
      await expect(accountButton(page)).toHaveAttribute('data-state', 'session-revoked', {
        timeout: 30_000,
      })
      expect(stub.refreshCalls()).toBeGreaterThanOrEqual(1)
      await expect(accountButton(page)).toContainText('Sign in again')
      await expect(accountButton(page)).toContainText('Session ended')
      // credentials were cleared: the account no longer shows a profile
      await expect(accountButton(page)).not.toContainText(STUB_ACCOUNT.displayName)
    } finally {
      await closeAndSaveVideo(second, 'uniwork-signin-revoked-b')
      await stub.close()
    }
  })
})
