// @vitest-environment jsdom
// A7 / B: the Docs "use the app" note: shared hint always, Open-in-app only with the host grant.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AppOnlyNote } from '../src/renderer/components/AppOnlyNote'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Desktop = { capabilities?: Record<string, unknown>; openInApp?: (f?: string) => unknown }
const win = window as unknown as { desktop?: Desktop }

let root: Root | null = null
let host: HTMLElement | null = null

function mount(desktop: Desktop): HTMLElement {
  win.desktop = desktop
  resetCapabilitiesForTest()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      createElement(AppOnlyNote, { lead: 'appOnlyZotero', feature: 'docs.zotero', testId: 'note' }),
    )
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  delete win.desktop
  resetCapabilitiesForTest()
})

describe('AppOnlyNote', () => {
  it('shows the feature line and the shared hint without an action when desktopOpen is not granted', () => {
    const el = mount({ capabilities: { platform: 'web', desktopOpen: false } })
    expect(el.querySelector('[data-testid="note"]')).not.toBeNull()
    expect(el.querySelectorAll('p')).toHaveLength(2)
    expect(el.querySelector('button')).toBeNull()
  })

  it('an unset desktopOpen key is not a grant (cap() would read it as on)', () => {
    const el = mount({ capabilities: { platform: 'web' } })
    expect(el.querySelector('button')).toBeNull()
  })

  it('with the grant, Open in app asks the host once with the feature tag', () => {
    const openInApp = vi.fn(async () => ({ outcome: 'launched' }))
    const el = mount({ capabilities: { platform: 'web', desktopOpen: true }, openInApp })
    const button = el.querySelector('button')!
    expect(button).not.toBeNull()
    act(() => button.click())
    expect(openInApp).toHaveBeenCalledTimes(1)
    expect(openInApp).toHaveBeenCalledWith('docs.zotero')
  })
})
