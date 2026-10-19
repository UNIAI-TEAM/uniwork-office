// UNI-1919 (AIPANEL-FU slice A): the AI panel's composer at phone and desktop width, all six modules.
//  - SVR-3: with the panel open at 390 the frame document never scrolls sideways (the Markdown / PDF
//    status bar and the HTML ribbon's clipped labels used to push it to 514 / 582 / 730 px)
//  - SVR-4: the no-key hint link starts where the placeholder text starts (same left edge, 1 px)
//  - SVR-2: the hint never overlaps the placeholder, also when it wraps to two lines (vi, Markdown)
// No credential is seeded, so the composer shows the "add an API key" hint in every module.
// Run: npx playwright test -c web/e2e ai-composer-390
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

// the control that opens a collapsed AI panel; en and vi labels (Markdown / HTML open it by default at 1280)
const OPEN_PANEL =
  /^(Expand the AI editing pane|Open AI assistant|Expand AI assistant|Mở rộng ngăn chỉnh sửa AI|Mở trợ lý AI|Mở rộng trợ lý AI)$/

async function resetFakeAi(request: APIRequestContext) {
  expect((await request.post('/__fake-ai/reset')).ok()).toBe(true)
}

async function openPanel(page: Page, mod: Mod, lang: 'en' | 'vi'): Promise<Frame> {
  await page.goto(`/test-host/?${FIXTURE[mod]}&lang=${lang}&ai=1`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await frame.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0)
  // the opener (or, when the panel opens by itself, the hint) appears once the module has rendered
  const opener = frame.getByRole('button', { name: OPEN_PANEL }).first()
  await opener.or(frame.locator('.ai-input-need button')).first().waitFor({ timeout: 30_000 })
  if (await opener.isVisible()) await opener.click()
  await expect(frame.locator('.ai-input-need button')).toBeVisible({ timeout: 30_000 })
  return frame
}

interface Geometry {
  scrollWidth: number
  clientWidth: number
  linkLeft: number
  placeholderLeft: number
  /** where the placeholder text ends: content top + its wrapped line count * line height */
  placeholderBottom: number
  hintTop: number
}

/** the hint link against the placeholder text, in frame coordinates (the placeholder is measured with
 *  a hidden mirror of the textarea's text box, since a placeholder has no DOM node) */
async function geometry(frame: Frame): Promise<Geometry> {
  return frame.evaluate(() => {
    const need = document.querySelector('.ai-input-need')!
    const link = need.querySelector('button')!.getBoundingClientRect()
    const ta = need.closest('.ai-input-box')!.querySelector('textarea')!
    const cs = getComputedStyle(ta)
    const box = ta.getBoundingClientRect()
    const px = (v: string) => parseFloat(v) || 0
    const left = box.left + px(cs.borderLeftWidth) + px(cs.paddingLeft)
    const width =
      box.width -
      px(cs.borderLeftWidth) -
      px(cs.borderRightWidth) -
      px(cs.paddingLeft) -
      px(cs.paddingRight)
    const mirror = document.createElement('div')
    mirror.textContent = ta.placeholder
    mirror.style.cssText = `position:fixed;visibility:hidden;left:0;top:0;width:${width}px;font:${cs.font};letter-spacing:${cs.letterSpacing};line-height:${cs.lineHeight};white-space:pre-wrap;overflow-wrap:break-word`
    document.body.appendChild(mirror)
    const lineHeight = px(cs.lineHeight)
    const lines = Math.round(mirror.getBoundingClientRect().height / lineHeight)
    mirror.remove()
    // the text starts below the top border and top padding; a textarea's vertical margin is outside `box`
    const top = box.top + px(cs.borderTopWidth) + px(cs.paddingTop)
    const root = document.documentElement
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      linkLeft: link.left,
      placeholderLeft: left,
      placeholderBottom: top + lines * lineHeight,
      hintTop: link.top,
    }
  })
}

/** the panel animates open (its width grows): measure only once two reads, 250 ms apart, agree;
 *  a panel that never settles is a failure, not a last-sample measurement */
async function settled(frame: Frame): Promise<Geometry> {
  let prev = await geometry(frame)
  for (let i = 0; i < 20; i++) {
    await frame.waitForTimeout(250)
    const next = await geometry(frame)
    if (JSON.stringify(next) === JSON.stringify(prev)) return next
    prev = next
  }
  throw new Error(`AI panel geometry did not settle in 5 s: ${JSON.stringify(prev)}`)
}

test.afterEach(async ({ request }) => {
  await resetFakeAi(request)
})

for (const [width, lang] of [
  [390, 'vi'],
  [1280, 'en'],
] as const) {
  for (const mod of MODULES) {
    test.describe(`${mod} at ${width}`, () => {
      test.skip(!built(mod), `no dist-web/${mod} build: npm run build:web -- --module ${mod}`)

      test(`AI panel open, no key (${lang}): no sideways scroll, hint aligned and clear of the placeholder`, async ({
        page,
        request,
      }) => {
        await resetFakeAi(request)
        await page.setViewportSize({ width, height: 844 })
        const frame = await openPanel(page, mod, lang)
        const g = await settled(frame)
        // SVR-3: the frame document fits its viewport
        // (soft: one failure must not hide the numbers of the other two)
        expect.soft(g.scrollWidth, 'frame scrollWidth').toBeLessThanOrEqual(g.clientWidth)
        // SVR-4: hint and placeholder text share a left edge
        expect
          .soft(Math.abs(g.linkLeft - g.placeholderLeft), 'hint left vs placeholder left')
          .toBeLessThanOrEqual(1)
        // SVR-2: the placeholder (one or two lines) ends above the hint
        expect
          .soft(g.placeholderBottom, 'placeholder bottom vs hint top')
          .toBeLessThanOrEqual(g.hintTop + 0.5)
      })
    })
  }
}
