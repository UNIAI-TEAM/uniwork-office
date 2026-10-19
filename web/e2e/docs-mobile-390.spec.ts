// UNI-1931 (MOBILE-390-DOCS): the Docs frame at phone width in the protocol test host.
//  - SVF-1: the File menu paints and takes presses at 390 (the tab row is a scroller there; the menu
//    must not be clipped by it, also with the row scrolled sideways), editable and view-only;
//    1280 keeps the menu under the File tab
//  - SVF-2: a status message (a failed save) shows as an auto-hiding toast above the status bar at 390
//  - SVF-3: the print dialog keeps a usable preview and a one-line pager at 390
// (the no-document Ctrl+P message is covered by a vitest unit test: the test host always opens a document)
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const docsRoot = resolve(repoRoot, 'dist-web', 'docs')
const built =
  existsSync(docsRoot) &&
  readdirSync(docsRoot).some((v) => existsSync(resolve(docsRoot, v, 'manifest.json')))
test.skip(!built, 'dist-web/docs is not built (npm run build:web)')

const DOC = '/fixtures/simple.docx'
const TEXT = '第一段'

async function openDoc(page: Page, query = ''): Promise<Frame> {
  await page.goto(`/test-host/?open=${encodeURIComponent(DOC)}&lang=en${query}`)
  const ed = (await (await page.waitForSelector('#frame')).contentFrame())!
  await ed
    .locator('.ProseMirror')
    .first()
    .getByText(TEXT, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  return ed
}

/** for every enabled File menu item: is its centre inside the viewport and does the hit land in the menu? */
async function hitTestMenu(ed: Frame) {
  return ed.evaluate(() => {
    const out: Array<{ label: string; inViewport: boolean; hitInMenu: boolean }> = []
    for (const b of document.querySelectorAll<HTMLButtonElement>('.file-menu button')) {
      if (b.disabled) continue
      const r = b.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const hit = document.elementFromPoint(x, y)
      out.push({
        label: (b.textContent ?? '').trim(),
        inViewport: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
        hitInMenu: !!hit?.closest('.file-menu'),
      })
    }
    return out
  })
}

const narrow = { width: 390, height: 844 }

for (const [name, query] of [
  ['editable', ''],
  ['view-only', '&readonly=1'],
] as const) {
  test(`docs-mobile-390: File menu is painted and hit-testable (${name})`, async ({ page }) => {
    await page.setViewportSize(narrow)
    const ed = await openDoc(page, query)
    await ed.locator('.ribbon-tab-file').click()
    await expect(ed.locator('.file-menu')).toBeVisible()
    const items = await hitTestMenu(ed)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item, item.label).toEqual({ label: item.label, inViewport: true, hitInMenu: true })
    }
    // the menu hangs under the tab row and stays inside the phone frame
    const geo = await ed.evaluate(() => {
      const m = document.querySelector('.file-menu')!.getBoundingClientRect()
      const tab = document.querySelector('.ribbon-tab-file')!.getBoundingClientRect()
      return { menuTop: m.top, menuLeft: m.left, menuRight: m.right, tabBottom: tab.bottom }
    })
    expect(geo.menuTop).toBeGreaterThanOrEqual(geo.tabBottom - 1)
    expect(geo.menuLeft).toBeGreaterThanOrEqual(0)
    expect(geo.menuRight).toBeLessThanOrEqual(narrow.width)
    // a press on the Print entry reaches it: the menu closes and the print dialog opens
    await ed.locator('.file-menu button', { hasText: /^Print/ }).click()
    await expect(ed.locator('.file-menu')).toHaveCount(0)
    await expect(ed.locator('.modal.print-dialog')).toBeVisible({ timeout: 30_000 })
  })
}

