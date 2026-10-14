import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * V4 (visual-1): the ribbon header, status bar and AI panel are `zoom: var(--ui-scale)`. The
 * workbook status message kept its 360px (or 30vw) share of the tab row while the tab scroller
 * shrank around it, so at 150% in a 1360px window the Review / View tabs sat under the message.
 * The message now yields first, down to a floor, and the tabs scroll (edge fade) beyond that.
 * Only a visual check proves the pixels; these pin the CSS text.
 */

const css = readFileSync(resolve(__dirname, '../src/renderer/styles.css'), 'utf8')

function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  expect(at, `${selector} rule exists`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('Sheets ribbon status message under the interface scale', () => {
  it('shrinks ahead of the tab scroller and keeps a floor', () => {
    const status = rule('.workbook-status')
    // a shrink factor far above the scroller's 1 makes the message absorb the deficit first
    const shrink = /flex:\s*0\s+(\d+)\s+auto/.exec(status)
    expect(shrink, 'flex shorthand with an explicit shrink').not.toBeNull()
    expect(Number(shrink![1])).toBeGreaterThanOrEqual(100)
    expect(status).toMatch(/min-width:\s*\d+(?:\.\d+)?em/)
  })

  it('divides its viewport share by the scale (the header is zoomed)', () => {
    expect(rule('.workbook-status')).toMatch(
      /max-width:\s*min\(360px,\s*calc\(var\(--ui-vw\)\s*\*\s*30\)\)/,
    )
    expect(rule('.excel-header,\n.status-bar,\n.copilot')).toMatch(
      /--ui-vw:\s*calc\(1vw\s*\/\s*var\(--ui-scale,\s*1\)\)/,
    )
  })

  it('the zoomed AI panel sizes its clarify card from the scaled vh', () => {
    expect(rule('.ai-clarify-card')).toMatch(/min\(560px,\s*calc\(var\(--ui-vh\)\s*\*\s*62\)\)/)
  })

  it('the table styles popover (inside the zoomed ribbon) caps its height from the scaled vh', () => {
    // R3-1: a raw 60vh here is multiplied by the zoom again (90% of the window at 150%)
    expect(rule('.table-style-panel')).toMatch(/max-height:\s*calc\(var\(--ui-vh\)\s*\*\s*60\)/)
  })

  it('no raw vh/vw rule sits inside a zoomed container', () => {
    // every other vh/vw rule in this sheet belongs to a dialog, panel or overlay rendered outside
    // `.excel-header`, `.status-bar` and `.copilot` (checked against ExcelShell.tsx / App.tsx, R3-1)
    const outside = new Set([
      'body',
      '.app-shell',
      '.format-cells-dialog',
      '.recovery-dialog',
      '.format-cells-dialog.pivot-dialog',
      '.fn-args-rows',
      '.recommended-charts-dialog',
      '.slicer-stack',
      '.app-toast',
      '.find-replace-panel',
      '.threaded-comments-pane',
      '.thread-hover-card',
      '.format-cells-dialog.print-dialog',
      '.engine-unavailable',
    ])
    const offenders: string[] = []
    for (const m of css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .matchAll(/(^|\n)([^\n{}@/*][^{}]*?)\s*\{([^{}]*)\}/g)) {
      const selector = (m[2] ?? '').trim()
      const body = m[3] ?? ''
      if (
        /\d(?:vh|vw|dvh|svh)\b/.test(body) &&
        !/--ui-v[hw]/.test(body) &&
        !outside.has(selector)
      ) {
        offenders.push(selector)
      }
    }
    expect(offenders).toEqual([])
  })
})
