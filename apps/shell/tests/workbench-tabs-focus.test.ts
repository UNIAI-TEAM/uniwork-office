/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkbenchTabs } from '../src/renderer/src/WorkbenchTabs'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe('Workbench tab bar', () => {
  it('opening the + menu never marks + as a second selected tab', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(WorkbenchTabs, {
            practiceId: 'sales',
            pillars: [],
            active: 'desk',
            onSelect: () => {},
            vi: false,
          }),
        ),
      )
    })
    const add = host.querySelector<HTMLButtonElement>('.wb-tab-add')!
    await act(async () => add.click())
    expect(add.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelectorAll('.wb-tab.active')).toHaveLength(1)
    act(() => root.unmount())
    host.remove()
  })

  // WCAG 2.4.7: the hover background alone is near-invisible on the light surface
  it.each(['.wb-menu-item', '.wb-tab', '.wb-tab-unpin', '.skill-domain-tab-unpin'])(
    '%s shows an accent outline on keyboard focus',
    (sel) => {
      const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(css).toMatch(
        new RegExp(`\\n${escaped}:focus-visible \\{\\n  outline: 2px solid var\\(--accent\\);`),
      )
      expect(css).not.toMatch(new RegExp(`${escaped}:focus-visible \\{[^}]*outline: none`))
    },
  )

  // the select inside a breadcrumb chip is transparent, so the chip draws its focus ring
  it('a breadcrumb chip shows an accent outline while its select has keyboard focus', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    expect(css).toContain(
      '\n.wb-crumb:has(select:focus-visible) {\n  outline: 2px solid var(--accent);',
    )
    expect(css).toContain('\n.wb-crumb > select {\n  position: absolute;\n  inset: 0;')
    expect(css).not.toContain('.wb-topbar-picker')
  })
})