for (const [name, query] of [
  ['editable', ''],
  ['view-only', '&readonly=1'],
] as const) {
  test(`docs-mobile-390: File menu holds with the tab row scrolled sideways (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(narrow)
    const ed = await openDoc(page, query)
    const scrolled = await ed.evaluate(() => {
      const row = document.querySelector('.ribbon-tabs') as HTMLElement
      row.scrollLeft = 30
      return row.scrollLeft
    })
    expect(scrolled).toBeGreaterThan(0)
    // press the File tab itself (a DOM click: Playwright would scroll the row back first)
    await ed.evaluate(() => (document.querySelector('.ribbon-tab-file') as HTMLElement).click())
    await expect(ed.locator('.file-menu')).toBeVisible()
    const geo = await ed.evaluate(() => {
      const m = document.querySelector('.file-menu')!.getBoundingClientRect()
      const tab = document.querySelector('.ribbon-tab-file')!.getBoundingClientRect()
      return { menuTop: m.top, menuLeft: m.left, tabBottom: tab.bottom, tabLeft: tab.left }
    })
    // painted under the File tab where it now is, and hit-testable
    expect(geo.menuTop).toBeGreaterThanOrEqual(geo.tabBottom - 1)
    expect(Math.abs(geo.menuLeft - geo.tabLeft)).toBeLessThanOrEqual(2)
    const items = await hitTestMenu(ed)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0], items[0]!.label).toEqual({
      label: items[0]!.label,
      inViewport: true,
      hitInMenu: true,
    })

    // scrolling the row afterwards never leaves a menu floating away from its tab
    await ed.evaluate(() => {
      ;(document.querySelector('.ribbon-tabs') as HTMLElement).scrollLeft = 80
    })
    await page.waitForTimeout(200)
    if ((await ed.locator('.file-menu').count()) > 0) {
      const after = await ed.evaluate(() => {
        const m = document.querySelector('.file-menu')!.getBoundingClientRect()
        const tab = document.querySelector('.ribbon-tab-file')!.getBoundingClientRect()
        return { menuLeft: m.left, tabLeft: tab.left }
      })
      expect(Math.abs(after.menuLeft - after.tabLeft)).toBeLessThanOrEqual(2)
    }
    // scrolled back, the File tab opens the menu again
    await ed.evaluate(() => {
      ;(document.querySelector('.ribbon-tabs') as HTMLElement).scrollLeft = 0
    })
    await ed.locator('.ribbon-tab-file').click()
    await expect(ed.locator('.file-menu')).toBeVisible()
    for (const item of await hitTestMenu(ed)) expect(item.hitInMenu, item.label).toBe(true)
  })
}

test('docs-mobile-390: a status message shows as a toast above the status bar', async ({
  page,
}) => {
  await page.setViewportSize(narrow)
  const ed = await openDoc(page)
  const editor = ed.locator('.ProseMirror').first()
  await editor.getByText(TEXT, { exact: false }).first().click()
  const pageBefore = await ed.locator('.status-page').boundingBox()
  await page.evaluate(() => (window as any).__host.failNextSave())
  await page.keyboard.press('Control+s')
  await expect
    .poll(() => page.evaluate(() => (window as any).__host.saveCalls()), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1)
  // the bar keeps its row (no message squeezed in), the message is raised as a toast
  await expect(ed.locator('.status-bar .status-msg')).toBeHidden()
  const toast = ed.locator('.app-toast.show')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(/save failed/i)
  const box = await toast.boundingBox()
  const geo = await ed.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    barTop: document.querySelector('.status-bar')!.getBoundingClientRect().top,
  }))
  expect(box!.width).toBeGreaterThan(0)
  expect(box!.height).toBeGreaterThan(0)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(geo.w + 1)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  // just above the status bar (not the default top-centre pill), not over the page counter
  expect(box!.y + box!.height).toBeLessThanOrEqual(geo.barTop + 1)
  expect(geo.barTop - (box!.y + box!.height)).toBeLessThanOrEqual(60)
  const pageAfter = await ed.locator('.status-page').boundingBox()
  expect(pageAfter).toEqual(pageBefore)
  // it goes away by itself
  await expect(ed.locator('.app-toast')).toHaveCount(0, { timeout: 10_000 })
})

test('docs-mobile-390: print dialog keeps a usable preview and a one-line pager', async ({
  page,
}) => {
  await page.setViewportSize(narrow)
  const ed = await openDoc(page)
  await ed.locator('.ribbon-tab-file').click()
  await ed.locator('.file-menu button', { hasText: /^Print/ }).click()
  await expect(ed.locator('.print-preview-nav')).toBeVisible({ timeout: 30_000 })
  const geo = await ed.evaluate(() => {
    const pane = document.querySelector('.print-preview-pane')!.getBoundingClientRect()
    const dlg = document.querySelector('.modal.print-dialog')!.getBoundingClientRect()
    const opts = document.querySelector('.print-options')!.getBoundingClientRect()
    const pager = document.querySelector('.print-preview-nav span')!
    const range = document.createRange()
    range.selectNodeContents(pager)
    const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
    return {
      paneW: pane.width,
      paneH: pane.height,
      optsW: opts.width,
      dlgLeft: dlg.left,
      dlgRight: dlg.right,
      pagerText: (pager.textContent ?? '').replace(/\s+/g, ' ').trim(),
      pagerLines: lines.size,
      vw: window.innerWidth,
    }
  })
  expect(geo.paneH).toBeGreaterThanOrEqual(200)
  // stacked: the preview takes the dialog's width, not a strip beside the options
  expect(geo.paneW).toBeGreaterThanOrEqual(200)
  expect(geo.dlgLeft).toBeGreaterThanOrEqual(0)
  expect(geo.dlgRight).toBeLessThanOrEqual(geo.vw)
  expect(geo.pagerText).toBe('1 / 1')
  expect(geo.pagerLines).toBe(1)
})

test('docs-mobile-390: print preview is usable in view-only too', async ({ page }) => {
  await page.setViewportSize(narrow)
  const ed = await openDoc(page, '&readonly=1')
  await ed.locator('.ribbon-tab-file').click()
  await ed.locator('.file-menu button', { hasText: /^Print/ }).click()
  await expect(ed.locator('.print-preview-nav')).toBeVisible({ timeout: 30_000 })
  const paneH = await ed.evaluate(
    () => document.querySelector('.print-preview-pane')!.getBoundingClientRect().height,
  )
  expect(paneH).toBeGreaterThanOrEqual(200)
})

test('docs-mobile-390: 1280 keeps the File menu under the File tab', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const ed = await openDoc(page)
  await ed.locator('.ribbon-tab-file').click()
  await expect(ed.locator('.file-menu')).toBeVisible()
  const geo = await ed.evaluate(() => {
    const m = document.querySelector('.file-menu')!.getBoundingClientRect()
    const tab = document.querySelector('.ribbon-tab-file')!.getBoundingClientRect()
    return { menuTop: m.top, menuLeft: m.left, tabBottom: tab.bottom, tabLeft: tab.left }
  })
  expect(geo.menuTop).toBeGreaterThanOrEqual(geo.tabBottom)
  expect(geo.menuTop - geo.tabBottom).toBeLessThanOrEqual(8)
  expect(Math.abs(geo.menuLeft - geo.tabLeft)).toBeLessThanOrEqual(2)
  const items = await hitTestMenu(ed)
  expect(items.length).toBeGreaterThan(0)
  for (const item of items) expect(item.hitInMenu, item.label).toBe(true)
})
