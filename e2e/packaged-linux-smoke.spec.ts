import { test, expect } from '@playwright/test'
import { launchShell, waitForPageWithUrl } from './helpers'

/**
 * Smoke test of an INSTALLED Linux package (deb): the app starts with its
 * sandbox as a user would launch it, and each of the six editors opens a new
 * document from the Home screen. Runs only when UNIWORK_PACKAGED_APP names the
 * installed executable (e.g. /opt/UniWork Office/uniwork-office); see
 * tools/release/linux-install-check.sh.
 */
const packagedApp = process.env.UNIWORK_PACKAGED_APP

/** The Home screen's new-document cards, in the order the shell lists them. */
const APPS = [
  { name: 'docs', card: 0, url: '://docs/', host: '.editor-scroll' },
  { name: 'sheets', card: 1, url: '://sheets/', host: '#univer-container' },
  { name: 'slides', card: 2, url: '://slides/', host: '.stage-wrap' },
  { name: 'markdown', card: 3, url: '://markdown/', host: '.editor-scroll' },
  { name: 'html', card: 4, url: '://html/', host: '.preview-stage' },
  { name: 'pdf', card: 5, url: '://pdf/', host: '.pdf-scroll' },
] as const

test.describe('installed Linux package', () => {
  test.skip(!packagedApp, 'UNIWORK_PACKAGED_APP is not set')

  for (const { name, card, url, host } of APPS) {
    test(`${name} opens a new document`, async () => {
      test.setTimeout(180_000)
      const launched = await launchShell({
        onboardingSeen: true,
        videoDir: `packaged-${name}`,
        packagedApp,
      })
      try {
        await launched.page.locator('.quick-card').nth(card).click()
        const page = await waitForPageWithUrl(launched.app, url, 60_000)
        await expect(page.locator(host).first()).toBeVisible({ timeout: 60_000 })
      } finally {
        await launched.app.close()
      }
    })
  }
})
