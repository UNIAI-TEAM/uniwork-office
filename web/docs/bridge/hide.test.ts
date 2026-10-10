// @vitest-environment jsdom
// Capability source + safety-net stubs of the web bridge (UNI-1013 W4).
import { describe, expect, it, vi } from 'vitest'
import ai, { AI_UNAVAILABLE_CODE, aiUnavailableMessage, isAiUnavailable } from './ai'
import hide, { hostGrants, webCapabilities } from './hide'

describe('webCapabilities (the single web capability source)', () => {
  it('turns every capability off, and says it is the web platform', () => {
    expect(webCapabilities.platform).toBe('web')
    const flags = Object.entries(webCapabilities).filter(([key]) => key !== 'platform')
    expect(flags.map(([key]) => key).sort()).toEqual(
      [
        'ai',
        'aiCredentials',
        'autoSaveToDisk',
        'billing',
        'createDocument',
        'docPassword',
        'imageGeneration',
        'imageSearch',
        'tabs',
        'webSearch',
        'zotero',
        'open',
        'recents',
      ].sort(),
    )
    for (const [, value] of flags) expect(value).toBe(false)
  })

  it('is frozen: a stray write cannot re-enable an entry', () => {
    expect(Object.isFrozen(webCapabilities)).toBe(true)
    expect(() => {
      ;(webCapabilities as { ai: boolean }).ai = true
    }).toThrow()
    expect(webCapabilities.ai).toBe(false)
  })

  it('is exported by the hide module so install.ts merges it into window.desktop', () => {
    expect(hide.capabilities).toBe(webCapabilities)
  })

  it('File > Open and recents turn on only with the negotiated host grants', () => {
    expect(hostGrants(undefined)).toEqual({ open: false, recents: false })
    // the dev-uniwork host: no document picker (file.pick answers unsupported)
    expect(hostGrants({ save: true, recents: true, filePick: false })).toEqual({
      open: false,
      recents: true,
    })
    expect(hostGrants({ filePick: true, recents: false })).toEqual({ open: true, recents: false })
  })
})

describe('hide stubs behind the hidden desktop-only entries', () => {
  it('resolve to the "not supported" value and never reject', async () => {
    expect(await hide.zoteroCommand()).toMatchObject({
      ok: false,
      errorCode: 'unsupported-command',
    })
    expect(await hide.setDocPassword()).toEqual({ ok: false })
    expect(await hide.openDocxDecrypt()).toEqual({ ok: false, reason: 'unsupported' })
    expect(await hide.getAutoSaveDefault()).toEqual({ on: false, updatedAt: 0 })
    expect(await hide.listDocsTabs()).toEqual([])
    expect(await hide.openNewTab()).toBeUndefined()
    expect(await hide.writeRecoveryCopy()).toEqual({ ok: false })
    expect(await hide.createDocument()).toMatchObject({ ok: false })
    expect(hide.getPathForFile()).toBe('')
  })

  it('on* subscribers return a disposer', () => {
    for (const key of [
      'onZoteroRequest',
      'onMenuCommand',
      'onTeardown',
      'onAutoSaveDefaultChanged',
    ] as const) {
      const off = hide[key](() => {})
      expect(typeof off).toBe('function')
      expect(() => off()).not.toThrow()
    }
  })
})

describe('AI / search / image bridge stays stubbed with a typed "unavailable" answer', () => {
  it('aiChat fails with the ai-unavailable error', async () => {
    const res = await ai.aiChat()
    expect(res.ok).toBe(false)
    expect(isAiUnavailable(res.error)).toBe(true)
  })

  it('aiStream emits exactly one terminal error chunk for its request and resolves', async () => {
    const chunks: Array<{ requestId: string; type: string; error?: string }> = []
    const off = ai.onAiStream((chunk) => chunks.push(chunk))
    await ai.aiStream({ requestId: 'r1' } as never)
    off()
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ requestId: 'r1', type: 'error' })
    expect(isAiUnavailable(chunks[0]!.error)).toBe(true)
    // a disposed listener hears nothing
    await ai.aiStream({ requestId: 'r2' } as never)
    expect(chunks).toHaveLength(1)
  })

  it('a throwing stream listener does not break aiStream', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const off = ai.onAiStream(() => {
      throw new Error('boom')
    })
    await expect(ai.aiStream({ requestId: 'r3' } as never)).resolves.toBeUndefined()
    off()
    error.mockRestore()
  })

  it('webSearch / imageSearch return the renderer\'s method:"error" shape, not empty results', async () => {
    const web = await ai.webSearch('q', 5)
    expect(web).toMatchObject({ method: 'error', results: [] })
    expect(isAiUnavailable(web.error)).toBe(true)
    const img = await ai.imageSearch('q', 5)
    expect(img).toMatchObject({ method: 'error', images: [] })
    expect(isAiUnavailable(img.error)).toBe(true)
  })

  it('aiGenerateImage returns an error, fetchImage returns null (no placeholder bitmap)', async () => {
    const gen = await ai.aiGenerateImage({ prompt: 'a cat' })
    expect(gen.url).toBeUndefined()
    expect(isAiUnavailable(gen.error)).toBe(true)
    expect(await ai.fetchImage('https://example.com/a.png')).toBeNull()
  })

  it('account / billing entries are inert and report signed-out', async () => {
    expect(await ai.aiGskStatus()).toEqual({ loggedIn: false })
    expect(await ai.aiGskStatus(true)).toEqual({ loggedIn: false })
    await expect(ai.aiOpenBilling()).resolves.toBeUndefined()
  })

  it('getAiSettings is a valid empty config and setAiSettings persists nothing', async () => {
    const settings = await ai.getAiSettings()
    expect(settings.provider).toBe('genspark')
    expect(settings.gskToolsEnabled).toBe(false)
    expect(Object.values(settings.providers).every((p) => p.apiKey === '')).toBe(true)
    await ai.setAiSettings({ ...settings, provider: 'custom' } as never)
    expect((await ai.getAiSettings()).provider).toBe('genspark')
    expect(localStorage.length).toBe(0)
  })

  it("isAiUnavailable only matches this module's errors", () => {
    expect(isAiUnavailable(aiUnavailableMessage('x'))).toBe(true)
    expect(aiUnavailableMessage('x').startsWith(AI_UNAVAILABLE_CODE)).toBe(true)
    expect(isAiUnavailable('network error')).toBe(false)
    expect(isAiUnavailable(undefined)).toBe(false)
  })
})
