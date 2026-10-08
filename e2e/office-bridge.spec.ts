import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createOfficeBridgeStore, listenOfficeBridgeAdapter } from '../packages/office-bridge-adapter/src/index'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

const DOCX = resolve(__dirname, '../fixtures/generated/simple.docx')

test.describe('office bridge: UniWork open and save', () => {
  test('DOCX opens from a launch token and saves a new version', async () => {
    test.setTimeout(120_000)
    const store = createOfficeBridgeStore()
    const alice = store.addUser('alice')
    store.addMembership({ userId: alice.id, tenantId: 'ten-a', workspaceId: 'ws-a' })
    const wp = store.addWorkProduct({
      tenantId: 'ten-a',
      workspaceId: 'ws-a',
      title: 'ACME Proposal',
      fileName: 'proposal.docx',
      bytes: new Uint8Array(readFileSync(DOCX)),
    })
    const { server, origin } = await listenOfficeBridgeAdapter(store)
    try {
      const created = store.createSession(`Bearer ${alice.token}`, wp.id)
      const launched = await launchShell({
        onboardingSeen: true,
        videoDir: 'office-bridge-docx',
        openUrl: created.launchUrl,
        env: { UNIWORK_API_ORIGIN: origin, UNIWORK_BRIDGE_SILENT: '1' },
      })
      try {
        const editor = await waitForPageWithUrl(launched.app, '://docs/')
        await editor.waitForFunction(
          () => Boolean((window as unknown as { __aidocs?: { editor?: unknown } }).__aidocs?.editor),
          undefined,
          { timeout: 30_000 },
        )
        await editor.locator('.doc-page').first().waitFor({ timeout: 30_000 })
        await editor.locator('.doc-page').first().click()
        await editor.keyboard.type(' UNIWORK_BRIDGE', { delay: 20 })
        await launched.app.evaluate(({ webContents }) => {
          const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('://docs/'))
          wc?.send('menu:command', 'save')
        })
        await editor.waitForTimeout(800)
        const saved = await launched.app.evaluate(() =>
          (
            globalThis as { __uniworkSaveToOffice?: () => Promise<boolean> }
          ).__uniworkSaveToOffice?.(),
        )
        expect(saved).toBe(true)
        expect(store.listVersions(wp.id)).toHaveLength(2)
      } finally {
        await closeAndSaveVideo(launched, 'office-bridge-docx')
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }
  })
})
