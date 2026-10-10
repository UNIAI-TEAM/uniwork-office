import { describe, expect, it } from 'vitest'
import { isRelativePicturePath, missingImageUrl, unresolveMissingImage } from './missing-image'

describe('missing picture placeholder', () => {
  it('only relative document paths get one', () => {
    for (const src of ['assets/a.png', './assets/a.png', 'a.png', '../img/a b.png']) {
      expect(isRelativePicturePath(src), src).toBe(true)
    }
    for (const src of [
      '',
      '/abs/a.png',
      '//cdn.test/a.png',
      '#frag',
      'https://x.test/a.png',
      'data:image/png;base64,AA==',
      'blob:https://x.test/1',
      'C:\\pics\\a.png',
    ]) {
      expect(isRelativePicturePath(src), src).toBe(false)
      expect(missingImageUrl(src), src).toBeNull()
    }
  })

  it('is a data: SVG that carries the authored path back', () => {
    const url = missingImageUrl('assets/ảnh 1.png')!
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(unresolveMissingImage(url)).toBe('assets/ảnh 1.png')
    expect(unresolveMissingImage('https://x.test/a.png')).toBeNull()
    expect(unresolveMissingImage('data:image/png;base64,AA==')).toBeNull()
  })

  it('escapes the label and shortens a long path', () => {
    const svg = decodeURIComponent(
      missingImageUrl('a"><script>x</script>.png')!.split('#')[0]!.slice(33),
    )
    expect(svg).not.toContain('<script>')
    const long = `assets/${'x'.repeat(80)}.png`
    const shown = decodeURIComponent(missingImageUrl(long)!.split('#')[0]!.slice(33))
    expect(shown).toContain('…')
    expect(shown).not.toContain('x'.repeat(60))
  })
})
