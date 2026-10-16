import { describe, expect, it } from 'vitest'
import { deriveDocumentName, derivePageTitleName } from '../src/renderer/document/auto-name'

describe('derivePageTitleName', () => {
  it('returns the decoded title text', () => {
    expect(derivePageTitleName('<head><title> Riverside &amp; Books </title></head>')).toBe(
      'Riverside & Books',
    )
  })

  it('rejects a missing, placeholder or overlong title', () => {
    expect(derivePageTitleName('<body><h1>Hero</h1></body>')).toBe('')
    expect(derivePageTitleName('<head><title></title></head>')).toBe('')
    expect(derivePageTitleName('<head><title>A</title></head>')).toBe('')
    expect(derivePageTitleName(`<head><title>${'x'.repeat(61)}</title></head>`)).toBe('')
  })

  it('ignores svg titles outside <head>', () => {
    expect(derivePageTitleName('<head></head><body><svg><title>Logo</title></svg></body>')).toBe('')
    expect(
      derivePageTitleName(
        '<head><title>Studio</title></head><body><svg><title>Logo</title></svg></body>',
      ),
    ).toBe('Studio')
  })

  it('accepts a document that omits the optional </head>', () => {
    expect(
      derivePageTitleName(
        '<html><head><title>Studio</title><body><svg><title>Logo</title></svg></body></html>',
      ),
    ).toBe('Studio')
    expect(derivePageTitleName('<title>Studio</title><p>hi</p>')).toBe('Studio')
    expect(derivePageTitleName('<svg><title>Logo</title></svg>')).toBe('')
  })
})

describe('deriveDocumentName', () => {
  it('names the page by its <title>', () => {
    expect(
      deriveDocumentName(
        '<head><title> Riverside &amp; Books </title></head><body><h1>Hero</h1></body>',
      ),
    ).toBe('Riverside & Books')
  })

  it('falls back to the first heading, whatever its level, stripping inline markup', () => {
    expect(deriveDocumentName('<body><h1 class="x">A <em>good</em> book</h1></body>')).toBe(
      'A good book',
    )
    expect(
      deriveDocumentName('<body><p>intro</p><h2>Opening hours</h2><h1>Later</h1></body>'),
    ).toBe('Opening hours')
  })

  it('strips trailing sentence punctuation but keeps a closing bracket', () => {
    expect(deriveDocumentName('<title>Our story.</title>')).toBe('Our story')
    expect(deriveDocumentName('<body><h1>Hello world!!</h1></body>')).toBe('Hello world')
    expect(deriveDocumentName('<body><h1>Why us? \u2026</h1></body>')).toBe('Why us')
    expect(deriveDocumentName('<title>Plan (v2)</title>')).toBe('Plan (v2)')
  })

  it('is empty (the default untitled name) when the page has no title or heading', () => {
    expect(deriveDocumentName('')).toBe('')
    expect(deriveDocumentName('<body><p>Edit the three words</p></body>')).toBe('')
    expect(deriveDocumentName('<title> </title><body><p>text</p></body>')).toBe('')
    expect(deriveDocumentName('<body><h1>...</h1></body>')).toBe('')
  })

  it('never takes a svg title from the body for the page title', () => {
    expect(deriveDocumentName('<body><svg><title>Logo</title></svg><h1>Studio</h1></body>')).toBe(
      'Studio',
    )
  })

  it('caps the length', () => {
    expect(deriveDocumentName(`<body><h1>${'x'.repeat(100)}</h1></body>`)).toHaveLength(60)
  })
})
