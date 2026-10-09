import { describe, expect, it } from 'vitest'
import { parseFromInspector } from '../src/renderer/preview/inspector-validate'

const computed = {
  color: '#000000',
  fontSize: '16',
  fontWeight: '400',
  fontStyle: 'normal',
  textAlign: 'start',
  background: '',
  backgroundImage: 'none',
  width: '100',
  height: '20',
  borderRadius: '0',
  padding: '0',
  opacity: '1',
  transform: '',
  marginLeft: '',
  marginRight: '',
  objectFit: 'fill',
}
const rect = { x: 1, y: 2, width: 3, height: 4 }
const element = {
  sid: 7,
  tag: 'p',
  className: 'lead',
  childElementCount: 0,
  text: 'Hello',
  rect,
  computed,
  textRun: 'Hello',
  textRunIndex: 0,
  inlineEditable: true,
}

describe('parseFromInspector', () => {
  it('accepts every message shape the inspector sends, as a fresh copy', () => {
    const valid = [
      { type: 'gx:ready', title: 't', docHeight: 900 },
      { type: 'gx:scroll', y: 10 },
      { type: 'gx:hover', sid: null },
      { type: 'gx:hover', sid: 3 },
      {
        type: 'gx:rect',
        sid: 7,
        rect,
        computed,
        textRun: null,
        textRunIndex: -1,
        inlineEditable: false,
      },
      { type: 'gx:select', element: null, dynamic: false },
      { type: 'gx:select', element, dynamic: false },
      { type: 'gx:select', element: { ...element, sid: null }, dynamic: true },
      { type: 'gx:textSelect', sid: 7, textNodeIndex: 0, start: 1, end: 3, text: 'el' },
      { type: 'gx:textEditCommit', sid: 7, textNodeIndex: 0, newText: 'Hi' },
      { type: 'gx:htmlEditCommit', sid: 7, html: 'a <b>b</b>' },
      { type: 'gx:textEditCancel' },
      { type: 'gx:keyCommand', command: 'delete' },
      { type: 'gx:zoom', delta: -3.5 },
      { type: 'gx:navigateBlocked', href: 'https://example.com/' },
      { type: 'gx:markClick', sid: 2 },
      { type: 'gx:resize', sid: 7, styles: { width: '120px', '--x': '1' } },
      { type: 'gx:moveTo', sid: 7, position: 'after', ref_sid: 8 },
      { type: 'gx:drag', active: true },
    ]
    for (const msg of valid) {
      const input = { ...msg, version: 4 }
      const out = parseFromInspector(input)
      expect(out, msg.type).toEqual(input)
      expect(out).not.toBe(input)
    }
    const img = parseFromInspector({
      type: 'gx:select',
      version: 1,
      dynamic: false,
      element: {
        ...element,
        tag: 'img',
        computed: {
          ...computed,
          image: { src: 'a.png', alt: '', naturalWidth: 2, naturalHeight: 3 },
        },
      },
    })
    expect(img && img.type === 'gx:select' && img.element?.computed.image?.src).toBe('a.png')
  })

  it('drops forged, malformed or oversized messages', () => {
    const bad: unknown[] = [
      null,
      'gx:ready',
      [],
      { type: 'gx:ready', title: 't', docHeight: 1 },
      { type: 'gx:ready', title: 't', docHeight: 1, version: -1 },
      { type: 'gx:ready', title: 't', docHeight: 1, version: '1' },
      { type: 'gx:unknown', version: 1 },
      { type: 'uniwork.office.docs', version: 1 },
      { type: 'gx:scroll', y: Number.NaN, version: 1 },
      { type: 'gx:hover', sid: 1.5, version: 1 },
      { type: 'gx:hover', sid: '1', version: 1 },
      { type: 'gx:keyCommand', command: 'eval', version: 1 },
      { type: 'gx:keyCommand', command: 'toString', version: 1 },
      { type: 'gx:moveTo', sid: 1, position: 'inside', ref_sid: 2, version: 1 },
      { type: 'gx:resize', sid: 1, styles: { 'width;color': 'red' }, version: 1 },
      { type: 'gx:resize', sid: 1, styles: { width: 12 }, version: 1 },
      {
        type: 'gx:resize',
        sid: 1,
        styles: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, '1'])),
        version: 1,
      },
      { type: 'gx:htmlEditCommit', sid: 1, html: 'x'.repeat((1 << 20) + 1), version: 1 },
      { type: 'gx:select', element: { ...element, tag: 'p onclick' }, dynamic: false, version: 1 },
      { type: 'gx:select', element: { ...element, rect: { x: 1 } }, dynamic: false, version: 1 },
      { type: 'gx:select', element, dynamic: 'no', version: 1 },
      { type: 'gx:drag', active: 1, version: 1 },
      { type: 'gx:textSelect', sid: 1, textNodeIndex: 0, start: 5, end: 2, text: '', version: 1 },
    ]
    for (const msg of bad)
      expect(parseFromInspector(msg), JSON.stringify(msg)?.slice(0, 80)).toBeNull()
  })

  it('keeps only the fields of the type (no extra keys, no prototype keys)', () => {
    const forged = JSON.parse(
      '{"type":"gx:markClick","sid":1,"version":2,"extra":"x","__proto__":{"polluted":true}}',
    )
    const out = parseFromInspector(forged) as Record<string, unknown>
    expect(out).toEqual({ type: 'gx:markClick', sid: 1, version: 2 })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const styles = parseFromInspector(
      JSON.parse('{"type":"gx:resize","sid":1,"version":1,"styles":{"__proto__":{"a":"b"}}}'),
    )
    expect(styles).toBeNull()
  })
})
