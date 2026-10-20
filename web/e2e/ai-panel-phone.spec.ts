// UNI-1987 (AIPANEL-PHONE): the AI panel under 900 px, all six modules.
//  1. no sideways scroll with the panel open, idle and after typing one line (TVA2-3), at 390 and 360
//     (the Markdown typed-overflow assertion, TVA2-3, is a regression guard: it did not reproduce red at b5da4d4dc)
//  2. no squeeze at 390: the dock covers the document, or the pane keeps >= 300 px (TVA-1)
//  3. 600 / 768: the dock floats over the document (absolute) and the pane keeps width - 34
//     (Sheets keeps its own 719 px block: absolute at 600, side by side at 768)
//  4. 1024 / 1280: the side panel is unchanged (static dock, pane = width - 360), non-modal
//  5. closed at 390: the pane is width - 34, the rail is visible, nothing overflows
//  6. keyboard at 390: Enter on the rail focuses the composer, the dock is a modal dialog, Tab stays
//     in it, Esc closes it and focus returns to the rail; at 1280 neither dialog role nor aria-modal
//  7. the header close button sits inside the viewport at 360 / 390 / 430
// No credential is seeded; the numbers come from plan-s0.md section 5 (no dates in the fixtures).
// Run: npx playwright test -c web/e2e ai-panel-phone
import { test, expect, type APIRequestContext, type Frame, type Page } from '@playwright/test'
import { built } from './text-modules'

const MODULES = ['docs', 'sheets', 'slides', 'markdown', 'html', 'pdf'] as const
type Mod = (typeof MODULES)[number]

const FIXTURE: Record<Mod, string> = {
  docs: 'open=/fixtures/simple.docx',
  sheets: 'module=sheets',
  slides: 'module=slides',
  markdown: 'module=markdown&open=/fixtures/sample.md',
  html: 'module=html&open=/fixtures/sample.html',
  pdf: 'module=pdf&open=/fixtures/sample.pdf',
}

// the control that opens a collapsed AI panel; en and vi labels
const OPEN_PANEL =
  /^(Expand the AI editing pane|Open AI assistant|Expand AI assistant|Mở rộng ngăn chỉnh sửa AI|Mở trợ lý AI|Mở rộng trợ lý AI)$/

/** the dock element: Sheets' panel is its own dock, the others wrap it in `.ai-dock` */
const DOCK = (mod: Mod) => (mod === 'sheets' ? '.copilot' : '.ai-dock')
/** the document column next to the dock */
const PANE = (mod: Mod) => (mod === 'sheets' ? '.sheet-main' : '.app-content')
const RAIL = '.ai-rail, .expand-copilot'

/** Sheets overlays only below its own 719 px block (narrow-layout.ts) */
const overlays = (mod: Mod, width: number) => width <= (mod === 'sheets' ? 719 : 900)

async function resetFakeAi(request: APIRequestContext) {
  expect((await request.post('/__fake-ai/reset')).ok()).toBe(true)
}

async function openModule(page: Page, mod: Mod, width: number, height: number): Promise<Frame> {
  await page.setViewportSize({ width, height })
  await page.goto(`/test-host/?${FIXTURE[mod]}&lang=en&ai=1`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await frame.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0)
  await frame
    .locator(RAIL)
    .or(frame.locator('.ai-input-need button'))
    .first()
    .waitFor({ timeout: 30_000 })
  return frame
}

const isOpen = (frame: Frame, mod: Mod) =>
  frame.evaluate((sel) => {
    const d = document.querySelector(sel)
    return !!d && !d.classList.contains('collapsed') && d.getBoundingClientRect().width > 100
  }, DOCK(mod))

/** open the panel the way a user does (rail click); a module that opens it by itself is left as is */
async function openPanel(frame: Frame, mod: Mod): Promise<void> {
  const rail = frame.locator(RAIL).first()
  if (await rail.isVisible()) await rail.click()
  await expect(frame.locator(`${DOCK(mod)}:not(.collapsed) .ai-input-need button`)).toBeVisible({
    timeout: 30_000,
  })
}

interface Layout {
  scrollWidth: number
  clientWidth: number
  dock: { position: string; left: number; right: number; width: number; role: string | null }
  paneWidth: number
  railVisible: boolean
  closeRight: number
  ariaModal: string | null
  ariaLabel: string | null
  /** status bar leaves (zoom, file name, ...) that have no width or stick out of the viewport */
  brokenStatusItems: string[]
}

