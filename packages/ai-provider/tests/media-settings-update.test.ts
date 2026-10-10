import { describe, expect, it } from 'vitest'
import {
  activeMediaProvider,
  defaultAiMediaSettings,
  updateMediaProviderConfig,
} from '../src/media'
import { defaultAiSettings } from '../src/providers'

const fresh = () => defaultAiMediaSettings()

describe('updateMediaProviderConfig', () => {
  it.each([
    ['image', 'imageProvider', 'openai'],
    ['analysis', 'analysisProvider', 'openai'],
    // the video block offers only vendors with video analysis, so the first shown one is gemini
    ['video', 'videoAnalysisProvider', 'gemini'],
  ] as const)('pins the shown vendor once a key makes it usable (%s)', (cap, field, id) => {
    const next = updateMediaProviderConfig(fresh(), cap, id, { apiKey: 'k' })
    expect(next[field]).toBe(id)
    expect(next.providers[id].apiKey).toBe('k')
  })

  it.each([
    ['image', 'imageProvider', 'openai', { imageModel: 'gpt-image-1' }],
    ['analysis', 'analysisProvider', 'openai', { analysisModel: 'gpt-x' }],
    ['video', 'videoAnalysisProvider', 'gemini', { analysisModel: 'gemini-x' }],
  ] as const)('does not pin a vendor that has no key (%s)', (cap, field, id, patch) => {
    const next = updateMediaProviderConfig(fresh(), cap, id, patch)
    expect(next[field]).toBe('genspark')
    expect(next.providers[id]).toMatchObject(patch)
  })

  it('scenario B: a model-only edit leaves the capability on the vendor that has the key', () => {
    let media = updateMediaProviderConfig(fresh(), 'analysis', 'gemini', { apiKey: 'g' })
    media = updateMediaProviderConfig(media, 'image', 'openai', { imageModel: 'gpt-image-1' })
    expect(media.imageProvider).toBe('genspark')
    expect(activeMediaProvider({ ...defaultAiSettings(), media }, 'image')).toBe('gemini')
  })

  it('pins a custom vendor only once it has a base URL', () => {
    const media = fresh()
    expect(updateMediaProviderConfig(media, 'image', 'custom', { apiKey: 'k' }).imageProvider).toBe(
      'genspark',
    )
    expect(
      updateMediaProviderConfig(media, 'image', 'custom', { baseUrl: 'https://x.test/v1' })
        .imageProvider,
    ).toBe('custom')
  })

  it('keeps a stored choice that the block offers', () => {
    const media = { ...fresh(), imageProvider: 'gemini' as const }
    const next = updateMediaProviderConfig(media, 'image', 'openai', { apiKey: 'k' })
    expect(next.imageProvider).toBe('gemini')
  })

  it('keeps editing the vendor that already serves the capability (key cleared stays pinned)', () => {
    const served = updateMediaProviderConfig(fresh(), 'image', 'openai', { apiKey: 'k' })
    const media = { ...served, imageProvider: 'genspark' as const }
    const cleared = updateMediaProviderConfig(media, 'image', 'openai', { apiKey: '' })
    expect(cleared.imageProvider).toBe('openai')
    expect(cleared.cloudPicked).toBeUndefined()
  })

  it('treats a stored choice the block does not offer as hidden (openai has no video analysis)', () => {
    const media = { ...fresh(), videoAnalysisProvider: 'openai' as const }
    const next = updateMediaProviderConfig(media, 'video', 'gemini', { apiKey: 'k' })
    expect(next.videoAnalysisProvider).toBe('gemini')
  })
})
