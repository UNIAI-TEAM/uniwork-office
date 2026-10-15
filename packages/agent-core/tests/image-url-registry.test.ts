// G6-09b (UNI-1374) N3: the run-scoped provenance registry behind the image URL rule
// (signed policy Q5): an image URL the AI inserts must come from this run's image_search /
// generate_image result or a chat attachment.
import { describe, expect, it } from 'vitest'
import { createImageUrlRegistry, IMAGE_URL_REFUSAL } from '../src/image-url-registry'

const enforcing = { enforce: () => true }

describe('image URL registry', () => {
  it('refuses a URL nothing registered', () => {
    const reg = createImageUrlRegistry(enforcing)
    expect(reg.isAllowed('https://example.com/a.png')).toBe(false)
    expect(reg.check('https://example.com/a.png')).toBe(IMAGE_URL_REFUSAL)
  })

  it('accepts a URL registered from image_search, generate_image or an attachment', () => {
    const reg = createImageUrlRegistry(enforcing)
    reg.register('https://example.com/s.png', 'image_search')
    reg.register('file:///store/generated/g1.png', 'generate_image')
    reg.register('/home/u/chat/logo.png', 'attachment')
    for (const url of [
      'https://example.com/s.png',
      'file:///store/generated/g1.png',
      '/home/u/chat/logo.png',
    ]) {
      expect(reg.isAllowed(url), url).toBe(true)
      expect(reg.check(url), url).toBeNull()
    }
  })

  it('matches exactly: no prefix, substring, host or case folding', () => {
    const reg = createImageUrlRegistry(enforcing)
    reg.register('https://example.com/a.png', 'image_search')
    for (const url of [
      'https://example.com/a.png?x=1',
      'https://example.com/a.pn',
      'https://example.com/',
      'https://example.com/a.png/../b.png',
      'https://EXAMPLE.com/a.png',
      'http://example.com/a.png',
      'https://evil.test/?u=https://example.com/a.png',
    ]) {
      expect(reg.isAllowed(url), url).toBe(false)
    }
  })

  it('trims whitespace around the candidate and around the registered URL', () => {
    const reg = createImageUrlRegistry(enforcing)
    reg.register('  https://example.com/a.png \n', 'image_search')
    expect(reg.isAllowed('https://example.com/a.png')).toBe(true)
    expect(reg.isAllowed(' https://example.com/a.png  ')).toBe(true)
  })

  it('ignores an empty registration and never allows the empty string', () => {
    const reg = createImageUrlRegistry(enforcing)
    reg.register('   ', 'image_search')
    expect(reg.isAllowed('')).toBe(false)
    expect(reg.isAllowed('   ')).toBe(false)
  })

  it('keeps a generated data: URL by identity, not by prefix', () => {
    const reg = createImageUrlRegistry(enforcing)
    const data = `data:image/png;base64,${'A'.repeat(4000)}`
    reg.register(data, 'generate_image')
    expect(reg.isAllowed(data)).toBe(true)
    expect(reg.isAllowed(data.slice(0, -1))).toBe(false)
    expect(reg.isAllowed(`${data}A`)).toBe(false)
    expect(reg.isAllowed('data:image/png;base64,')).toBe(false)
  })

  it('forgets everything at the next run, and re-reads the attachments then', () => {
    let atts = ['/chat/one.png']
    const reg = createImageUrlRegistry({ enforce: () => true, attachments: () => atts })
    reg.beginRun()
    reg.register('https://example.com/a.png', 'image_search')
    expect(reg.isAllowed('https://example.com/a.png')).toBe(true)
    expect(reg.isAllowed('/chat/one.png')).toBe(true)
    atts = ['/chat/two.png']
    reg.beginRun()
    expect(reg.isAllowed('https://example.com/a.png')).toBe(false)
    expect(reg.isAllowed('/chat/one.png')).toBe(false)
    expect(reg.isAllowed('/chat/two.png')).toBe(true)
  })

  it('also accepts an attachment through its file:// URL', () => {
    const reg = createImageUrlRegistry({
      enforce: () => true,
      attachments: () => ['/chat/a b.png'],
    })
    reg.beginRun()
    expect(reg.isAllowed('file:///chat/a%20b.png')).toBe(true)
    expect(reg.isAllowed('file:///chat/other.png')).toBe(false)
  })

  it('does not enforce unless the predicate says so, but still records', () => {
    let on = false
    const reg = createImageUrlRegistry({ enforce: () => on })
    expect(reg.check('https://example.com/a.png')).toBeNull() // BYOK: today's rules
    reg.register('https://example.com/a.png', 'image_search')
    expect(reg.isAllowed('https://example.com/a.png')).toBe(true)
    on = true // live: a provider switch mid-chat takes effect at once
    expect(reg.check('https://example.com/a.png')).toBeNull()
    expect(reg.check('https://example.com/b.png')).toBe(IMAGE_URL_REFUSAL)
  })

  it('defaults to not enforcing', () => {
    expect(createImageUrlRegistry().check('https://example.com/a.png')).toBeNull()
  })

  it('words the refusal for the model without internal codes', () => {
    expect(IMAGE_URL_REFUSAL).toContain('image_search')
    expect(IMAGE_URL_REFUSAL).toContain('generate_image')
    expect(IMAGE_URL_REFUSAL).toMatch(/ask the user/i)
    expect(IMAGE_URL_REFUSAL).not.toMatch(/UNI-|G6-|N3|Q5/)
  })
})