async function layout(frame: Frame, mod: Mod): Promise<Layout> {
  return frame.evaluate(
    ({ dockSel, paneSel, railSel }) => {
      const root = document.documentElement
      const dock = document.querySelector(dockSel)!
      const dr = dock.getBoundingClientRect()
      const pane = document.querySelector(paneSel)!.getBoundingClientRect()
      const rail = document.querySelector(railSel)
      const rr = rail?.getBoundingClientRect()
      const close = document.querySelector('.ai-panel-collapse')?.getBoundingClientRect()
      const broken: string[] = []
      for (const el of document.querySelectorAll('.status-bar .status-item, .status-bar button')) {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        if (r.width < 1 || r.right > root.clientWidth + 1 || r.left < -1) {
          broken.push(`${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`)
        }
      }
      return {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        dock: {
          position: getComputedStyle(dock).position,
          left: dr.left,
          right: dr.right,
          width: dr.width,
          role: dock.getAttribute('role'),
        },
        paneWidth: pane.width,
        railVisible: !!rr && rr.width > 0 && rr.height > 0,
        closeRight: close ? close.right : -1,
        ariaModal: dock.getAttribute('aria-modal'),
        ariaLabel: dock.getAttribute('aria-label'),
        brokenStatusItems: broken,
      }
    },
    { dockSel: DOCK(mod), paneSel: PANE(mod), railSel: RAIL },
  )
}

/** the dock animates (180 ms width): measure once two reads, 250 ms apart, agree */
async function settled(frame: Frame, mod: Mod): Promise<Layout> {
  let prev = await layout(frame, mod)
  for (let i = 0; i < 20; i++) {
    await frame.waitForTimeout(250)
    const next = await layout(frame, mod)
    if (JSON.stringify(next) === JSON.stringify(prev)) return next
    prev = next
  }
  throw new Error(`AI dock layout did not settle in 5 s: ${JSON.stringify(prev)}`)
}

/** one line typed where a user types: the document for Markdown, the AI composer elsewhere */
async function typeOneLine(page: Page, frame: Frame, mod: Mod): Promise<void> {
  if (mod === 'markdown') {
    // the dock may cover the editor: focus it directly instead of clicking through the overlay
    await frame
      .locator('.ProseMirror')
      .first()
      .evaluate((el: HTMLElement) => el.focus())
  } else {
    await frame
      .locator(`${DOCK(mod)} .ai-input-box textarea`)
      .first()
      .focus()
  }
  await page.keyboard.type('A line typed on a phone, long enough to wrap around the pane. ')
  await frame.waitForTimeout(300)
}

test.afterEach(async ({ request }) => {
  await resetFakeAi(request)
})

