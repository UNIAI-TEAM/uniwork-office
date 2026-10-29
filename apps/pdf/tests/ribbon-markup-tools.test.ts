// @vitest-environment node
/**
 * Each ribbon markup button binds its own tool: the active class, aria-pressed and the click all
 * name the same markup type (a hand-merge once gave squiggly the strikeout state). The App is too
 * big to mount in jsdom, so the wiring is read from its source.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = readFileSync(fileURLToPath(new URL('../src/renderer/App.tsx', import.meta.url)), 'utf8')

describe('ribbon markup tool buttons', () => {
  for (const type of ['highlight', 'underline', 'squiggly', 'strikeout']) {
    it(`${type} lights up and arms only its own tool`, () => {
      const start = APP.indexOf(`data-tip={t('${type}')}`)
      expect(start).toBeGreaterThan(0)
      // the opening tag of the button that carries this tip
      const open = APP.lastIndexOf('<button', start)
      const tag = APP.slice(open, APP.indexOf('</span>', start))
      expect(tag).toContain(`markupTool === '${type}' ? ' active' : ''`)
      expect(tag).toContain(`aria-pressed={markupTool === '${type}'}`)
      expect(tag).toContain(`onRibbonMarkupClick('${type}')`)
    })
  }
})
