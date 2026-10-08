import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { copyFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, screenshotPath } from './helpers'

const FIXTURE = resolve(__dirname, '../fixtures/generated/simple.docx')
const MARKER = 'UNIWORK_DOCX_SMOKE'

interface AidocsWindow {
  __aidocs?: {
    editor?: {
      commands: { setTextSelection: (pos: number) => void }
      state: { doc: { content: { size: number }; textContent: string } }
    }
  }
}

function documentXml(path: string): string {
  return execSync(`unzip -p "${path}" word/document.xml`).toString()
}

test.describe('docs: edit and save an external document', () => {
  test('typed text round-trips through save and reopen', async () => {
    test.setTimeout(120_000)
    const scratch = await mkdtemp(join(tmpdir(), 'uniwork-docs-e2e-'))
    const docPath = join(scratch, 'edit-save.docx')
    await copyFile(FIXTURE, docPath)

    const first = await launchShell({
      onboardingSeen: true,
      videoDir: 'docs-edit-save',
      openFile: docPath,
    })
    try {
      const editor = await waitForPageWithUrl(first.app, '://docs/')
      await editor.waitForFunction(
        () => Boolean((window as unknown as AidocsWindow).__aidocs?.editor),
        undefined,
        { timeout: 30_000 },
      )
      await editor.locator('.doc-page').first().waitFor({ timeout: 30_000 })
      await editor.locator('.doc-page').first().click()
      await editor.evaluate(() => {
        const ed = (window as unknown as AidocsWindow).__aidocs!.editor!
        ed.commands.setTextSelection(ed.state.doc.content.size - 1)
      })
      await editor.keyboard.type(` ${MARKER}`, { delay: 20 })

      await first.app.evaluate(({ webContents }) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('://docs/'))
        wc?.send('menu:command', 'save')
      })
      await expect(() => {
        expect(documentXml(docPath)).toContain(MARKER)
      }).toPass({ timeout: 20_000 })
      await editor.screenshot({ path: screenshotPath('docs-edited') })
    } finally {
      await closeAndSaveVideo(first, 'docs-edit-save')
    }

    const second = await launchShell({
      onboardingSeen: true,
      videoDir: 'docs-reopen',
      openFile: docPath,
    })
    try {
      const editor = await waitForPageWithUrl(second.app, '://docs/')
      await editor.waitForFunction(
        () => Boolean((window as unknown as AidocsWindow).__aidocs?.editor),
        undefined,
        { timeout: 30_000 },
      )
      await expect
        .poll(async () =>
          editor.evaluate(
            () => (window as unknown as AidocsWindow).__aidocs?.editor?.state.doc.textContent ?? '',
          ),
        )
        .toContain(MARKER)
      await editor.screenshot({ path: screenshotPath('docs-reopened') })
    } finally {
      await closeAndSaveVideo(second, 'docs-reopen')
    }
  })
})
