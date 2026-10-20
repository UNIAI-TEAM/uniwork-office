import { describe, expect, it } from 'vitest'
import { createActiveDocRefresh } from '../src/main/uniwork-docs/active-doc-refresh'

/**
 * S18 (G8-17, G8-A09): a title changed on the web must reach the open desktop
 * copy "when the tab gains focus". A tab switch already refreshed the active
 * document; a window that regains focus, or a click on the tab that is already
 * active, did not - so a rename made in the browser never showed after the
 * user came back to the app (cloud A09 `webRenameOnDesktop`).
 */

function setup() {
  const calls: string[] = []
  const refresh = createActiveDocRefresh({
    noteActivePath: (path) => calls.push(`note:${path ?? ''}`),
    refreshPath: (path) => {
      calls.push(`refresh:${path ?? ''}`)
      return Promise.resolve()
    },
  })
  return { calls, refresh }
}

describe('the active document refresh trigger', () => {
  it('a tab switch notes the new active path and refreshes it once', () => {
    const { calls, refresh } = setup()
    refresh.tabsChanged('/a.docx')
    refresh.tabsChanged('/a.docx')
    expect(calls).toEqual(['note:/a.docx', 'refresh:/a.docx'])
    refresh.tabsChanged('/b.docx')
    expect(calls.slice(2)).toEqual(['note:/b.docx', 'refresh:/b.docx'])
  })

  it('a window that regains focus re-reads the active document without touching the conflict dialog', () => {
    const { calls, refresh } = setup()
    refresh.tabsChanged('/a.docx')
    calls.length = 0
    refresh.gainedFocus('/a.docx')
    expect(calls).toEqual(['refresh:/a.docx'])
  })

  it('a focus with no active document refreshes nothing', () => {
    const { calls, refresh } = setup()
    refresh.gainedFocus(undefined)
    expect(calls).toEqual([])
  })

  it('a refresh that rejects never escapes the trigger', async () => {
    const refresh = createActiveDocRefresh({
      noteActivePath: () => undefined,
      refreshPath: () => Promise.reject(new Error('offline')),
    })
    expect(() => refresh.gainedFocus('/a.docx')).not.toThrow()
    await Promise.resolve()
  })
})
