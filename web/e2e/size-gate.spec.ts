// SIZE-F1 (UNI-1861): Web frame document size gate (warn chip, save-block dialog in vi + en,
// zero api.save calls when blocked, "Tải bản của tôi" -> api.download, and sizeUi:true suppression).
// Run alone: npx playwright test -c web/e2e size-gate
import { test, expect, type Page } from '@playwright/test'
import { built, concat, encode, openModule, serveFixture } from './text-modules'

const FIXTURE_PATH = '/e2e-fixtures/SizeGate.md'
// ~833 KB: above warnBytes (786,432 B = 75% of 1 MiB) and below max_bytes (1,048,576 B).
// The test-host cap is 1 MiB (not a few hundred bytes) so formatSizeMB prints realistic sizes
// ("1 MB", "0,7 MB") — a sub-MiB cap would lock the nonsense "vượt 0 MB" copy in (d1-7).
const WARN_BODY = `# Size Gate\r\n\r\n${'Paragraph line for size gate warning band check. '.repeat(17_000)}\r\n\r\nTail paragraph.\r\n`
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
    maxBytes: '1048576',
    warnRatio: '0.75',
  })

  const editor = frame.locator('.doc-editor')
  await expect(editor).toContainText('Tail paragraph.')

  // 1. Save in the warn band (~833 KB >= 786,432 B warn threshold, <= 1 MiB max_bytes)
  await editor.click()
  await page.keyboard.press('Control+s')

  await expect(frame.locator(WARN_CHIP)).toBeVisible()
  await expect(frame.locator(WARN_CHIP)).toContainText('Sắp chạm giới hạn 1 MB (đang 0,7 MB).')
  await expect.poll(async () => (await gateHostState(page)).saveCalls).toBe(1)
  const afterWarn = await gateHostState(page)
  expect(afterWarn.events.filter((e) => e.type === 'size_warning')).toHaveLength(1)

  // 2. Grow the document past 1 MiB and press Ctrl+S -> blocked before api.save
  //    (insertText, not per-key typing: ~300 KB must land in one input event)
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(` ${'Extra text exceeding the one mebibyte cap. '.repeat(7_000)}`)
  await page.keyboard.press('Control+s')

  const dlg = frame.locator(BLOCK_DLG)
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('Chưa lưu được lên UniWork')
  await expect(dlg).toContainText(
    'Tài liệu đã vượt 1 MB. Thay đổi của bạn vẫn ở đây. Tải bản của bạn về máy rồi giảm dung lượng ảnh hoặc chia nhỏ tài liệu.',
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
  expect(afterDownload.downloads[0]!.bytes.length).toBeGreaterThan(1_048_576)
  expect(afterDownload.saveCalls).toBe(1)
})

test('fallback size gate (en) and sizeUi:true suppression', async ({ page }) => {
  // ~1.09 MiB (1,140,000 B): already over the 1 MiB cap at open, so one Ctrl+S is blocked at once
  const overBytes = concat(
    encode(`# Over Limit\r\n\r\n${'English over-limit paragraph content. '.repeat(30_000)}\r\n`),
  )
  await serveFixture(page, FIXTURE_PATH, overBytes, 'text/markdown')

  // 1. English fallback dialog when sizeUi is absent
  const frameEn = await openModule(page, 'markdown', {
    open: FIXTURE_PATH,
    lang: 'en',
    download: '1',
    maxBytes: '1048576',
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
    'This document is over 1 MB. Your changes are still here. Download your copy to your computer, then reduce image sizes or split the document.',
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
    maxBytes: '1048576',
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
