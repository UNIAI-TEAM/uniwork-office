// UXF-07 (S5-12) and UXF-05 (FC-02): the web frame's save conflict dialog (S5), rendered by the
// production Markdown frame in the protocol test host, measured with the same probes as the D
// e2e (e2e/office-ux-floor.spec.ts):
//  - frames narrower than 768 px: the card is the full frame width minus 16 px each side and its
//    buttons stack (390 and 600 px; the 448 px cap only applies to wide frames)
//  - forced colors: aria-disabled buttons use GrayText for text and border
// Run alone: npx playwright test -c web/e2e conflict-dialog-layout
import { test, expect, type Frame, type Page } from '@playwright/test'
import {
  built,
  bumpRemote,
  concat,
  encode,
  hostState,
  openModule,
  serveFixture,
} from './text-modules'

const FIXTURE_PATH = '/e2e-fixtures/Conflict.md'
const FIXTURE = concat(encode('# Conflict\r\n\r\nFirst paragraph.\r\n\r\nTail paragraph.\r\n'))

test.skip(!built('markdown'), 'no dist-web/markdown build: npm run build:web -- --module markdown')

const CARD = '[data-office-web="conflict"] .ow-dlg'

/** the frame's own Ctrl+S meets a 409: someone else saved meanwhile */
async function reachConflict(page: Page): Promise<Frame> {
  await serveFixture(page, FIXTURE_PATH, FIXTURE, 'text/markdown')
  const frame = await openModule(page, 'markdown', { open: FIXTURE_PATH, lang: 'vi' })
  const editor = frame.locator('.doc-editor')
  await expect(editor).toContainText('Tail paragraph.')
  // one clean save tells the test host which file this is
  await editor.click()
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.fileId).toBeTruthy()
  const fileId = (await hostState(page)).lastSaved!.fileId
  await bumpRemote(page, fileId)
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Mine.')
  await page.keyboard.press('Control+s')
  await expect(frame.locator(CARD)).toBeVisible()
  return frame
}

/** the iframe's width is the frame's viewport: its media queries follow it */
async function sizeFrame(page: Page, width: number): Promise<void> {
  await page.evaluate((w) => {
    const f = document.getElementById('frame') as HTMLIFrameElement
    f.style.width = `${w}px`
    f.style.maxWidth = `${w}px`
    f.style.flex = `0 0 ${w}px`
  }, width)
}

for (const width of [390, 600]) {
  test(`narrow web frame ${width}px: S5 full width minus 16px margins, buttons stacked`, async ({
    page,
  }) => {
    const frame = await reachConflict(page)
    await sizeFrame(page, width)
    await expect
      .poll(() => frame.locator(CARD).evaluate(() => window.innerWidth), { timeout: 10_000 })
      .toBe(width)
    const box = await frame.locator(CARD).evaluate((card) => {
      const r = card.getBoundingClientRect()
      const btns = [...card.querySelectorAll<HTMLElement>('.ow-dlg-btn')].map((b) =>
        b.getBoundingClientRect(),
      )
      return {
        left: r.left,
        width: r.width,
        inner: window.innerWidth,
        xs: btns.map((b) => Math.round(b.left)),
        ys: btns.map((b) => b.top),
      }
    })
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(box) })
    expect(new Set(box.xs).size, 'buttons share one column').toBe(1)
    expect(new Set(box.ys.map(Math.round)).size, 'every button on its own row').toBe(box.ys.length)
    expect(
      [...box.ys].sort((a, b) => a - b),
      'stacked top to bottom = DOM order',
    ).toEqual(box.ys)
    expect(Math.abs(box.left - 16), '16px left margin').toBeLessThanOrEqual(1)
    expect(Math.abs(box.width - (box.inner - 32)), 'full width minus 2x16px').toBeLessThanOrEqual(1)
  })
}

// UXF-V1-F3: a frame only 390 px tall is shorter than the card (the S5 content + 3 stacked
// actions): the backdrop scrolls (short-viewport rule), so the last button is reachable and works
test('390x390 frame: the S5 card is taller than the frame, the overlay scrolls to every button', async ({
  page,
}) => {
  const frame = await reachConflict(page)
  await page.evaluate(() => {
    const f = document.getElementById('frame') as HTMLIFrameElement
    f.style.cssText += ';width:390px;max-width:390px;flex:0 0 390px;height:390px;max-height:390px'
  })
  await expect
    .poll(() => frame.locator(CARD).evaluate(() => [innerWidth, innerHeight].join('x')), {
      timeout: 10_000,
    })
    .toBe('390x390')
  const measured = await frame.locator(CARD).evaluate((card) => {
    const mask = card.parentElement!
    const r = card.getBoundingClientRect()
    return {
      cardBottom: r.bottom,
      inner: innerHeight,
      overflowY: getComputedStyle(mask).overflowY,
      scrollable: mask.scrollHeight > mask.clientHeight,
    }
  })
  test.info().annotations.push({ type: 'measured', description: JSON.stringify(measured) })
  expect(measured.cardBottom, 'the card really is taller than the frame').toBeGreaterThan(
    measured.inner,
  )
  expect(measured.overflowY).toMatch(/auto|scroll/)
  expect(measured.scrollable).toBe(true)
  // scroll the overlay to the end: the Cancel button is inside the viewport, clickable
  const cancel = frame.locator(`${CARD} [data-choice="cancel"]`)
  await frame.locator(CARD).evaluate((card) => {
    card.parentElement!.scrollTop = card.parentElement!.scrollHeight
  })
  await expect(cancel).toBeInViewport({ ratio: 1 })
  await cancel.click()
  await expect(frame.locator(CARD)).toHaveCount(0)
})

test('wide frame keeps the 448px card', async ({ page }) => {
  const frame = await reachConflict(page)
  await sizeFrame(page, 900)
  await expect
    .poll(() => frame.locator(CARD).evaluate((c) => c.getBoundingClientRect().width))
    .toBe(448)
})

test('S5 aria-disabled buttons use GrayText text and border in forced colors', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  const frame = await reachConflict(page)
  await page.context().setOffline(true)
  try {
    await expect(frame.locator(`${CARD} [data-choice="overwrite"]`)).toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 10_000 },
    )
    const got = await frame.locator(CARD).evaluate((card) => {
      const probe = document.createElement('span')
      probe.style.color = 'GrayText'
      card.append(probe)
      const gray = getComputedStyle(probe).color
      probe.remove()
      return [...card.querySelectorAll<HTMLElement>('.ow-dlg-btn[aria-disabled="true"]')].map(
        (b) => ({
          id: b.dataset.choice,
          color: getComputedStyle(b).color,
          border: getComputedStyle(b).borderTopColor,
          gray,
        }),
      )
    })
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(got) })
    expect(got.map((b) => b.id)).toEqual(expect.arrayContaining(['reload', 'overwrite']))
    for (const b of got) {
      expect(b.color, `${b.id}: text`).toBe(b.gray)
      expect(b.border, `${b.id}: border`).toBe(b.gray)
    }
  } finally {
    await page.context().setOffline(false)
  }
})
