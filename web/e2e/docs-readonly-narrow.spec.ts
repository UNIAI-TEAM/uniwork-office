// GO-B4/B5/B6 FDX (UNI-1014 visual F-01, F-04, F-05): the Docs frame in the protocol test host.
//  - view-only: the host withholds the `save` grant (?readonly=1) -> the editor is read-only, no typing,
//    no dirty, no save, the ribbon save entry is off and nothing reaches api.save
//  - narrow: at 768 and 390 px the page keeps the full width (no thumbnail between two panes), the frame
//    does not scroll sideways, the AI panel starts collapsed and overlays the page when opened
//  - vi: the Table Design tab labels are Vietnamese
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
  await page.goto(`/test-host/?open=${encodeURIComponent(DOC)}${query}`)
  const ed = (await (await page.waitForSelector('#frame')).contentFrame())!
  await ed
    .locator('.ProseMirror')
    .first()
    .getByText(TEXT, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  return ed
}

const lastSaved = (page: Page) => page.evaluate(() => (window as any).__host.lastSaved())
const hostEvents = (page: Page): Promise<Array<{ type: string; payload: any }>> =>
  page.evaluate(() => (window as any).__host.events)

test('docs-web: view only without the save grant', async ({ page }) => {
  const ed = await openDoc(page, '&readonly=1&lang=en')
  const editor = ed.locator('.ProseMirror').first()
  // the renderer's view-only mode (the desktop seam for a view-only working copy)
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  await expect(ed.locator('.status-bar, .statusbar').first()).toContainText(/view only/i)
  const before = await editor.innerText()
  await editor.click({ position: { x: 20, y: 10 }, force: true })
  await page.keyboard.type('zzz')
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(1_500)
  expect(await editor.innerText()).toBe(before)
  expect(await lastSaved(page)).toBeNull()
  // never dirty: the host got no `dirty: true`, the guard answers clean
  const dirty = (await hostEvents(page)).filter(
    (e) => e.type === 'dirty' && e.payload?.dirty === true,
  )
  expect(dirty).toEqual([])
  expect(
    await page.evaluate(() => (window as any).__host.request('doc.closeCheck', {})),
  ).toMatchObject({ dirty: false })
  // a host `save` request is refused, not run
  const res = await page.evaluate(() => (window as any).__host.request('save', { reason: 'user' }))
  expect(res).toMatchObject({ ok: false })
  expect(await lastSaved(page)).toBeNull()
})

test('docs-web: editable with the save grant (control)', async ({ page }) => {
  const ed = await openDoc(page, '&lang=en')
  await expect(ed.locator('.ProseMirror').first()).toHaveAttribute('contenteditable', 'true')
})

