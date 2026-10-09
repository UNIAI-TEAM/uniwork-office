import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchShell, closeAndSaveVideo, openHomeFiles, screenshotPath } from './helpers'

test.describe('first-run onboarding', () => {
  test('fresh install walks all slides and persists the seen flag', async () => {
    const launched = await launchShell({ videoDir: 'onboarding-walkthrough' })
    const { page, userDataDir } = launched
    try {
      const overlay = page.locator('.onb-overlay')
      await expect(overlay).toBeVisible()
      await expect(page.locator('.onb-slide.active .onb-title')).toHaveText(
        'Welcome to UniWork Office',
      )
      await page.screenshot({ path: screenshotPath('onboarding-slide-1') })

      await page.locator('.onb-next').click()
      await expect(page.locator('.onb-slide.active .onb-title')).toHaveText('AI at every step')
      await expect(page.locator('.onb-slide.active .onb-offer')).toHaveCount(0)
      await page.screenshot({ path: screenshotPath('onboarding-slide-2') })

      await page.locator('.onb-next').click()
      await expect(page.locator('.onb-slide.active .onb-title')).toHaveText('You’re all set')
      // no repo, star or usage-statistics call to action on the last step
      await expect(page.locator('.onb-card')).not.toContainText(/github|star on|analytics/i)
      await page.screenshot({ path: screenshotPath('onboarding-slide-3') })

      // last slide's primary button finishes the onboarding
      await page.locator('.onb-next').click()
      await expect(overlay).toBeHidden()
      // Home starts on the My AI chat; Recent shows the hero and quick cards
      await expect(page.locator('.nav-item[data-nav="chat"]')).toHaveClass(/active/)
      await openHomeFiles(page)
      await expect(page.locator('.home-hero')).toBeVisible()
      await page.screenshot({ path: screenshotPath('onboarding-done-home') })

      await expect
        .poll(async () => {
          const raw = await readFile(join(userDataDir, 'app-settings.json'), 'utf8')
          return (JSON.parse(raw) as { onboardingSeen?: boolean }).onboardingSeen
        })
        .toBe(true)
    } finally {
      await closeAndSaveVideo(launched, 'onboarding-walkthrough')
    }

    // second launch with the same userData must not show the onboarding again
    const relaunch = await launchShell({
      userDataDir: launched.userDataDir,
      videoDir: 'onboarding-relaunch',
    })
    try {
      await expect(relaunch.page.locator('.nav-item[data-nav="chat"]')).toHaveClass(/active/)
      await expect(relaunch.page.locator('.onb-overlay')).toHaveCount(0)
      await relaunch.page.screenshot({ path: screenshotPath('onboarding-relaunch-no-overlay') })
    } finally {
      await closeAndSaveVideo(relaunch, 'onboarding-relaunch')
    }
  })

  test('skip dismisses the onboarding and persists the seen flag', async () => {
    const launched = await launchShell({ videoDir: 'onboarding-skip' })
    const { page, userDataDir } = launched
    try {
      await expect(page.locator('.onb-overlay')).toBeVisible()
      await page.locator('.onb-skip').click()
      await expect(page.locator('.onb-overlay')).toBeHidden()
      await page.screenshot({ path: screenshotPath('onboarding-skipped-home') })

      await expect
        .poll(async () => {
          const raw = await readFile(join(userDataDir, 'app-settings.json'), 'utf8')
          return (JSON.parse(raw) as { onboardingSeen?: boolean }).onboardingSeen
        })
        .toBe(true)
    } finally {
      await closeAndSaveVideo(launched, 'onboarding-skip')
    }
  })
})
