import { describe, expect, it } from 'vitest'
import {
  aiSettingsFileOf,
  cloudToolsEnabled,
  defaultAiSettings,
  resolveAiSettings,
} from '../src/providers'

<<<<<<< ours
describe('aiSettingsFileOf', () => {
  it('keeps a boolean gskToolsEnabled and drops every other key, legacy root fields included', () => {
=======
describe('defaultAiSettings', () => {
  it('gives every provider its default model and an empty key by default', () => {
    const settings = defaultAiSettings()
    expect(settings.provider).toBe('genspark')
    for (const meta of AI_PROVIDERS) {
      expect(settings.providers[meta.id].apiKey).toBe('')
      expect(settings.providers[meta.id].model).toBe(meta.defaultModel)
    }
    expect(settings.providers.custom.baseUrl).toBe('')
    expect(settings.providers.codex.cliPath).toBe('')
    expect(settings.providers.codex.model).toBe('')
    expect(settings.providers.anthropic.baseUrl).toBeUndefined()
  })

  it('applies caller-supplied default keys only to the listed providers', () => {
    const settings = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(settings.providers.anthropic.apiKey).toBe('sk-ant-preset')
    expect(settings.providers.gemini.apiKey).toBe('')
  })
})

describe('provider model catalog', () => {
  it("offers the vendor's own DeepSeek ids, not the Genspark pool spelling", () => {
    const genspark = AI_PROVIDERS.find((provider) => provider.id === 'genspark')!
    const deepseek = AI_PROVIDERS.find((provider) => provider.id === 'deepseek')!

    expect(deepseek.models).toContain('deepseek-flash')
    expect(deepseek.models).not.toContain('deep-seek-v4.1-flash')
    expect(deepseek.models).not.toContain('deepseek-v4-flash')
    expect(deepseek.models).not.toContain('deepseek-v4-flash-vision-exp')
    expect(genspark.models).not.toContain('deep-seek-v4-flash')
    expect(genspark.models).not.toContain('deep-seek-v4-flash-vision-exp-openrouter')
  })

  it('serves DeepSeek V4.1 Flash through the Genspark proxy under its hyphenated pool id', () => {
    const genspark = AI_PROVIDERS.find((provider) => provider.id === 'genspark')!
    expect(genspark.models).toContain('deep-seek-v4.1-flash')
    expect(genspark.models).not.toContain('deep-seek-v4-pro')
  })

  it('keeps Responses-only models out of the OpenCode tiers (no such protocol yet)', () => {
    for (const id of ['opencode-zen', 'opencode-go'] as const) {
      const meta = AI_PROVIDERS.find((provider) => provider.id === id)!
      expect(meta.models).toContain(meta.defaultModel)
      expect(meta.needsBaseUrl).toBeUndefined()
      for (const model of meta.models) {
        expect(model).not.toMatch(/^(gpt-|grok-|muse-spark-)/)
      }
    }
  })

  it('seeds Requesty with managed policy ids (short names, no vendor prefix)', () => {
    const requesty = AI_PROVIDERS.find((provider) => provider.id === 'requesty')!
    expect(requesty.models).toContain(requesty.defaultModel)
    expect(requesty.needsBaseUrl).toBeUndefined()
    for (const model of requesty.models) {
      expect(model).not.toContain('/')
    }
  })

  it('seeds Opper with pool ids (bare names, no vendor prefix)', () => {
    const opper = AI_PROVIDERS.find((provider) => provider.id === 'opper')!
    expect(opper.models).toContain(opper.defaultModel)
    expect(opper.needsBaseUrl).toBeUndefined()
    for (const model of opper.models) {
      expect(model).not.toContain('/')
    }
  })

  it('seeds Atlas Cloud with lab-namespaced model ids', () => {
    const atlas = AI_PROVIDERS.find((provider) => provider.id === 'atlascloud')!
    expect(atlas.models).toContain(atlas.defaultModel)
    expect(atlas.needsBaseUrl).toBeUndefined()
    for (const model of atlas.models) {
      expect(model).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/)
    }
  })

  it('seeds Runcrate with lab-namespaced model ids', () => {
    const runcrate = AI_PROVIDERS.find((provider) => provider.id === 'runcrate')!
    expect(runcrate.models).toContain(runcrate.defaultModel)
    expect(runcrate.needsBaseUrl).toBeUndefined()
    for (const model of runcrate.models) {
      expect(model).toMatch(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/)
    }
  })

  it('seeds CloudGPU with bare model ids (no vendor prefix)', () => {
    const cloudgpu = AI_PROVIDERS.find((provider) => provider.id === 'cloudgpu')!
    expect(cloudgpu.models).toEqual([
      'deepseek-v4.1-flash',
      'deepseek-v4-pro',
      'glm-5.3-flash',
      'kimi-k2.6',
      'minimax-m3',
    ])
    expect(cloudgpu.defaultModel).toBe('deepseek-v4.1-flash')
    expect(cloudgpu.models).toContain(cloudgpu.defaultModel)
    expect(cloudgpu.needsBaseUrl).toBeUndefined()
    expect(cloudgpu.keyPlaceholder).toBe('sk-...')
    for (const model of cloudgpu.models) {
      expect(model).not.toContain('/')
    }
  })

  it('seeds Cheaper Inference with bare model ids (no vendor prefix)', () => {
    const ci = AI_PROVIDERS.find((provider) => provider.id === 'cheaperinference')!
    expect(ci.models).toContain(ci.defaultModel)
    expect(ci.needsBaseUrl).toBeUndefined()
    for (const model of ci.models) {
      expect(model).not.toContain('/')
    }
  })

  it('seeds Kimi with the K3.1 flagship ahead of the still-sold K3', () => {
    const kimi = AI_PROVIDERS.find((provider) => provider.id === 'kimi')!
    expect(kimi.models).toEqual(['kimi-k3.1-pro', 'kimi-k3'])
    expect(kimi.defaultModel).toBe('kimi-k3.1-pro')
    expect(kimi.needsBaseUrl).toBeUndefined()
  })

  it('seeds Claude with Sonnet 5.5 as default and Gemini with 4 Argon ahead of 3.8 Flash', () => {
    const anthropic = AI_PROVIDERS.find((provider) => provider.id === 'anthropic')!
    expect(anthropic.models.slice(0, 2)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(anthropic.defaultModel).toBe('claude-sonnet-5-5')
    const gemini = AI_PROVIDERS.find((provider) => provider.id === 'gemini')!
    expect(gemini.models.slice(0, 2)).toEqual(['gemini-4-argon', 'gemini-3.8-flash'])
    expect(gemini.defaultModel).toBe('gemini-3.8-flash')
  })
})

describe('resolveAiSettings', () => {
  it('returns fresh defaults when nothing is stored', () => {
    const defaults = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(resolveAiSettings({}, defaults)).toEqual(defaults)
  })

  it('falls back to defaults for null and non-object settings roots', () => {
    for (const stored of [null, 'settings', 7, true, []]) {
      const defaults = defaultAiSettings()
      expect(resolveAiSettings(stored, defaults)).toEqual(defaults)
    }
  })

  it('falls back to defaults for null and non-object provider maps', () => {
    for (const providers of [null, 'providers', 7, true, []]) {
      const defaults = defaultAiSettings()
      expect(resolveAiSettings({ providers } as never, defaults)).toEqual(defaults)
    }
  })

  it('ignores null and non-object provider entries', () => {
    for (const entry of [null, 'provider', 7, true, []]) {
      const defaults = defaultAiSettings()
      const resolved = resolveAiSettings(
        { provider: 'anthropic', providers: { anthropic: entry } } as never,
        defaults,
      )
      expect(resolved.providers.anthropic).toEqual(defaults.providers.anthropic)
      expect(activeProvider(resolved)).toBe('genspark')
    }
  })

  it('migrates the pre-provider single-endpoint shape into the custom provider', () => {
    const defaults = defaultAiSettings()
    const resolved = resolveAiSettings(
      { apiKey: 'legacy-key', model: 'legacy-model', baseUrl: 'https://legacy.example.com/v1' },
      defaults,
    )
    expect(resolved.providers.custom).toEqual({
      apiKey: 'legacy-key',
      model: 'legacy-model',
      baseUrl: 'https://legacy.example.com/v1',
    })
    // untouched providers keep their defaults
    expect(resolved.providers.anthropic).toEqual(defaults.providers.anthropic)
  })

  it('defaults the legacy base URL to the OpenAI endpoint when omitted', () => {
    const resolved = resolveAiSettings({ apiKey: 'legacy-key' }, defaultAiSettings())
    expect(resolved.providers.custom.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('merges stored multi-provider settings over the defaults, provider by provider', () => {
    const defaults = defaultAiSettings({ anthropic: 'preset-key' })
    const resolved = resolveAiSettings(
      {
        provider: 'gemini',
        providers: {
          gemini: { apiKey: 'stored-gemini-key', model: 'gemini-2.5-pro' },
        } as never,
      },
      defaults,
    )
    expect(resolved.provider).toBe('gemini')
    expect(resolved.providers.gemini).toEqual({
      apiKey: 'stored-gemini-key',
      model: 'gemini-2.5-pro',
    })
    // provider not mentioned in stored.providers keeps the computed default
    expect(resolved.providers.anthropic.apiKey).toBe('preset-key')
  })

  it('rewrites a stored model id the vendor has retired', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          deepseek: { apiKey: 'sk-user', model: 'deepseek-reasoner' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.deepseek).toEqual({
      apiKey: 'sk-user',
      model: 'deepseek-flash',
    })
  })

  it('rewrites retired DeepSeek ids and the old pool spelling to the listed id', () => {
    for (const model of [
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'deepseek-chat',
      'deepseek-reasoner',
      'deep-seek-v4.1-flash',
    ]) {
      const resolved = resolveAiSettings(
        { providers: { deepseek: { apiKey: 'sk-user', model } } as never },
        defaultAiSettings(),
      )
      expect(resolved.providers.deepseek.model).toBe('deepseek-flash')
    }
  })

  it('rewrites genspark model ids the proxy no longer serves', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          genspark: { apiKey: '', model: 'gemini-3.7-flash' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.genspark.model).toBe('claude-opus-5-5')

    const gpt = resolveAiSettings(
      {
        providers: {
          genspark: { apiKey: '', model: 'gpt-5.6' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(gpt.providers.genspark.model).toBe('gpt-5.6-terra')

    const glm = resolveAiSettings(
      { providers: { glm: { apiKey: '', model: 'glm-5-turbo' } } as never },
      defaultAiSettings(),
    )
    expect(glm.providers.glm.model).toBe('glm-5.3-flash')
  })

  it('leaves a still-supported model id alone', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          deepseek: { apiKey: 'sk-user', model: 'deepseek-v4-pro' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.deepseek.model).toBe('deepseek-v4-pro')
  })

  it('trims whitespace pasted around stored keys and base URLs', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          deepseek: { apiKey: ' sk-user\n', model: ' deepseek-v4-pro ' },
          custom: { apiKey: 'k', model: ' m ', baseUrl: ' http://localhost:1234/v1 ' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.deepseek.apiKey).toBe('sk-user')
    expect(resolved.providers.deepseek.model).toBe('deepseek-v4-pro')
    expect(resolved.providers.deepseek.baseUrl).toBeUndefined()
    expect(resolved.providers.custom.model).toBe('m')
    expect(resolved.providers.custom.baseUrl).toBe('http://localhost:1234/v1')
  })

  it('still remaps retired model ids padded with whitespace', () => {
    const resolved = resolveAiSettings(
      {
        providers: {
          deepseek: { apiKey: 'sk-user', model: ' deepseek-reasoner ' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.deepseek.model).toBe('deepseek-flash')
  })

  it('trims the legacy single-endpoint key and base URL too', () => {
    const resolved = resolveAiSettings(
      {
        apiKey: ' legacy-key ',
        model: ' legacy-model ',
        baseUrl: ' https://legacy.example.com/v1 ',
      },
      defaultAiSettings(),
    )
    expect(resolved.providers.custom.apiKey).toBe('legacy-key')
    expect(resolved.providers.custom.model).toBe('legacy-model')
    expect(resolved.providers.custom.baseUrl).toBe('https://legacy.example.com/v1')
  })

  it('carries a stored output cap and clamps a hand-edited one', () => {
    // a multi-provider file (the legacy single-endpoint shape returns defaults wholesale)
    const stored = { providers: {} as never }
    expect(
      resolveAiSettings({ ...stored, maxOutputTokens: 32768 }, defaultAiSettings()).maxOutputTokens,
    ).toBe(32768)
    // a settings file edited by hand must not forward an absurd budget to the endpoint
    expect(
      resolveAiSettings({ ...stored, maxOutputTokens: 1 }, defaultAiSettings()).maxOutputTokens,
    ).toBe(MIN_MAX_OUTPUT_TOKENS)
>>>>>>> theirs
    expect(
      aiSettingsFileOf({
        provider: 'codex',
        apiKey: 'sk-old',
        providers: { openai: { apiKey: 'sk-1' } },
        media: { providers: {} },
        gskToolsEnabled: false,
      }),
    ).toEqual({ provider: 'uniwork', providers: {}, gskToolsEnabled: false })
  })

  it('omits a non-boolean opt-out and accepts any non-object input', () => {
    expect(aiSettingsFileOf({ provider: 'openai', apiKey: 'x', gskToolsEnabled: 'no' })).toEqual({
      provider: 'uniwork',
      providers: {},
    })
    for (const raw of [null, undefined, 'x', 3, []])
      expect(aiSettingsFileOf(raw)).toEqual({ provider: 'uniwork', providers: {} })
  })
})

describe('defaultAiSettings', () => {
  it('is UniWork AI with no provider slots and the cloud tools on', () => {
    const settings = defaultAiSettings()
    expect(settings.provider).toBe('uniwork')
    expect(Object.keys(settings.providers)).toEqual([])
    expect(settings.gskToolsEnabled).toBe(true)
  })
})

describe('gskToolsEnabled', () => {
  it('reads only the stored opt-out; any other stored field is ignored', () => {
    expect(resolveAiSettings({}, defaultAiSettings())).toEqual(defaultAiSettings())
    for (const stored of [null, 'settings', 7, true, []])
      expect(resolveAiSettings(stored, defaultAiSettings())).toEqual(defaultAiSettings())
    const off = resolveAiSettings(
      { provider: 'openai', providers: { openai: { apiKey: 'sk-1' } }, gskToolsEnabled: false },
      defaultAiSettings(),
    )
    expect(off).toEqual({ provider: 'uniwork', providers: {}, gskToolsEnabled: false })
    expect(resolveAiSettings({ gskToolsEnabled: 'no' }, defaultAiSettings()).gskToolsEnabled).toBe(
      true,
    )
  })

  it('keeps the stored toggle but stays off while the UniWork cloud seam is off', () => {
    expect(cloudToolsEnabled(defaultAiSettings())).toBe(false)
    expect(cloudToolsEnabled({ gskToolsEnabled: false })).toBe(false)
  })
})