for (const mod of MODULES) {
  test.describe(`${mod}`, () => {
    test.skip(!built(mod), `no dist-web/${mod} build: npm run build:web -- --module ${mod}`)

    for (const [width, height] of [
      [390, 844],
      [360, 740],
    ] as const) {
      test(`${width}: panel open, no sideways scroll idle and after typing`, async ({
        page,
        request,
      }) => {
        await resetFakeAi(request)
        const frame = await openModule(page, mod, width, height)
        await openPanel(frame, mod)
        const idle = await settled(frame, mod)
        expect
          .soft(idle.scrollWidth, `idle scrollWidth (clientWidth ${idle.clientWidth})`)
          .toBeLessThanOrEqual(idle.clientWidth)
        await typeOneLine(page, frame, mod)
        const typed = await settled(frame, mod)
        expect
          .soft(typed.scrollWidth, `typed scrollWidth (clientWidth ${typed.clientWidth})`)
          .toBeLessThanOrEqual(typed.clientWidth)
      })
    }

    test('390: panel open, the document is covered or keeps 300 px (no squeeze)', async ({
      page,
      request,
    }) => {
      await resetFakeAi(request)
      const frame = await openModule(page, mod, 390, 844)
      await openPanel(frame, mod)
      const l = await settled(frame, mod)
      const covers = l.dock.position === 'absolute' && l.dock.left <= 0.5 && l.dock.right >= 389
      expect(
        covers || l.paneWidth >= 300,
        `dock ${l.dock.position} ${l.dock.left}..${l.dock.right}, pane ${l.paneWidth}px`,
      ).toBe(true)
    })

    for (const width of [600, 768]) {
      test(`${width}: panel open, the dock floats over the document`, async ({ page, request }) => {
        await resetFakeAi(request)
        const frame = await openModule(page, mod, width, 900)
        await openPanel(frame, mod)
        const l = await settled(frame, mod)
        if (overlays(mod, width)) {
          expect(l.dock.position, 'dock position').toBe('absolute')
          expect(l.paneWidth, 'document pane width').toBeGreaterThanOrEqual(width - 34)
        } else {
          // Sheets keeps its 719 px block: a side-by-side grid at 768
          expect(l.dock.position, 'dock position').not.toBe('absolute')
        }
        expect(l.scrollWidth, 'scrollWidth').toBeLessThanOrEqual(l.clientWidth)
      })
    }

    for (const width of [1024, 1280]) {
      test(`${width}: side panel unchanged and non-modal`, async ({ page, request }) => {
        await resetFakeAi(request)
        const frame = await openModule(page, mod, width, 900)
        if (!(await isOpen(frame, mod))) await openPanel(frame, mod)
        const l = await settled(frame, mod)
        // (Sheets' panel is `position: relative`: a grid column, not an overlay)
        expect(l.dock.position, 'dock position').not.toBe('absolute')
        expect(l.dock.width, 'dock width').toBeCloseTo(360, 0)
        expect(l.paneWidth, 'document pane width').toBeCloseTo(width - 360, 0)
        expect(l.dock.role, 'dock role').toBeNull()
        expect(l.ariaModal, 'aria-modal').toBeNull()
      })
    }

    test('390: panel closed, pane = width - 34, rail visible, status bar fits', async ({
      page,
      request,
    }) => {
      await resetFakeAi(request)
      const frame = await openModule(page, mod, 390, 844)
      // Markdown and HTML may start open: close it through its header button
      if (await isOpen(frame, mod)) await frame.locator('.ai-panel-collapse').first().click()
      await expect(frame.locator(`${DOCK(mod)}.collapsed`)).toBeVisible()
      const l = await settled(frame, mod)
      expect(l.railVisible, 'rail visible').toBe(true)
      expect(l.paneWidth, 'pane width').toBeCloseTo(390 - 34, 0)
      expect(l.scrollWidth, 'scrollWidth').toBeLessThanOrEqual(l.clientWidth)
      if (mod === 'markdown' || mod === 'pdf') {
        expect(l.brokenStatusItems, 'status bar items').toEqual([])
      }
    })

    for (const width of [360, 390, 430]) {
      test(`${width}: the close button is inside the viewport`, async ({ page, request }) => {
        await resetFakeAi(request)
        const frame = await openModule(page, mod, width, 844)
        await openPanel(frame, mod)
        const l = await settled(frame, mod)
        expect(l.closeRight, 'close button right edge').toBeGreaterThan(0)
        expect(l.closeRight, 'close button right edge').toBeLessThanOrEqual(width)
      })
    }

    test('390: keyboard: composer focus, dialog, Tab stays in, Esc closes and returns focus', async ({
      page,
      request,
    }) => {
      await resetFakeAi(request)
      const frame = await openModule(page, mod, 390, 844)
      if (await isOpen(frame, mod)) await frame.locator('.ai-panel-collapse').first().click()
      const rail = frame.locator(RAIL).first()
      await expect(rail).toBeVisible()
      // Enter on the rail opens the panel; a module that is still loading (Sheets' engine) re-renders
      // and drops the focus once, so press again until the panel is open
      await expect
        .poll(
          async () => {
            if (await isOpen(frame, mod)) return true
            await rail.focus()
            await page.keyboard.press('Enter')
            await frame.waitForTimeout(400)
            return isOpen(frame, mod)
          },
          { timeout: 20_000, message: 'Enter on the rail opens the panel' },
        )
        .toBe(true)
      await expect(
        frame.locator(`${DOCK(mod)}:not(.collapsed) .ai-input-box textarea`),
      ).toBeVisible({ timeout: 30_000 })

      const focusInfo = () =>
        frame.evaluate((dockSel) => {
          const a = document.activeElement
          const dock = document.querySelector(dockSel)
          return {
            tag: a?.tagName ?? null,
            inDock: !!a && !!dock && dock.contains(a),
            isComposer: !!a && a.matches('.ai-input-box textarea'),
            label: a?.getAttribute('aria-label') ?? null,
          }
        }, DOCK(mod))

      // Slides mounts the panel lazily: give the composer time to take focus
      await expect
        .poll(async () => (await focusInfo()).isComposer, {
          timeout: 5_000,
          message: 'composer has focus after open',
        })
        .toBe(true)

      const l = await settled(frame, mod)
      expect.soft(l.dock.role, 'dock role').toBe('dialog')
      expect.soft(l.ariaModal, 'aria-modal').toBe('true')
      expect.soft((l.ariaLabel ?? '').length, 'aria-label set').toBeGreaterThan(0)

      let outside = 0
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab')
        if (!(await focusInfo()).inDock) outside++
      }
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Shift+Tab')
        if (!(await focusInfo()).inDock) outside++
      }
      expect.soft(outside, 'focus presses that landed outside the dock').toBe(0)

      await frame
        .locator(`${DOCK(mod)} .ai-input-box textarea`)
        .first()
        .focus()
      await page.keyboard.press('Escape')
      await expect(frame.locator(`${DOCK(mod)}.collapsed`)).toBeVisible({ timeout: 5_000 })
      const back = await focusInfo()
      expect.soft(back.label, 'focus after Esc is the rail button').toMatch(OPEN_PANEL)
    })
  })
}
