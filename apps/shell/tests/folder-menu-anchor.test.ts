import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { followMenuAnchor, type Box } from '../src/renderer/src/folder-menu-anchor'

const box = (top: number, left: number, height = 24, width = 24): Box => ({
  top,
  left,
  bottom: top + height,
  right: left + width,
})

const viewport = box(0, 0, 900, 1280)

describe('followMenuAnchor', () => {
  it('keeps the menu when a scroll event arrives but the row did not move', () => {
    // a scroll event is dispatched on the next frame: the layout change it reports can
    // be older than the click that opened the menu, so the anchor is where it was
    expect(followMenuAnchor(box(397, 190), box(397, 190), [viewport, box(300, 12, 190, 200)])).toBe(
      'stay',
    )
  })

  it('ignores sub-pixel jitter', () => {
    expect(followMenuAnchor(box(397, 190), box(397.3, 190.2), [viewport])).toBe('stay')
  })

  it('moves the menu by the distance its row moved while the row is still visible', () => {
    const next = followMenuAnchor(box(397, 190), box(373, 190), [viewport, box(300, 12, 190, 200)])
    expect(next).toEqual({ dx: 0, dy: -24 })
  })

  it('closes when the row scrolled out of the scrollable list that holds it', () => {
    expect(followMenuAnchor(box(397, 190), box(250, 190), [viewport, box(300, 12, 190, 200)])).toBe(
      'close',
    )
  })

  it('closes when the row left the window', () => {
    expect(followMenuAnchor(box(397, 190), box(2000, 190), [viewport])).toBe('close')
  })

  it('closes when the row is gone', () => {
    expect(followMenuAnchor(box(397, 190), null, [viewport])).toBe('close')
  })
})

describe('Home folder menu scroll dismissal', () => {
  const source = readFileSync(join(__dirname, '../src/renderer/src/Home.tsx'), 'utf8')

  it('does not close the menu on every scroll event', () => {
    expect(source).not.toMatch(
      /const close = \(\) => setFolderMenu\(null\)\s*\n\s*window\.addEventListener\('scroll'/,
    )
    expect(source).toContain('followMenuAnchor(')
  })
})
