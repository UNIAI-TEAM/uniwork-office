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
<<<<<<< ours
    expect(Object.keys(r.json().detail)).toEqual(['app'])
    expect(r.json().detail.app.available).toBe(true)
=======
    const d = r.json().detail
    expect(d.search).toEqual({ available: true, via: 'serper' })
    expect(d.image_search).toEqual({ available: true, via: 'serper' })
    expect(d.image_generation).toEqual({ available: true, via: 'openai' })
    expect(d.media_analysis.available).toBe(false)
    expect(d.app.available).toBe(true)
    expect(r.json().summary).toContain('image_generation')
  })

  it('counts a Serply key as search + image search', async () => {
    const settings = settingsFile(tempDir(), {
      search: { provider: 'serply', providers: { serply: { apiKey: 'k' } } },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    const d = r.json().detail
    expect(d.search).toEqual({ available: true, via: 'serply' })
    expect(d.image_search).toEqual({ available: true, via: 'serply' })
  })

  it('counts a SearchApi key as search + image search', async () => {
    const settings = settingsFile(tempDir(), {
      search: { provider: 'searchapi', providers: { searchapi: { apiKey: 'k' } } },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    const d = r.json().detail
    expect(d.search).toEqual({ available: true, via: 'searchapi' })
    expect(d.image_search).toEqual({ available: true, via: 'searchapi' })
  })

  it.each(['tavily', 'parallel'])('%s gives web search but no image search', async (provider) => {
    const dir = tempDir()
    const settings = settingsFile(dir, {
      search: {
        provider,
        providers: { [provider]: { apiKey: 'test-key' } },
      },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    const d = r.json().detail
    expect(d.search).toEqual({ available: true, via: provider })
    expect(d.image_search.available).toBe(false)
  })

  it.each(['tavily', 'parallel'])(
    '%s does not advertise Genspark image search when signed in',
    async (provider) => {
      vi.spyOn(aiSearch, 'hasGskAuth').mockReturnValue(true)
      const settings = settingsFile(tempDir(), {
        search: { provider, providers: { [provider]: { apiKey: 'test-key' } } },
      })
      const r = await run(['capabilities', '--json'], {
        env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
      })
      const d = r.json().detail
      expect(d.search).toEqual({ available: true, via: provider })
      expect(d.image_search).toEqual({ available: false, via: null })
      expect(d.image_generation).toEqual({ available: true, via: 'genspark' })
      expect(d.media_analysis).toEqual({ available: true, via: 'genspark' })
    },
  )

  it('reports selected keyless Parallel as web search without requiring a login', async () => {
    const settings = settingsFile(tempDir(), {
      search: { provider: 'parallel', providers: { parallel: { apiKey: '' } } },
    })
    const r = await run(['capabilities', '--json'], {
      env: { ...process.env, GENOFFICE_AI_SETTINGS: settings },
    })
    expect(r.json().detail.search).toEqual({ available: true, via: 'parallel' })
    expect(r.json().detail.image_search).toEqual({ available: false, via: null })
>>>>>>> theirs
  })
})
