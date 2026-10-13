import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findViolations } from './check-english-comments.mjs'

// Built from code points so this file holds no raw Han text.
const HAN = String.fromCharCode(0x4e2d, 0x6587)
const FENCE = '`'.repeat(3)
const count = (file, text) => findViolations(file, text).length

describe('findViolations', () => {
  it('flags Han prose in Markdown', () => {
    assert.equal(count('a.md', `# Title\n${HAN}`), 1)
  })
  it('exempts Han inside a ``` fence', () => {
    assert.equal(count('a.md', `${FENCE}ts\nconst a = "${HAN}"\n${FENCE}`), 0)
  })
  it('flags Han again after the fence closes', () => {
    assert.deepEqual(findViolations('a.md', `${FENCE}\n${HAN}\n${FENCE}\n${HAN}`), [`  a.md:4: ${HAN}`])
  })
  it('supports ~~~ fences', () => {
    assert.equal(count('a.md', `~~~\n${HAN}\n~~~\n`), 0)
  })
  it('flags Han in a .ts // comment', () => {
    assert.equal(count('a.ts', `const a = 1 // ${HAN}`), 1)
  })
  it('ignores Han in a .ts string literal', () => {
    assert.equal(count('a.ts', `const a = '${HAN}'`), 0)
  })
})
