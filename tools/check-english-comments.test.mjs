import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findViolations } from './check-english-comments.mjs'

const count = (file, text) => findViolations(file, text).length

describe('findViolations', () => {
  it('flags Han prose in Markdown', () => {
    assert.equal(count('a.md', '# Title\n你好'), 1)
  })
  it('exempts Han inside a ``` fence', () => {
    assert.equal(count('a.md', '```ts\nconst a = "你好"\n```'), 0)
  })
  it('flags Han again after the fence closes', () => {
    assert.deepEqual(findViolations('a.md', '```\n你好\n```\n你好'), ['  a.md:4: 你好'])
  })
  it('supports ~~~ fences', () => {
    assert.equal(count('a.md', '~~~\n你好\n~~~\n'), 0)
  })
  it('flags Han in a .ts // comment', () => {
    assert.equal(count('a.ts', 'const a = 1 // 你好'), 1)
  })
  it('ignores Han in a .ts string literal', () => {
    assert.equal(count('a.ts', "const a = '你好'"), 0)
  })
})
