import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { UniAiMark } from '../src/UniAiMark'

it('gives every tile its own gradient id and fills from it', () => {
  const html = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(UniAiMark, { size: 22 }),
      createElement(UniAiMark, { size: 22 }),
    ),
  )
  const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1])
  expect(ids).toHaveLength(2)
  expect(new Set(ids).size).toBe(2)
  for (const id of ids) {
    // a usable url() reference: no characters that need escaping
    expect(id).toMatch(/^[\w-]+$/)
    expect(html).toContain(`fill="url(#${id})"`)
  }
})

it('draws the glyph in currentColor and is decorative unless titled', () => {
  const glyph = renderToStaticMarkup(createElement(UniAiMark, { variant: 'glyph', size: 16 }))
  expect(glyph).toContain('currentColor')
  expect(glyph).not.toContain('linearGradient')
  expect(glyph).toContain('aria-hidden="true"')

  const titled = renderToStaticMarkup(createElement(UniAiMark, { title: 'UniAI' }))
  expect(titled).toContain('role="img"')
  expect(titled).toContain('aria-label="UniAI"')
  // no size: the outer <svg> carries no width, so its container sizes it
  expect(titled.slice(0, titled.indexOf('>'))).not.toContain('width=')
})
