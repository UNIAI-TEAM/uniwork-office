import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Exercise the production row-menu CSS and placement in a real browser: jsdom cannot lay out
// anchors. The popup is the shared `.uw-row-menu-list` (portalled to the body, fixed), placed by
// the production `placeMenu` (src/renderer/src/menu-placement.ts, transpiled here, not copied).
const css = readFileSync(resolve('apps/shell/src/renderer/src/home.css'), 'utf8')
const ts = createRequire(resolve('apps/shell/package.json'))(
  'typescript',
) as typeof import('typescript')
const placeMenuJs = ts.transpileModule(
  readFileSync(resolve('apps/shell/src/renderer/src/menu-placement.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText

for (const scenario of [
  { name: 'bottom row flips upward', height: 600, top: 550, above: true },
  { name: 'top row opens downward', height: 600, top: 20, above: false },
  { name: 'short window keeps every action reachable', height: 220, top: 100 },
]) {
  test(scenario.name, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: scenario.height })
    await page.setContent(`<!doctype html>
      <style>${css}</style>
      <div style="height: calc(100vh - 16px)">
        <span class="uw-row-menu uwf-menu" style="position:absolute;top:${scenario.top}px;right:20px">
          <button class="uw-row-menu-btn" style="opacity:1">…</button>
        </span>
      </div>
    `)
    await page.addScriptTag({
      content: `;(() => { const exports = {}; ${placeMenuJs}; window.placeMenu = exports.placeMenu })()`,
    })
    await page.locator('.uw-row-menu-btn').evaluate((button) => {
      // what FolderMenu does on open: portal the menu to the body, then place it against the button
      button.addEventListener('click', () => {
        const menu = document.createElement('div')
        menu.className = 'uw-row-menu-list'
        menu.setAttribute('role', 'menu')
        for (const label of [
          'Open',
          'Reveal',
          'Copy path',
          'Move',
          'Rename',
          'Duplicate',
          'Remove',
          'Delete',
        ]) {
          const item = document.createElement('button')
          item.className = 'uw-row-menu-item'
          item.setAttribute('role', 'menuitem')
          item.textContent = label
          menu.append(item)
        }
        document.body.append(menu)
        ;(window as unknown as { placeMenu: (b: Element, m: Element) => void }).placeMenu(
          button,
          menu,
        )
      })
    })
    const initialHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.locator('.uw-row-menu-btn').click()
    const menu = page.locator('.uw-row-menu-list')
    await expect(menu).toBeVisible()
    await expect
      .poll(async () => {
        const box = await menu.boundingBox()
        return !!box && box.y >= 0 && box.y + box.height <= scenario.height
      })
      .toBe(true)
    const box = (await menu.boundingBox())!
    const trigger = (await page.locator('.uw-row-menu-btn').boundingBox())!
    if (scenario.above === true) expect(box.y + box.height).toBeLessThanOrEqual(trigger.y)
    if (scenario.above === false) expect(box.y).toBeGreaterThanOrEqual(trigger.y + trigger.height)
    await menu.getByText('Delete', { exact: true }).click()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(initialHeight)
  })
}
