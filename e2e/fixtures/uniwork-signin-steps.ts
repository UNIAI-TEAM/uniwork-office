/**
 * Sign-in steps shared by the UniWork specs: the stub-pointed environment, the
 * callback handoff, the keyring probe and the full sign-in. The browser leg is
 * replaced by the test; the callback travels the real way, as a second process
 * handing a `uniwork-office-dev://` URL to the running instance.
 */
import { expect, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { handoffUrlToRunningApp, type LaunchedApp } from '../helpers'
import type { UniworkAuthStub } from './uniwork-auth-stub'

export const accountButton = (page: Page) => page.locator('.account-btn')

export function shellEnv(stub: UniworkAuthStub): Record<string, string> {
  return {
    UNIWORK_API_ORIGIN: stub.origin,
    UNIWORK_OFFICE_CHANNEL: 'dev',
    UNIWORK_AUTH_E2E_NO_BROWSER: '1',
  }
}

/** Windows/Linux: second instance with the URL in argv. macOS: the open-url event. */
export async function deliverUrl(
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
 * On Windows (DPAPI), Chromium creates the safeStorage (os_crypt) key at
 * startup and commits it as `encrypted_key` in `Local State` ~10 s later. A
 * second instance started before that (the callback handoff shares this
 * userData) finds no key on disk, makes its own and writes it when it quits.
 * The running app keeps encrypting with its own key and only rewrites
 * `Local State` on its next commit or a graceful quit; if a slow close ends in
 * the SIGKILL fallback first, the next launch cannot decrypt the credential
 * (seen as keyring-unavailable, flaky under load). Waiting for the first
 * commit puts the app's key on disk before any second process starts, so every
 * later write carries the same key.
 *
 * On macOS (Keychain) and on Linux with a Secret Service backend
 * (`gnome_libsecret` / `kwallet` — anything other than `basic_text`), Chromium
 * stores the os_crypt key in the OS keyring rather than writing `encrypted_key`
 * to `Local State`, so this disk wait is skipped there.
 */
export async function waitForSafeStorageKeyOnDisk(launched: LaunchedApp): Promise<void> {
  if (process.platform === 'darwin') return
  if (process.platform === 'linux') {
    const backend = await launched.app.evaluate(({ safeStorage }) =>
      safeStorage.getSelectedStorageBackend(),
    )
    if (backend !== 'basic_text') return
  }
  const localState = join(launched.userDataDir, 'Local State')
  await expect
    .poll(
      async () =>
        existsSync(localState) && (await readFile(localState, 'utf8')).includes('encrypted_key'),
      { timeout: 30_000 },
    )
    .toBe(true)
}

export async function signIn(launched: LaunchedApp, stub: UniworkAuthStub): Promise<void> {
  const { page } = launched
  await expect(accountButton(page)).toHaveAttribute('data-state', 'signed-out')
  await accountButton(page).click()
  await expect(accountButton(page)).toHaveAttribute('data-state', 'signing-in')
  await expect.poll(() => stub.lastAttempt()?.state ?? '').not.toBe('')
  // Only Windows writes `os_crypt.encrypted_key` to `Local State`; Linux with
  // a Secret Service (`gnome-keyring` / `libsecret`) and macOS keep the key in
  // the OS keyring and never write `encrypted_key` to disk.
  if (process.platform === 'win32') await waitForSafeStorageKeyOnDisk(launched)
  const url = stub.approve()
  await deliverUrl(launched, shellEnv(stub), url)
  await expect(accountButton(page)).toHaveAttribute('data-state', 'signed-in', { timeout: 30_000 })
}

export const NO_KEYRING_SKIP = 'no OS keyring on this runner; sign-in flow runs on Windows/macOS'

/**
 * Whether the app can keep a credential encrypted. Linux without a Secret
 * Service (headless CI) selects safeStorage's `basic_text` backend, which the
 * app refuses by contract (no plaintext fallback); Windows and macOS always
 * have an OS store.
 */
export async function hasOsKeyring(launched: LaunchedApp): Promise<boolean> {
  return launched.app.evaluate(({ safeStorage }) => {
    if (!safeStorage.isEncryptionAvailable()) return false
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  })
}