for (const width of [768, 390]) {
  test(`docs-web: ${width}px frame is usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    const ed = await openDoc(page, '&ai=1&lang=en')
    await page.waitForTimeout(1_500)
    // no sideways scrolling of the frame document
    const overflow = await ed.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }))
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw)
    // the AI panel starts collapsed (rail only) and the page keeps (almost) the whole width
    await expect(ed.locator('.ai-dock.collapsed')).toHaveCount(1)
    const page1 = await ed.locator('.doc-zoom').first().boundingBox()
    expect(page1!.width).toBeGreaterThan(width * 0.6)
    // a phone pane keeps a readable zoom (the page scrolls sideways inside the editor scroller);
    // from 768 up the page fits the pane
    if (width <= 600) {
      const zoomPct = await ed.evaluate(() => {
        const el = document.querySelector('.doc-zoom') as HTMLElement
        const z = Number.parseFloat(getComputedStyle(el).zoom)
        return Number.isFinite(z) ? z * 100 : 100
      })
      expect(zoomPct).toBeGreaterThanOrEqual(59)
    } else {
      expect(page1!.x + page1!.width).toBeLessThanOrEqual(width + 1)
    }
    // opened, the panel overlays the page: the page does not shrink or move
    await ed.locator('.ai-dock .ai-rail').click()
    await expect(ed.locator('.ai-dock:not(.collapsed)')).toHaveCount(1)
    await page.waitForTimeout(500)
    const dock = await ed.locator('.ai-dock').boundingBox()
    expect(dock!.width).toBeLessThanOrEqual(width)
    const page2 = await ed.locator('.doc-zoom').first().boundingBox()
    expect(Math.round(page2!.width)).toBe(Math.round(page1!.width))
    // collapse again: the rail comes back
    await ed.locator('.ai-panel-collapse').first().click()
    await expect(ed.locator('.ai-dock.collapsed')).toHaveCount(1)
    // the tab row stays inside the frame: it scrolls itself
    const tabs = await ed.evaluate(() => {
      const t = document.querySelector('.ribbon-tabs') as HTMLElement
      return { sw: t.scrollWidth, cw: t.clientWidth }
    })
    if (width <= 700) expect(tabs.sw).toBeGreaterThanOrEqual(tabs.cw)
    // the command band is wider than a phone frame: it scrolls and says so (shared overflow cue)
    if (width <= 600) {
      await expect(ed.locator('.ribbon')).toHaveAttribute('data-ribbon-overflow', /start|end|both/)
      await expect(ed.locator('.ribbon-overflow-cue:not([hidden])').first()).toBeVisible()
    }
  })
}

// UNI-1232 FX2 (D-N1): at phone width the status bar keeps what matters (page, save state, zoom)
// and drops the rest instead of clipping a word count under the view buttons
for (const lang of ['en', 'vi']) {
  test(`docs-web: 390px status bar clips nothing (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    const ed = await openDoc(page, `&lang=${lang}`)
    await page.waitForTimeout(1_000)
    const bar = await ed.evaluate(() => {
      const el = document.querySelector('.status-bar') as HTMLElement
      const box = el.getBoundingClientRect()
      const clipped: string[] = []
      for (const child of el.querySelectorAll<HTMLElement>('*')) {
        const r = child.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || getComputedStyle(child).display === 'none') continue
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5) {
          clipped.push(
            `${child.className || child.tagName} ${Math.round(r.right)}>${Math.round(box.right)}`,
          )
        }
      }
      const left = el.querySelector('.status-left') as HTMLElement
      const right = el.querySelector('.status-right') as HTMLElement
      const lr = left.getBoundingClientRect()
      const rr = right.getBoundingClientRect()
      return {
        clipped,
        leftOverflow: left.scrollWidth - left.clientWidth,
        overlap: lr.right - rr.left,
        text: left.innerText,
      }
    })
    expect(bar.clipped).toEqual([])
    expect(bar.leftOverflow).toBeLessThanOrEqual(0)
    expect(bar.overlap).toBeLessThanOrEqual(0)
    // the page counter and the zoom survive
    await expect(ed.locator('.status-page')).toBeVisible()
    await expect(ed.locator('.zoom-value')).toBeVisible()
    // a wide frame still has everything
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(300)
    await expect(ed.locator('.status-wordcount')).toBeVisible()
    await expect(ed.locator('.status-views')).toBeVisible()
  })
}

test('docs-web: Table Design tab is Vietnamese in vi', async ({ page }) => {
  const ed = await openDoc(page, '&lang=vi')
  await ed.locator('.ProseMirror').first().getByText(TEXT, { exact: false }).first().click()
  // Insert tab -> Table split button -> 2x2 cell of the grid picker (the contextual Table Design tab follows)
  await ed.locator('.ribbon-tab:not(.ribbon-tab-file)').nth(1).click()
  await ed
    .locator('button.rb-big', { hasText: /^Bảng$/ })
    .first()
    .click()
  await ed.locator('.table-picker-grid button.table-cell').nth(11).click()
  // the cursor is in the new table: the ribbon jumped to the contextual Table Design tab
  await expect(ed.getByRole('button', { name: 'Hàng tiêu đề' })).toBeVisible()
  const labels = await ed.evaluate(() =>
    [...document.querySelectorAll('.ribbon-body button, .ribbon-body label')].map(
      (b) => b.textContent?.trim() ?? '',
    ),
  )
  expect(labels.join('|')).toContain('Hàng tiêu đề')
  for (const word of [
    'Header Row',
    'Total Row',
    'Banded Rows',
    'First Column',
    'Plain Grid',
    'Blue Header',
  ])
    expect(labels).not.toContain(word)
})

// DP (UNI-1232, visual r2 F-12): the host leave dialog takes the keyboard focus and hands it back to
// the frame window; the caret must be in the editor again (typing and Ctrl+S work without a click)
test('docs-web: keyboard focus returns to the editor after a host dialog closes', async ({
  page,
}) => {
  const ed = await openDoc(page, '&lang=en')
  const editor = ed.locator('.ProseMirror').first()
  await editor.getByText(TEXT, { exact: false }).first().click()
  const hostTakesFocus = () =>
    page.evaluate(() => {
      const b = document.createElement('button')
      document.body.append(b)
      b.focus()
    })
  const hostHandsFocusBack = () =>
    page.evaluate(() => {
      const f = document.querySelector('#frame') as HTMLIFrameElement
      f.focus()
      f.contentWindow?.focus()
    })
  await hostTakesFocus()
  await hostHandsFocusBack()
  await expect
    .poll(() => ed.evaluate(() => !!document.activeElement?.closest('.ProseMirror')))
    .toBe(true)
  // typing lands in the document
  await page.keyboard.type('zq')
  await expect(editor).toContainText('zq')
})
