// The loading state of the Sheets web frame (visual round 2, S-07): a proper styled screen, not a
// bare line of text; the localised message stays the live status text.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WorkbookOpeningScreen } from '../src/renderer/WorkbookOpeningScreen'
import { tFor } from '../src/renderer/i18n/locale'

describe('WorkbookOpeningScreen', () => {
  const html = renderToStaticMarkup(createElement(WorkbookOpeningScreen))

  it('is a polite status region with the localised line', () => {
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain(tFor('zh', 'appOpeningWorkbook'))
  })

  it('draws a spinner and a skeleton that assistive tech skips', () => {
    expect(html).toMatch(/class="workbook-opening-spinner" aria-hidden="true"/)
    expect(html).toMatch(/class="workbook-opening-skeleton" aria-hidden="true"/)
    expect(html.match(/workbook-opening-skeleton-row/g)).toHaveLength(6)
  })

  it('has a localised line in every language (no missing shard key)', () => {
    for (const lang of ['en', 'vi', 'zh', 'ja', 'de'] as const) {
      expect(tFor(lang, 'appOpeningWorkbook').length).toBeGreaterThan(3)
    }
  })
})
