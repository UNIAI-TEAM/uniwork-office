// SIZE-F1 (UNI-1861): Web frame document size gate (warn chip, save-block dialog in vi + en,
// zero api.save calls when blocked, "Tải bản của tôi" -> api.download, and sizeUi:true suppression).
// Run alone: npx playwright test -c web/e2e size-gate
import { test, expect, type Page } from '@playwright/test'
import { built, concat, encode, openModule, serveFixture } from './text-modules'

const FIXTURE_PATH = '/e2e-fixtures/SizeGate.md'
// ~1,650 bytes: above warnBytes (1,536 B = 75% of 2,048 B) and below max_bytes (2,048 B)
const WARN_BODY = `# Size Gate\r\n\r\n${'Paragraph line for size gate warning band check. '.repeat(32)}\r\n\r\nTail paragraph.\r\n`
const FIXTURE = concat(encode(WARN_BODY))

test.skip(!built('markdown'), 'no dist-web/markdown build: npm run build:web -- --module markdown')

const WARN_CHIP = '[data-office-web="size-warning"]'
const BLOCK_DLG = '[data-office-web="save-blocked"] .ow-dlg'

interface GateHostView {
  saveCalls: number
  downloads: Array<{ bytes: number[] }>
  events: Array<{ type: string; payload: unknown }>
}

async function gateHostState(page: Page): Promise<GateHostView> {
  return page.evaluate(() => {
    const h = (
      window as unknown as {
        __host: {
          saveCalls: () => number
          downloads: () => Array<{ bytes: number[] }>
          events: Array<{ type: string; payload: unknown }>
        }
      }
    ).__host
    return {
      saveCalls: h.saveCalls(),
      downloads: h.downloads(),
      events: h.events,
    }
  })
}

test('fallback size gate (vi): warns near limit, blocks over max_bytes without api.save, and downloads copy', async ({
  page,
}) => {
  await serveFixture(page, FIXTURE_PATH, FIXTURE, 'text/markdown')
  const frame = await openModule(page, 'markdown', {
    open: FIXTURE_PATH,
    lang: 'vi',
    download: '1',
    maxBytes: '2048',
    warnRatio: '0.75',
  })

  const editor = frame.locator('.doc-editor')
  await expect(editor).toContainText('Tail paragraph.')

  // 1. Save in the warn band (~1.65 KB >= 1.5 KB warn threshold, <= 2 KB max_bytes)
  await editor.click()
  await page.keyboard.press('Control+s')

  await expect(frame.locator(WARN_CHIP)).toBeVisible()
  await expect(frame.locator(WARN_CHIP)).toContainText('Sắp chạm giới hạn 0 MB (đang 0 MB).')
  await expect.poll(async () => (await gateHostState(page)).saveCalls).toBe(1)
  const afterWarn = await gateHostState(page)
  expect(afterWarn.events.filter((e) => e.type === 'size_warning')).toHaveLength(1)

  // 2. Grow the document past 2,048 bytes and press Ctrl+S -> blocked before api.save
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(` ${'Extra text exceeding the two kilobyte cap. '.repeat(15)}`)
  await page.keyboard.press('Control+s')

  const dlg = frame.locator(BLOCK_DLG)
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('Chưa lưu được lên UniWork')
  await expect(dlg).toContainText(
    'Tài liệu đã vượt 0 MB. Thay đổi của bạn vẫn ở đây. Tải bản của bạn về máy rồi giảm dung lượng ảnh hoặc chia nhỏ tài liệu.',
  )
  await expect(dlg.locator('[data-choice="download"]')).toHaveText('Tải bản của tôi')
  await expect(dlg.locator('[data-choice="close"]')).toHaveText('Đóng')

  // No second api.save call was sent when blocked
  const afterBlock = await gateHostState(page)
  expect(afterBlock.saveCalls).toBe(1)
  expect(afterBlock.events.filter((e) => e.type === 'save_blocked')).toHaveLength(1)

  // 3. Clicking "Tải bản của tôi" sends api.download with the blocked bytes and closes the modal
  await dlg.locator('[data-choice="download"]').click()
  await expect(dlg).toHaveCount(0)
  await expect.poll(async () => (await gateHostState(page)).downloads.length).toBe(1)
  const afterDownload = await gateHostState(page)
  expect(afterDownload.downloads[0]!.bytes.length).toBeGreaterThan(2048)
  expect(afterDownload.saveCalls).toBe(1)
})

test('fallback size gate (en) and sizeUi:true suppression', async ({ page }) => {
  const overBytes = concat(
    encode(`# Over Limit\r\n\r\n${'English over-limit paragraph content. '.repeat(65)}\r\n`),
  )
  await serveFixture(page, FIXTURE_PATH, overBytes, 'text/markdown')

  // 1. English fallback dialog when sizeUi is absent
  const frameEn = await openModule(page, 'markdown', {
    open: FIXTURE_PATH,
    lang: 'en',
    download: '1',
    maxBytes: '2048',
    warnRatio: '0.75',
  })
  const editorEn = frameEn.locator('.doc-editor')
  await expect(editorEn).toContainText('Over Limit')
  await editorEn.click()
  await page.keyboard.press('Control+s')

  const dlgEn = frameEn.locator(BLOCK_DLG)
  await expect(dlgEn).toBeVisible()
  await expect(dlgEn).toContainText('Couldn’t save to UniWork')
  await expect(dlgEn).toContainText(
    'This document is over 0 MB. Your changes are still here. Download your copy to your computer, then reduce image sizes or split the document.',
  )
  await expect(dlgEn.locator('[data-choice="download"]')).toHaveText('Download my copy')
  await expect(dlgEn.locator('[data-choice="close"]')).toHaveText('Close')
  expect((await gateHostState(page)).saveCalls).toBe(0)
  await dlgEn.locator('[data-choice="close"]').click()
  await expect(dlgEn).toHaveCount(0)

  // 2. When the host advertises sizeUi=1, the frame emits save_blocked and blocks api.save without rendering the fallback modal
  const frameHostUi = await openModule(page, 'markdown', {
    open: FIXTURE_PATH,
    lang: 'vi',
    download: '1',
    sizeUi: '1',
    maxBytes: '2048',
    warnRatio: '0.75',
  })
  const editorHostUi = frameHostUi.locator('.doc-editor')
  await expect(editorHostUi).toContainText('Over Limit')
  await editorHostUi.click()
  await page.keyboard.press('Control+s')

  await expect
    .poll(
      async () =>
        (await gateHostState(page)).events.filter((e) => e.type === 'save_blocked').length,
    )
    .toBe(1)
  expect((await gateHostState(page)).saveCalls).toBe(0)
  await expect(frameHostUi.locator(BLOCK_DLG)).toHaveCount(0)
  await expect(frameHostUi.locator(WARN_CHIP)).toHaveCount(0)
})
