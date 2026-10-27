import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
const beforeQuit = source.slice(
  source.indexOf("app.on('before-quit'"),
  source.indexOf("app.on('will-quit'"),
)
const willQuit = source.slice(source.indexOf("app.on('will-quit'"))

// A close prompt can still veto before-quit (window-close-guard clears the quit state), and the
// opener / converter queue cannot be reopened: disposing them there leaves a live converted tab
// without its backing file and swallows every later legacy open (R2-1).
describe('the legacy opener and converter are disposed only once a quit cannot be vetoed', () => {
  it.each([
    'legacyOpener.dispose()',
    'disposeLegacyConverter()',
    'killAllActiveLegacyConversions()',
  ])('before-quit leaves %s alone', (call) => {
    expect(beforeQuit).not.toContain(call)
  })

  it('will-quit disposes the opener, then the converter, on the pass that really quits', () => {
    const hold = willQuit.indexOf('quitAgainAfterWillQuit')
    const opener = willQuit.indexOf('legacyOpener.dispose()')
    const converter = willQuit.indexOf('disposeLegacyConverter()')
    const kill = willQuit.indexOf('killAllActiveLegacyConversions()')
    expect(hold).toBeGreaterThan(-1)
    // a held quit re-enters will-quit; nothing irreversible runs on the held pass
    expect(opener).toBeGreaterThan(hold)
    // the opener first: nothing new starts after the running jobs are killed
    expect(converter).toBeGreaterThan(opener)
    expect(kill).toBeGreaterThan(converter)
    expect(willQuit.indexOf('stopUniworkAccount()')).toBeGreaterThan(kill)
  })
})
