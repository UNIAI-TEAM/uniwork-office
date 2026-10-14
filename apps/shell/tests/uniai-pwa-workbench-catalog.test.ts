import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WORKBENCH_MODULES, parseAgentIntentTarget } from '@uniwork/practice-core'

/** The PWA is plain JS with no build, so its Workbench list is a copy: pin it to the desktop catalog. */
const source = readFileSync(join(__dirname, '../../uniai-pwa/app.js'), 'utf8')
const block = source.slice(
  source.indexOf('const WORKBENCH_TABS = ['),
  source.indexOf('\n]\n', source.indexOf('const WORKBENCH_TABS = [')),
)
const rows = [...block.matchAll(/id: '([^']+)',\n\s+label: '([^']+)'/g)].map((m) => ({
  id: m[1],
  label: m[2],
}))

describe('UniAI PWA Workbench plugins', () => {
  it('offers exactly the desktop modules, under the desktop Vietnamese labels', () => {
    expect(rows).toEqual(WORKBENCH_MODULES.map((m) => ({ id: m.id, label: m.labelVi })))
  })

  it('every deep link it can send is one the desktop accepts', () => {
    for (const { id } of rows) expect(parseAgentIntentTarget(id), id).not.toBeNull()
    // the only literal targets are the catalog rows; no hardcoded removed module
    expect(source).not.toMatch(/intentUrl\('/)
  })
})
