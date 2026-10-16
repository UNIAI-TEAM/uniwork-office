// UXF-06 (S7): in forced colors the selected AI model option has a 2px Highlight border, not only
// a fill. Real Chromium on the shipped picker CSS (jsdom has no forced-colors); no module build needed.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')
const css = ['tokens.css', 'ai-model-picker.css']
  .map((f) => readFileSync(resolve(repoRoot, 'packages/ui/src', f), 'utf8'))
  .join('\n')

test('S7 the selected picker option has a 2px Highlight border, not only a fill', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.setContent(
    `<style>${css}</style>
     <div role="listbox">
       <button class="ai-model-item selected" role="option" aria-selected="true">Selected</button>
       <button class="ai-model-item" role="option" aria-selected="false">Other</button>
     </div>`,
  )
  const measure = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const probe = document.createElement('span')
        probe.style.color = 'Highlight'
        el.append(probe)
        const hl = getComputedStyle(probe).color
        probe.remove()
        const cs = getComputedStyle(el)
        return {
          width: parseFloat(cs.borderTopWidth),
          color: cs.borderTopColor,
          style: cs.borderTopStyle,
          hl,
          box: el.getBoundingClientRect().height,
        }
      })
  const sel = await measure('.ai-model-item.selected')
  const other = await measure('.ai-model-item:not(.selected)')
  test.info().annotations.push({ type: 'measured', description: JSON.stringify({ sel, other }) })
  expect(sel.width).toBeGreaterThanOrEqual(2)
  expect(sel.style).not.toBe('none')
  expect(sel.color).toBe(sel.hl)
  // the border is reserved on every row: choosing another option does not move the list
  expect(other.box).toBe(sel.box)
})
