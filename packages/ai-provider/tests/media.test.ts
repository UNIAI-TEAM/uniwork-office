import { describe, expect, it } from 'vitest'
import {
  imageGenerationAvailable,
  mediaAnalysisAvailable,
  videoAnalysisAvailable,
} from '../src/media'
<<<<<<< ours
import { defaultAiSettings } from '../src/providers'

describe('media tools: UniWork cloud only', () => {
  it('are available while signed in with the cloud tools on, on the main-process verdict', () => {
    const settings = defaultAiSettings()
    // gskLoggedIn is main's hasGskAuth(): signed in + entitled
    for (const available of [
      imageGenerationAvailable,
      mediaAnalysisAvailable,
      videoAnalysisAvailable,
    ]) {
      expect(available(settings, true)).toBe(true)
      expect(available(settings, false)).toBe(false)
      // no settings read yet: the main-process verdict alone decides
      expect(available(null, true)).toBe(true)
      expect(available(undefined, false)).toBe(false)
=======
import {
  analyzeMediaWithProvider,
  generateImageWithProvider,
  sniffImageMime,
  testMediaProvider,
} from '../src/media-protocols'
import { defaultAiSettings, resolveAiSettings } from '../src/providers'
import type { AiSettings } from '../src/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const PNG_B64 = Buffer.from(PNG).toString('base64')

function withMedia(media: Partial<AiSettings['media']>): AiSettings {
  const base = defaultAiSettings()
  return { ...base, media: { ...base.media!, ...media } as AiSettings['media'] }
}

function openaiSettings(apiKey = 'sk-test', imageModel = 'gpt-image-2'): AiSettings {
  const media = defaultAiMediaSettings()
  media.imageProvider = 'openai'
  media.analysisProvider = 'openai'
  media.providers.openai = { apiKey, imageModel, analysisModel: 'gpt-5.6-luna' }
  return withMedia(media)
}

describe('media settings', () => {
  // Ark model list 2026-10-12: Seedream 5.0 is a pro/flash pair, and both
  // 4.5 and 4.0 are flagged for retirement there. Pinned so a future edit
  // cannot quietly put a retired ID back or drop a live one.
  it('offers only Seedream IDs the Ark list still serves', () => {
    const doubao = AI_MEDIA_PROVIDERS.find((p) => p.id === 'doubao')!
    expect(doubao.imageModels).toEqual([
      'doubao-seedream-5-0-pro-260628',
      'doubao-seedream-5-0-flash-260915',
      'doubao-seedream-5-0-260128',
    ])
    expect(doubao.defaultImageModel).toBe('doubao-seedream-5-0-pro-260628')
  })

  // the settings UI seeds imageModel from defaultImageModel and offers
  // imageModels; a default outside its own list is a value the user cannot
  // pick back
  it('never defaults a provider to a model its own list does not offer', () => {
    for (const meta of AI_MEDIA_PROVIDERS) {
      if (!meta.imageModels.length) continue
      expect(meta.imageModels).toContain(meta.defaultImageModel)
    }
  })

  it('defaults every provider to its default models and genspark as the active one', () => {
    const media = defaultAiMediaSettings()
    expect(media.imageProvider).toBe('genspark')
    expect(media.analysisProvider).toBe('genspark')
    expect(media.videoAnalysisProvider).toBe('genspark')
    for (const meta of AI_MEDIA_PROVIDERS) {
      expect(media.providers[meta.id].imageModel).toBe(meta.defaultImageModel)
      expect(media.providers[meta.id].apiKey).toBe('')
    }
    expect(media.providers.custom.baseUrl).toBe('')
    expect(media.providers.openai.baseUrl).toBeUndefined()
  })

  it('is carried by defaultAiSettings and healed in from a pre-media settings file', () => {
    const defaults = defaultAiSettings()
    expect(defaults.media?.imageProvider).toBe('genspark')
    const resolved = resolveAiSettings(
      { provider: 'genspark', providers: defaults.providers },
      defaultAiSettings(),
    )
    expect(resolved.media).toEqual(defaultAiMediaSettings())
  })

  it('merges and trims a stored media block over defaults', () => {
    const media = resolveAiMediaSettings({
      provider: 'gemini',
      providers: {
        gemini: { apiKey: ' AIza ', imageModel: ' gemini-3-pro-image ', analysisModel: '' },
      } as never,
    })
    // the pre-catalog single `provider` seeds both capabilities
    expect(media.imageProvider).toBe('gemini')
    expect(media.analysisProvider).toBe('gemini')
    expect(
      resolveAiMediaSettings({ imageProvider: 'doubao', analysisProvider: 'qwen' })
        .analysisProvider,
    ).toBe('qwen')
    // pre-split files used one vendor for all analysis
    expect(
      resolveAiMediaSettings({ imageProvider: 'doubao', analysisProvider: 'qwen' })
        .videoAnalysisProvider,
    ).toBe('qwen')
    expect(
      resolveAiMediaSettings({ analysisProvider: 'openai', videoAnalysisProvider: 'gemini' })
        .videoAnalysisProvider,
    ).toBe('gemini')
    expect(media.providers.gemini).toEqual({
      apiKey: 'AIza',
      imageModel: 'gemini-3-pro-image',
      analysisModel: '',
    })
    expect(media.providers.openai.imageModel).toBe('gpt-image-2')
  })

  it('tolerates non-string values in a hand-edited settings file', () => {
    const media = resolveAiMediaSettings({
      providers: {
        openai: { apiKey: 123, baseUrl: null, imageModel: 42, analysisModel: {} },
      },
    } as never)
    expect(media.providers.openai.apiKey).toBe('')
    expect(media.providers.openai.baseUrl).toBe('')
    expect(media.providers.openai.imageModel).toBe('gpt-image-2')
  })

  it('activates a BYOK media provider per capability, only when usable and capable', () => {
    expect(activeMediaProvider(openaiSettings(), 'image')).toBe('openai')
    expect(activeMediaProvider(openaiSettings(), 'analysis')).toBe('openai')
    expect(activeMediaProvider(openaiSettings(''), 'image')).toBe('genspark')
    expect(activeMediaProvider(openaiSettings('   '), 'image')).toBe('genspark')
    const custom = defaultAiMediaSettings()
    custom.imageProvider = 'custom'
    expect(activeMediaProvider(withMedia(custom), 'image')).toBe('genspark')
    custom.providers.custom.baseUrl = 'http://localhost:1234/v1'
    expect(activeMediaProvider(withMedia(custom), 'image')).toBe('custom')
    expect(activeMediaProvider(withMedia(custom), 'analysis')).toBe('genspark')
    expect(activeMediaConfig(withMedia(custom), 'image')?.provider).toBe('custom')
    // MiniMax-M3 supports both image and video analysis
    const mm = defaultAiMediaSettings()
    mm.analysisProvider = 'minimax'
    mm.providers.minimax.apiKey = 'k'
    expect(activeMediaProvider(withMedia(mm), 'analysis')).toBe('minimax')
    mm.videoAnalysisProvider = 'minimax'
    expect(activeMediaProvider(withMedia(mm), 'video')).toBe('minimax')
    // DeepSeek reads images (V4.1 Flash vision) but takes no video
    const ds = defaultAiMediaSettings()
    ds.analysisProvider = 'deepseek'
    ds.providers.deepseek.apiKey = 'sk-ds'
    expect(activeMediaProvider(withMedia(ds), 'analysis')).toBe('deepseek')
    ds.videoAnalysisProvider = 'deepseek'
    expect(activeMediaProvider(withMedia(ds), 'video')).toBe('genspark')
    // OpenAI reads images but not video: as the video provider it falls back
    const oa = openaiSettings()
    oa.media!.videoAnalysisProvider = 'openai'
    expect(activeMediaProvider(oa, 'video')).toBe('genspark')
    oa.media!.videoAnalysisProvider = 'gemini'
    oa.media!.providers.gemini.apiKey = 'AIza'
    expect(activeMediaProvider(oa, 'video')).toBe('gemini')
    expect(activeMediaProvider({ media: undefined }, 'image')).toBe('genspark')
    expect(
      activeMediaProvider({ media: { imageProvider: 'nope', providers: {} } as never }, 'image'),
    ).toBe('genspark')
  })

  it('gates the tools on gsk login + toggle without BYOK, and on the BYOK model with it', () => {
    const genspark = defaultAiSettings()
    expect(imageGenerationAvailable(genspark, true)).toBe(true)
    expect(imageGenerationAvailable(genspark, false)).toBe(false)
    expect(imageGenerationAvailable({ ...genspark, gskToolsEnabled: false }, true)).toBe(false)
    expect(mediaAnalysisAvailable({ ...genspark, gskToolsEnabled: false }, true)).toBe(false)

    const byok = openaiSettings()
    expect(imageGenerationAvailable(byok, false)).toBe(true)
    expect(imageGenerationAvailable({ ...byok, gskToolsEnabled: false }, false)).toBe(true)
    expect(mediaAnalysisAvailable(byok, false)).toBe(true)
    // built-in vendors fall back to their default model; a custom endpoint
    // without a model for one capability disables that tool alone
    const noAnalysis = openaiSettings()
    noAnalysis.media!.providers.openai.analysisModel = ''
    expect(mediaAnalysisAvailable(noAnalysis, false)).toBe(true)
    const custom = defaultAiMediaSettings()
    custom.imageProvider = 'custom'
    custom.analysisProvider = 'custom'
    custom.providers.custom = {
      apiKey: '',
      baseUrl: 'http://localhost:1234/v1',
      imageModel: 'flux',
      analysisModel: '',
>>>>>>> theirs
    }
  })

  it('are off when the user switched the cloud tools off, signed in or not', () => {
    const off = { ...defaultAiSettings(), gskToolsEnabled: false }
    for (const available of [
      imageGenerationAvailable,
      mediaAnalysisAvailable,
      videoAnalysisAvailable,
    ]) {
      expect(available(off, true)).toBe(false)
      expect(available(off, false)).toBe(false)
    }
  })
})
