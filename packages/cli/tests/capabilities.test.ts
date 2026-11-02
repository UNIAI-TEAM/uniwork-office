import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run, tempDir } from './helpers'

describe('genoffice capabilities', () => {
  it('reports only the app: no cloud feature key', async () => {
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_APP_BIN: '' },
    })
    expect(r.code).toBe(0)
    // a checkout may find its own dev app, so only the shape is fixed here
    expect(Object.keys(r.json().detail)).toEqual(['app'])
    expect(typeof r.json().detail.app.available).toBe('boolean')
  })

  it('reports the app as available when its binary exists', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'bin'))
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_APP_BIN: join(dir, 'bin', 'app') },
    })
    expect(r.code).toBe(0)
    expect(Object.keys(r.json().detail)).toEqual(['app'])
    expect(r.json().detail.app.available).toBe(true)
  })
})
