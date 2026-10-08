import { test, expect } from '@playwright/test'
import { execFileSync, execSync } from 'node:child_process'
import { copyFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, screenshotPath } from './helpers'

const MARKER = 'UNIWORK_PPTX_SMOKE'
const FIND = 'font manager smoke'

async function buildRubikFixture(): Promise<string> {
  const out = join(await mkdtemp(join(tmpdir(), 'uniwork-slides-e2e-')), 'edit-save.pptx')
  execFileSync('zip', ['-X', '-q', '-r', out, '.'], {
    cwd: resolve(__dirname, 'assets/font-manager-rubik'),
  })
  return out
}

function slideXml(path: string): string {
  return execSync(`unzip -p "${path}" ppt/slides/slide1.xml`).toString()
}

interface SlidesWindow {
  slidesApi: {
    findReplace(op: { find: string; replace: string }): Promise<{ count: number } | null>
    save(): Promise<{ ok: boolean; error?: string }>
  }
}

test.describe('slides: edit and save an external deck', () => {
  test('find/replace round-trips through save and reopen', async () => {
    test.setTimeout(120_000)
    const source = await buildRubikFixture()
    const scratch = await mkdtemp(join(tmpdir(), 'uniwork-slides-save-'))
    const deckPath = join(scratch, 'edit-save.pptx')
    await copyFile(source, deckPath)

    const first = await launchShell({
      onboardingSeen: true,
      videoDir: 'slides-edit-save',
      openFile: deckPath,
    })
    try {
      const editor = await waitForPageWithUrl(first.app, '://slides/')
      await editor.waitForSelector('.stage-wrap canvas', { timeout: 30_000 })

      const replaced = await editor.evaluate(
        async ({ find, replace }) => {
          const api = (window as unknown as SlidesWindow).slidesApi
          return api.findReplace({ find, replace })
        },
        { find: FIND, replace: MARKER },
      )
      expect(replaced?.count).toBeGreaterThan(0)

      await first.app.evaluate(({ webContents }) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('://slides/'))
        wc?.send('slides:menu', 'save')
      })
      await expect(() => {
        expect(slideXml(deckPath)).toContain(MARKER)
        expect(slideXml(deckPath)).not.toContain(FIND)
      }).toPass({ timeout: 20_000 })
      await editor.screenshot({ path: screenshotPath('slides-edited') })
    } finally {
      await closeAndSaveVideo(first, 'slides-edit-save')
    }

    const second = await launchShell({
      onboardingSeen: true,
      videoDir: 'slides-reopen',
      openFile: deckPath,
    })
    try {
      const editor = await waitForPageWithUrl(second.app, '://slides/')
      await editor.waitForSelector('.stage-wrap canvas', { timeout: 30_000 })
      expect(slideXml(deckPath)).toContain(MARKER)
      await editor.screenshot({ path: screenshotPath('slides-reopened') })
    } finally {
      await closeAndSaveVideo(second, 'slides-reopen')
    }
  })
})
